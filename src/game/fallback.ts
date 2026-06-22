import type { Ball, Group } from './types'
import { groupOf } from './types'
import { objectBalls, onTable, remainingOf } from './table'

export function chooseFallbackTarget(balls: Ball[], group: Group | null): Ball | null {
  const live = objectBalls(balls).filter(onTable)
  if (!group) return live.find((b) => b.num !== 8) ?? live[0] ?? null

  if (remainingOf(balls, group) === 0) return live.find((b) => b.num === 8) ?? live[0] ?? null

  return live.find((b) => b.num !== 8 && groupOf(b.num) === group) ?? live.find((b) => b.num !== 8) ?? live[0] ?? null
}

export function fallbackAngle(balls: Ball[], group: Group | null): number {
  const c = balls[0]
  const t = chooseFallbackTarget(balls, group)
  return t ? Math.atan2(t.y - c.y, t.x - c.x) : 0
}
