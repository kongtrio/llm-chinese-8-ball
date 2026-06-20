import { L, W, BR, DT } from '../game/constants'
import type { Ball, Move, RuntimePlayer, ShotCtx } from '../game/types'
import { rack, onTable, objectBalls, remainingOf, freeSpot, spotFree } from '../game/table'
import { advance, allStopped } from '../game/physics'
import { evaluateShot } from '../game/rules'
import { computeShot } from '../game/shoot'
import { buildPrompt, type Snapshot, type Usage } from '../ai/llm'
import { formatHistory, type ShotRecord } from '../ai/memory'
import { callLLMWithRetry } from './llm'
import type { GameOptions, GameResult, Keys, Outcome, PlayerStats } from './types'

// A move source lets tests inject deterministic moves instead of hitting the network.
// usage is optional — test sources omit it; the live source carries real token counts.
export type MoveSource = (model: string, snap: Snapshot) => Promise<{ move: Move; usage?: Usage }>

const keyFor = (model: string, keys: Keys) => (model.startsWith('claude') ? keys.anthropic : keys.openai)
const deg2rad = (d: number) => (d * Math.PI) / 180
const num = (v: unknown) => (v == null || v === '' ? NaN : Number(v))
// Well-formed = all four shot fields parse to finite numbers (rejects missing/null/NaN/non-numeric).
// Out-of-range numbers are NOT malformed — like the browser engine we clamp/normalize them in computeShot.
const wellFormed = (m: Move) =>
  Number.isFinite(num(m.angle_degrees)) && Number.isFinite(num(m.power)) &&
  Number.isFinite(num(m.spin_x)) && Number.isFinite(num(m.spin_y))

const mkStats = (model: string): PlayerStats =>
  ({ model, shots: 0, ballsPotted: 0, fouls: 0, validMoves: 0, illegalMoves: 0, apiErrors: 0, fallbackShots: 0, latenciesMs: [], inputTokens: 0, outputTokens: 0 })

// ponytail: dumb-but-legal shot — mirrors GameEngine.fallbackShot so a bad/failed move never stalls a game.
function fallbackMove(balls: Ball[], group: RuntimePlayer['group']): Move {
  const c = balls[0]
  const t = objectBalls(balls).filter(onTable).filter(b => !group || (b.num !== 8 && (group === 'solid' ? b.num < 8 : b.num > 8)))[0]
    || objectBalls(balls).filter(onTable)[0]
  const ang = t ? Math.atan2(t.y - c.y, t.x - c.x) : 0
  return { angle_degrees: (ang * 180) / Math.PI, power: 0.5, spin_x: 0, spin_y: 0 }
}

// Mirror of GameEngine.placeCue for ball-in-hand (coords in cm, or undefined for a default spot).
function placeCueHeadless(balls: Ball[], cueXcm?: number, cueYcm?: number) {
  const c = balls[0]
  let x = cueXcm == null ? undefined : cueXcm / 100
  let y = cueYcm == null ? undefined : cueYcm / 100
  if (x == null || y == null || !(x > BR && x < L - BR && y > BR && y < W - BR)) {
    const d = freeSpot(balls, L * 0.25, W / 2); x = d.x; y = d.y
  } else if (!spotFree(balls, x, y, c)) { const d = freeSpot(balls, x, y); x = d.x; y = d.y }
  c.x = x; c.y = y; c.vx = c.vy = c.wx = c.wy = c.wz = 0; c.rx = c.ry = c.rz = 0; c.potted = false
}

/**
 * Play one full LLM-vs-LLM game to completion, headless. All state is allocated locally
 * (fresh balls/players/ctx/shots per call) so many games run concurrently with zero shared
 * mutable state. Deterministic given the moves: physics has no RNG/clock.
 */
