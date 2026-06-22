import type { GameResult } from './types'
import { costUsd } from './pricing'

/** Wilson score interval for a binomial proportion — sane CIs at small N (unlike normal approx). */
export function wilson(wins: number, total: number, z = 1.96): { lo: number; hi: number } {
  if (total === 0) return { lo: 0, hi: 0 }
  const p = wins / total,
    z2 = z * z,
    denom = 1 + z2 / total
  const center = p + z2 / (2 * total)
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)
  return { lo: (center - margin) / denom, hi: (center + margin) / denom }
}

const pct = (n: number, d: number) => (d === 0 ? 0 : n / d)
const percentile = (xs: number[], q: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}

export interface ModelAgg {
  model: string
  points: number // 3·win + 1·draw (stalemate) + 0·loss; voids award nothing — primary ranking
  games: number
  wins: number
  losses: number
  stalemates: number
  voids: number
  poolSkillPct: number
  wilsonLo: number
  wilsonHi: number
  reliabilityPct: number
  foulRate: number
  apiErrorRate: number
  avgShotsPerWin: number
  stalemateRate: number
  ballsPotted: number
  p50: number
  p95: number
  inputTokens: number
  outputTokens: number
  costUsd: number | null // null = no price entry for this model
}

export interface H2H {
  wins: number
  losses: number
  stalemates: number
}

export interface BenchmarkReport {
  meta: {
    timestamp: string
    models: string[]
    gamesPerPair: number
    concurrency: number
    historyEnabled: boolean
    nodeVersion: string
    totalGames: number
    reasoningEffort: string
    maxShots: number // settings that affect skill/cost, recorded for reproducibility
    totalCostUsd: number | null // sum of priced models; null if no model had a price
    unpricedModels: string[] // models excluded from totalCostUsd (no price entry)
  }
  leaderboard: ModelAgg[]
  headToHead: { models: string[]; matrix: H2H[][] }
  games: GameResult[]
}

// Per-model accumulator over every game the model played (as A or B, either side).
export function aggregate(games: GameResult[], models: string[]): ModelAgg[] {
  const init = () => ({
    games: 0,
    wins: 0,
    losses: 0,
    stalemates: 0,
    voids: 0,
    shots: 0,
    fouls: 0,
    valid: 0,
    illegal: 0,
    apiErrors: 0,
    balls: 0,
    shotsInWins: 0,
    lat: [] as number[],
    inTok: 0,
    outTok: 0,
  })
  const acc = new Map(models.map((m) => [m, init()]))

  for (const g of games) {
    for (const side of [0, 1] as const) {
      const model = side === 0 ? g.modelA : g.modelB
      const a = acc.get(model)
      if (!a) continue
      const s = g.stats[side]
      a.games++
      a.shots += s.shots
      a.fouls += s.fouls
      a.valid += s.validMoves
      a.illegal += s.illegalMoves
      a.apiErrors += s.apiErrors
      a.balls += s.ballsPotted
      a.lat.push(...s.latenciesMs)
      a.inTok += s.inputTokens
      a.outTok += s.outputTokens
      if (g.outcome === 'void') a.voids++
      else if (g.winner === null) a.stalemates++
      else if (g.winner === side) {
        a.wins++
        a.shotsInWins += g.totalShots
      } else a.losses++
    }
  }

  return models
    .map((model) => {
      const a = acc.get(model)!
      const decisive = a.wins + a.losses
      const w = wilson(a.wins, decisive)
      return {
        model,
        points: a.wins * 3 + a.stalemates, // 3 win / 1 draw / 0 loss; voids contribute nothing
        games: a.games,
        wins: a.wins,
        losses: a.losses,
        stalemates: a.stalemates,
        voids: a.voids,
        poolSkillPct: pct(a.wins, decisive),
        wilsonLo: w.lo,
        wilsonHi: w.hi,
        // of the moves the model actually returned, the fraction that were well-formed.
        // API failures (no move returned) are NOT counted here — they're infra, tracked as apiErrorRate.
        reliabilityPct: pct(a.valid, a.valid + a.illegal),
        foulRate: pct(a.fouls, a.shots),
        apiErrorRate: pct(a.apiErrors, a.shots),
        avgShotsPerWin: a.wins ? a.shotsInWins / a.wins : 0,
        stalemateRate: pct(a.stalemates, a.games),
        ballsPotted: a.balls,
        p50: percentile(a.lat, 0.5),
        p95: percentile(a.lat, 0.95),
        inputTokens: a.inTok,
        outputTokens: a.outTok,
        costUsd: costUsd(model, a.inTok, a.outTok),
      }
    })
    .sort((x, y) => y.points - x.points || y.wins - x.wins || y.poolSkillPct - x.poolSkillPct)
}

/** Total $ across models that have a price; lists the ones skipped for lack of one. */
export function totalCost(leaderboard: ModelAgg[]): { totalCostUsd: number | null; unpricedModels: string[] } {
  const priced = leaderboard.filter((m) => m.costUsd != null)
  const unpricedModels = leaderboard.filter((m) => m.costUsd == null).map((m) => m.model)
  return { totalCostUsd: priced.length ? priced.reduce((s, m) => s + (m.costUsd as number), 0) : null, unpricedModels }
}

