import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { playGame, type MoveSource } from './game'
import { aggregate, headToHead, renderMarkdown, totalCost, type BenchmarkReport } from './stats'
import type { GameOptions, GameResult, Keys } from './types'

// Counter-gated semaphore: at most `limit` games in flight; a finishing game wakes the next.
class AsyncPool {
  private n = 0
  private q: (() => void)[] = []
  constructor(private limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.n >= this.limit) await new Promise<void>((r) => this.q.push(r))
    this.n++
    try {
      return await fn()
    } finally {
      this.n--
      this.q.shift()?.()
    }
  }
}

export interface BenchOptions extends GameOptions {
  gamesPerPair?: number
  concurrency?: number
  out?: string // path to the JSON report (.md written alongside)
  selfPlay?: boolean // also pair each model against itself (stochasticity baseline)
  resume?: boolean // load completed games from out/checkpoint and skip matching jobs
}

const isoStamp = () => new Date().toISOString().replace(/[:.]/g, '-')

function writeAtomic(path: string, data: string) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

function gameKey(g: Pick<GameResult, 'modelA' | 'modelB' | 'breaker'>) {
  return `${g.modelA}\u0000${g.modelB}\u0000${g.breaker}`
}

function readGames(path: string): GameResult[] {
  if (!existsSync(path)) return []
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    if (Array.isArray(data)) return data as GameResult[]
    if (Array.isArray(data?.games)) return data.games as GameResult[]
  } catch (e) {
    console.warn(`Could not read resume data from ${path}: ${e instanceof Error ? e.message : e}`)
  }
  return []
}

function loadResumeGames(out: string, checkpoint: string) {
  const byKey = new Map<string, GameResult[]>()
  for (const g of [...readGames(out), ...readGames(checkpoint)]) {
    if (!g?.modelA || !g?.modelB || (g.breaker !== 0 && g.breaker !== 1)) continue
    const k = gameKey(g)
    const bucket = byKey.get(k)
    if (bucket) bucket.push(g)
    else byKey.set(k, [g])
  }
  return byKey
}

/** Round-robin benchmark with break alternation, run in parallel. Writes JSON + Markdown + checkpoints. */
export async function runBenchmark(
  models: string[],
  keys: Keys,
  opts: BenchOptions = {},
  moveSource?: MoveSource,
): Promise<BenchmarkReport> {
  const gamesPerPair = opts.gamesPerPair ?? 1
  const concurrency = opts.concurrency ?? 3
  const out = opts.out ?? `./bench-results/run-${isoStamp()}.json`
  const checkpoint = out.replace(/\.json$/, '') + '.checkpoint.json'

  // pairings: unordered pairs (i<j), plus self-play if requested. breaker alternates per game.
  const jobs: { a: string; b: string; breaker: 0 | 1 }[] = []
  for (let i = 0; i < models.length; i++)
    for (let j = opts.selfPlay ? i : i + 1; j < models.length; j++)
      for (let k = 0; k < gamesPerPair; k++) jobs.push({ a: models[i], b: models[j], breaker: (k % 2) as 0 | 1 })

  const resumeGames = opts.resume ? loadResumeGames(out, checkpoint) : new Map<string, GameResult[]>()
  const jobsToRun: typeof jobs = []
  const results: GameResult[] = []
  if (opts.resume) {
    for (const job of jobs) {
      const existing = resumeGames.get(`${job.a}\u0000${job.b}\u0000${job.breaker}`)?.shift()
      if (existing) results.push(existing)
      else jobsToRun.push(job)
    }
    console.log(`Resume: loaded ${results.length}/${jobs.length} completed games from ${out} / ${checkpoint}.`)
  } else jobsToRun.push(...jobs)

  const pool = new AsyncPool(concurrency)
  const total = jobs.length
  let done = results.length

  const tasks = jobsToRun.map((job) =>
    pool
      .run(() => playGame(job.a, job.b, job.breaker, keys, opts, moveSource))
      .then(
        (res) => {
          results.push(res)
          done++
          const brk = res.breaker === 0 ? res.modelA : res.modelB
          const winLabel = res.winner === null ? res.outcome : `${res.winner === 0 ? res.modelA : res.modelB} won`
          console.log(
            `[${done}/${total}] ${job.a} vs ${job.b} (break: ${brk}) → ${winLabel} in ${res.totalShots} shots`,
          )
          writeAtomic(checkpoint, JSON.stringify(results)) // crash-safe partial results
        },
        (err) => {
          done++
          console.error(`[${done}/${total}] ${job.a} vs ${job.b} FAILED: ${err?.message ?? err}`)
        },
      ),
  )
  await Promise.allSettled(tasks)

  const leaderboard = aggregate(results, models)
  const { totalCostUsd, unpricedModels } = totalCost(leaderboard)
  const report: BenchmarkReport = {
    meta: {
      timestamp: new Date().toISOString(),
      models,
      gamesPerPair,
      concurrency,
      historyEnabled: !!opts.history,
      nodeVersion: process.version,
      totalGames: results.length,
      reasoningEffort: opts.reasoningEffort ?? 'low',
      maxShots: opts.maxShots ?? 240,
      totalCostUsd,
      unpricedModels,
    },
    leaderboard,
    headToHead: headToHead(results, models),
    games: results,
  }
  writeAtomic(out, JSON.stringify(report, null, 2))
  const md = out.replace(/\.json$/, '') + '.md'
  writeAtomic(md, renderMarkdown(report))
  console.log(`\n${renderMarkdown(report)}\n\nWrote ${out}\n      ${md}`)
  return report
}
