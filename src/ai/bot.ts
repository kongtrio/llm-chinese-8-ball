import { BR, L, W, POCKETS } from '../game/constants'
import { fallbackAngle } from '../game/fallback'
import { groupOf } from '../game/types'
import type { Ball, Group, Move } from '../game/types'
import type { Snapshot } from './llm'

export const BOT_BASIC = 'bot-basic'
export const isBotModel = (model: string) => model === BOT_BASIC || model.startsWith('bot-')

const cm = (v: number) => Math.round(v * 100)
const deg = (r: number) => (r * 180) / Math.PI
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const liveObjects = (balls: Ball[]) => balls.filter((b) => b.num !== 0 && !b.potted)

function remainingGroup(balls: Ball[], group: Group) {
  return liveObjects(balls).filter((b) => groupOf(b.num) === group).length
}

function legalTargets(s: Snapshot): Ball[] {
  const live = liveObjects(s.balls)
  if (s.isBreak) return live
  if (!s.group) return live.filter((b) => b.num !== 8)
  if (remainingGroup(s.balls, s.group) === 0) return live.filter((b) => b.num === 8)
  return live.filter((b) => b.num !== 8 && groupOf(b.num) === s.group)
}

function segmentBlocked(
  balls: Ball[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  ignore: Set<number>,
  clearance = BR * 1.92,
) {
  const dx = bx - ax,
    dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 <= 1e-9) return true
  for (const b of balls) {
    if (b.potted || ignore.has(b.num)) continue
    const t = clamp(((b.x - ax) * dx + (b.y - ay) * dy) / len2, 0, 1)
    const px = ax + dx * t,
      py = ay + dy * t
    if (Math.hypot(b.x - px, b.y - py) < clearance) return true
  }
  return false
}

function validCueSpot(balls: Ball[], x: number, y: number) {
  return (
    x > BR &&
    x < L - BR &&
    y > BR &&
    y < W - BR &&
    balls.every((b) => b.num === 0 || b.potted || Math.hypot(b.x - x, b.y - y) >= 2 * BR + 0.002)
  )
}

function cueForBallInHand(balls: Ball[], ghostX: number, ghostY: number, ux: number, uy: number) {
  const distances = [0.35, 0.28, 0.44, 0.2, 0.55]
  for (const d of distances) {
    const x = ghostX - ux * d
    const y = ghostY - uy * d
    if (validCueSpot(balls, x, y)) return { x, y }
  }
  const x = clamp(ghostX - ux * 0.3, BR + 0.01, L - BR - 0.01)
  const y = clamp(ghostY - uy * 0.3, BR + 0.01, W - BR - 0.01)
  return { x, y }
}

interface Candidate {
  target: Ball
  pocket: { x: number; y: number }
  ghost: { x: number; y: number }
  cue: { x: number; y: number }
  score: number
}

function bestPot(s: Snapshot): Candidate | null {
  let best: Candidate | null = null
  for (const target of legalTargets(s)) {
    for (const p of POCKETS) {
      const tx = p.x - target.x,
        ty = p.y - target.y
      const pocketDist = Math.hypot(tx, ty)
      if (pocketDist < 1e-6) continue
      const ux = tx / pocketDist,
        uy = ty / pocketDist
      const ghost = { x: target.x - ux * 2 * BR, y: target.y - uy * 2 * BR }
      if (ghost.x <= BR || ghost.x >= L - BR || ghost.y <= BR || ghost.y >= W - BR) continue
      const cue = s.ballInHand ? cueForBallInHand(s.balls, ghost.x, ghost.y, ux, uy) : s.cue
      if (segmentBlocked(s.balls, cue.x, cue.y, ghost.x, ghost.y, new Set([0, target.num]))) continue
      if (segmentBlocked(s.balls, target.x, target.y, p.x, p.y, new Set([0, target.num]), BR * 1.55)) continue

      const cueToTarget = Math.hypot(target.x - cue.x, target.y - cue.y)
      const cueUx = (target.x - cue.x) / Math.max(cueToTarget, 1e-6)
      const cueUy = (target.y - cue.y) / Math.max(cueToTarget, 1e-6)
      const cut = Math.acos(clamp(cueUx * ux + cueUy * uy, -1, 1))
      if (cut > Math.PI * 0.48) continue

      const score = cut * 2.8 + cueToTarget * 0.7 + pocketDist * 0.45 + (target.num === 8 ? 0.15 : 0)
      if (!best || score < best.score) best = { target, pocket: p, ghost, cue, score }
    }
  }
  return best
}

export function getBotMove(s: Snapshot): Move {
  if (s.isBreak) {
    const cue = s.cue
    const apex = liveObjects(s.balls).sort(
      (a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y),
    )[0]
    const angle = apex ? deg(Math.atan2(apex.y - cue.y, apex.x - cue.x)) : 0
    return {
      reasoning: 'Break: hit the apex ball firmly and keep the cue near mid-table.',
      angle_degrees: angle,
      power: 0.96,
      spin_x: 0,
      spin_y: -0.12,
    }
  }

  const pot = bestPot(s)
  if (pot) {
    const angle = deg(Math.atan2(pot.ghost.y - pot.cue.y, pot.ghost.x - pot.cue.x))
    const travel =
      Math.hypot(pot.target.x - pot.cue.x, pot.target.y - pot.cue.y) +
      Math.hypot(pot.pocket.x - pot.target.x, pot.pocket.y - pot.target.y)
    const power = clamp(0.28 + travel * 0.18, 0.28, 0.72)
    return {
      reasoning: `Pot ${pot.target.num} to (${cm(pot.pocket.x)},${cm(pot.pocket.y)}) with a ghost-ball aim.`,
      angle_degrees: angle,
      power,
      spin_x: 0,
      spin_y: 0.08,
      cue_x: s.ballInHand ? cm(pot.cue.x) : undefined,
      cue_y: s.ballInHand ? cm(pot.cue.y) : undefined,
    }
  }

  const angle = deg(fallbackAngle(s.balls, s.group))
  return {
    reasoning: 'No clear pot found; roll at the safest legal target.',
    angle_degrees: angle,
    power: 0.45,
    spin_x: 0,
    spin_y: 0,
    cue_x: s.ballInHand ? cm(clamp(L * 0.25, BR + 0.01, L - BR - 0.01)) : undefined,
    cue_y: s.ballInHand ? cm(W / 2) : undefined,
  }
}