export function headToHead(games: GameResult[], models: string[]): { models: string[]; matrix: H2H[][] } {
  const idx = new Map(models.map((m, i) => [m, i]))
  const matrix: H2H[][] = models.map(() => models.map(() => ({ wins: 0, losses: 0, stalemates: 0 })))
  for (const g of games) {
    const i = idx.get(g.modelA),
      j = idx.get(g.modelB)
    if (i == null || j == null || i === j) continue
    if (g.outcome === 'void') continue
    if (g.winner === null) {
      matrix[i][j].stalemates++
      matrix[j][i].stalemates++
    } else if (g.winner === 0) {
      matrix[i][j].wins++
      matrix[j][i].losses++
    } else {
      matrix[i][j].losses++
      matrix[j][i].wins++
    }
  }
  return { models, matrix }
}

const fp = (v: number, d = 1) => (v * 100).toFixed(d)
const money = (v: number | null) => (v == null ? '—' : '$' + (v < 1 ? v.toFixed(4) : v.toFixed(2)))
const ktok = (n: number) => `${Math.round(n / 1000)}k`

export function renderMarkdown(r: BenchmarkReport): string {
  const o: string[] = []
  o.push(`# LLM Chinese 8-Ball Benchmark`)
  o.push(
    `\n_${r.meta.timestamp} · ${r.meta.totalGames} games · ${r.meta.gamesPerPair}/pair · effort ${r.meta.reasoningEffort} · max-shots ${r.meta.maxShots} · concurrency ${r.meta.concurrency} · history ${r.meta.historyEnabled ? 'on' : 'off'} · node ${r.meta.nodeVersion}_\n`,
  )

  o.push(`## Leaderboard\n`)
  o.push(
    `Ranked by **points** (win = 3, draw = 1, loss = 0; draw = stalemate, voids score nothing). Skill % = wins / (wins + losses) with a Wilson 95% CI, shown as a secondary signal. Reliability = fraction of *returned* moves that were well-formed (API failures excluded — see API err), so move-formatting ability is not mistaken for pool skill.\n`,
  )
  o.push(
    `| # | Model | Pts | W–D–L | Skill % | 95% CI | Reliability | Foul/shot | Avg shots/win | API err | p50/p95 ms | Tokens in/out | Cost |`,
  )
  o.push(
    `|---|-------|----:|:-----:|--------:|:------:|:-----------:|:---------:|:-------------:|:-------:|:----------:|:-------------:|-----:|`,
  )
  r.leaderboard.forEach((m, i) => {
    const ciWidth = m.wilsonHi - m.wilsonLo
    const ci = `${fp(m.wilsonLo, 0)}–${fp(m.wilsonHi, 0)}${ciWidth > 0.3 ? ' ⚠' : ''}`
    o.push(
      `| ${i + 1} | ${m.model} | **${m.points}** | ${m.wins}–${m.stalemates}–${m.losses} | ${fp(m.poolSkillPct)} | ${ci} | ${fp(m.reliabilityPct)}% | ${fp(m.foulRate)}% | ${m.avgShotsPerWin.toFixed(1)} | ${fp(m.apiErrorRate)}% | ${m.p50}/${m.p95} | ${ktok(m.inputTokens)}/${ktok(m.outputTokens)} | ${money(m.costUsd)} |`,
    )
  })
  const cost = r.meta.totalCostUsd
  o.push(
    `\n**Total cost: ${money(cost)}**${r.meta.unpricedModels.length ? ` _(excludes ${r.meta.unpricedModels.join(', ')} — no price set in pricing.ts)_` : ''}`,
  )

  if (r.headToHead.models.length > 1) {
    o.push(`\n## Head-to-head (row vs column, row's W–L–S)\n`)
    o.push(`| | ${r.headToHead.models.join(' | ')} |`)
    o.push(`|${'---|'.repeat(r.headToHead.models.length + 1)}`)
    r.headToHead.models.forEach((m, i) => {
      const cells = r.headToHead.models.map((_, j) =>
        i === j
          ? '—'
          : `${r.headToHead.matrix[i][j].wins}–${r.headToHead.matrix[i][j].losses}–${r.headToHead.matrix[i][j].stalemates}`,
      )
      o.push(`| **${m}** | ${cells.join(' | ')} |`)
    })
  }

  const warn = r.leaderboard.some((m) => m.wilsonHi - m.wilsonLo > 0.3) || r.meta.gamesPerPair < 20
  if (warn)
    o.push(
      `\n> ⚠ **Low confidence.** Some intervals are wide (or <20 games/pair). Increase \`--games\` for a publishable ranking.`,
    )
  o.push(
    `\n---\n_Deterministic within a single run/machine; not claimed bit-reproducible across machines or LLM calls (no temperature is set, so the LLM is the only stochastic input)._`,
  )
  return o.join('\n')
}