export async function playGame(
  modelA: string, modelB: string, breaker: 0 | 1, keys: Keys, opts: GameOptions = {}, moveSource?: MoveSource,
): Promise<GameResult> {
  const balls = rack()
  const players: RuntimePlayer[] = [
    { type: 'llm', model: modelA, group: null, name: modelA },
    { type: 'llm', model: modelB, group: null, name: modelB },
  ]
  const stats: [PlayerStats, PlayerStats] = [mkStats(modelA), mkStats(modelB)]
  const shots: ShotRecord[] = []
  const errors: GameResult['errors'] = []
  const lang = opts.lang ?? 'en'
  const maxShots = opts.maxShots ?? 240
  const subCap = opts.maxSubsteps ?? 6000
  const startMs = Date.now()

  const src: MoveSource = moveSource
    ?? ((model, snap) => callLLMWithRetry(model, keyFor(model, keys), buildPrompt(snap), opts))

  let current = breaker
  let isBreak = true
  let ballInHand = false
  let winner: 0 | 1 | null = null
  let outcome: Outcome = 'stalemate'

  while (winner === null && shots.length < maxShots) {
    const cue = balls[0]
    const me = players[current]
    const snap: Snapshot = {
      group: me.group, isBreak, ballInHand,
      cue: { x: cue.x, y: cue.y }, balls,
      history: opts.history ? formatHistory(shots, current, 0) : undefined,
    }

    // --- get a move ---
    let move: Move | null = null
    const t0 = Date.now()
    try {
      const r = await src(me.model, snap)
      move = r.move
      if (r.usage) { stats[current].inputTokens += r.usage.inputTokens; stats[current].outputTokens += r.usage.outputTokens }
    } catch (e) { errors.push({ shot: shots.length, player: current, message: e instanceof Error ? e.message : String(e) }) }
    stats[current].latenciesMs.push(Date.now() - t0)

    if (!move) {
      // no usable response (thrown / null) -> smart legal fallback (mirrors GameEngine.fallbackShot)
      stats[current].apiErrors++
      stats[current].fallbackShots++
      if (ballInHand) placeCueHeadless(balls)            // default spot before the fallback shot
      move = fallbackMove(balls, me.group)
    } else {
      // a move came back: well-formed counts toward reliability; malformed is dinged but still
      // coerced-and-played exactly as the browser engine does (keeps headless faithful to the UI).
      if (wellFormed(move)) stats[current].validMoves++
      else stats[current].illegalMoves++
      if (ballInHand) placeCueHeadless(balls, move.cue_x, move.cue_y)
    }

    // --- apply the shot, coercing each field exactly like GameEngine.doLLMTurn (`+x || default`) ---
    const cueStart = { x: Math.round(cue.x * 100), y: Math.round(cue.y * 100) }
    const angleDeg = Number(move.angle_degrees) || 0
    const angleRad = deg2rad(angleDeg)
    const sv = computeShot(angleRad, Number(move.power) || 0.4, Number(move.spin_x) || 0, Number(move.spin_y) || 0)
    cue.vx = sv.vx; cue.vy = sv.vy; cue.wx = sv.wx; cue.wy = sv.wy; cue.wz = sv.wz
    const ctx: ShotCtx = {
      firstHit: null, railAfter: false, potted: [], cuePotted: false,
      group: me.group,
      clearedBefore: me.group ? remainingOf(balls, me.group) === 0 : false,
    }

    // --- run physics to rest (deterministic single-substep steps; cap guards a never-settling table) ---
    let steps = 0
    while (!allStopped(balls) && steps < subCap) { advance(balls, DT, ctx); steps++ }
    if (steps >= subCap) { outcome = 'void'; break }   // void, not force-settle: don't trust evaluateShot on a stuck table

    // --- resolve (same transitions as GameEngine.resolve/nextTurn) ---
    const r = evaluateShot(balls, players, current, isBreak, ctx, lang)
    isBreak = false
    if (opts.verbose) console.log(`  [${me.model}] ${r.lines.join(' ')}`)

    stats[current].shots++
    stats[current].ballsPotted += ctx.potted.length
    if (r.foul) stats[current].fouls++
    shots.push({
      game: 0, player: current, who: me.name, model: me.model,
      group: me.group as 'solid' | 'stripe' | null, cue: cueStart,
      aim: ((angleDeg % 360) + 360) % 360, power: sv.pw, sx: sv.sx, sy: sv.sy,
      intent: move.reasoning?.slice(0, 80),
      firstHit: ctx.firstHit, potted: [...ctx.potted], cuePotted: ctx.cuePotted, foul: r.foul,
      cueEnd: { x: Math.round(cue.x * 100), y: Math.round(cue.y * 100) },
    })

    if (r.winner !== null) {
      winner = r.winner as 0 | 1
      outcome = r.winner === current ? 'legal-8' : 'lost-on-8'
      break
    }
    if (r.keepTurn) ballInHand = false
    else { current = (1 - current) as 0 | 1; ballInHand = r.ballInHand }
    if (ctx.cuePotted) ballInHand = true
  }

  return {
    modelA, modelB, breaker, winner, outcome,
    totalShots: shots.length, stats, shots, errors, startMs, endMs: Date.now(),
  }
}
