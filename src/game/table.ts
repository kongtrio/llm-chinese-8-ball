import { L, W, BR } from './constants'
import { mkBall, groupOf } from './types'
import type { Ball, Group } from './types'

export const onTable = (b: Ball) => !b.potted
export const objectBalls = (balls: Ball[]) => balls.filter(b => b.num !== 0)
export const remainingOf = (balls: Ball[], g: Group) =>
  objectBalls(balls).filter(b => onTable(b) && groupOf(b.num) === g).length

export function rack(): Ball[] {
  const balls: Ball[] = [mkBall(0, L * 0.25, W / 2)]   // cue on the head spot
  const solids = [1, 2, 3, 4, 5, 6, 7], stripes = [9, 10, 11, 12, 13, 14, 15]
  const order: number[] = []
  for (let i = 0; i < 7; i++) { order.push(solids[i]); order.push(stripes[i]) }
  order.splice(4, 0, 8); order.length = 15            // 8 at the rack centre
  const footX = L * 0.72, dx = BR * Math.sqrt(3), gap = 2 * BR + 0.0003
  let k = 0
  for (let row = 0; row < 5; row++)
    for (let i = 0; i <= row; i++)
      balls.push(mkBall(order[k++], footX + row * dx, W / 2 + (i - row / 2) * gap))
  return balls
}

export const spotFree = (balls: Ball[], x: number, y: number, ignore?: Ball) =>
  balls.every(b => !onTable(b) || b === ignore || Math.hypot(b.x - x, b.y - y) >= 2 * BR + 0.001)

export function freeSpot(balls: Ball[], x: number, y: number): { x: number; y: number } {
  if (spotFree(balls, x, y)) return { x, y }
  for (let rad = 2 * BR; rad < L; rad += BR)
    for (let a = 0; a < 360; a += 20) {
      const nx = x + Math.cos(a * Math.PI / 180) * rad, ny = y + Math.sin(a * Math.PI / 180) * rad
      if (nx > BR && nx < L - BR && ny > BR && ny < W - BR && spotFree(balls, nx, ny)) return { x: nx, y: ny }
    }
  return { x, y }
}

export function respot(balls: Ball[], num: number) {
  const b = balls.find(x => x.num === num)!
  const p = freeSpot(balls, L * 0.72, W / 2)
  b.x = p.x; b.y = p.y; b.vx = b.vy = b.wx = b.wy = b.wz = 0; b.rx = b.ry = b.rz = 0; b.potted = false
}
