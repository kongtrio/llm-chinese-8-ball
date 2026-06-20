import { describe, it, expect } from 'vitest'
import { BR, DT, V_STOP } from './constants'
import { mkBall } from './types'
import type { ShotCtx } from './types'
import { collide, integrate } from './physics'

const ctx = (): ShotCtx => ({ firstHit: null, railAfter: false, potted: [], cuePotted: false, group: null, clearedBefore: false })

describe('physics', () => {
  it('conserves momentum and transfers energy in an equal-mass collision', () => {
    const a = mkBall(0, 0, 0), b = mkBall(1, 2 * BR - 1e-4, 0); a.vx = 2
    const before = a.vx + b.vx; const c = ctx(); collide(a, b, c)
    expect(Math.abs(before - (a.vx + b.vx))).toBeLessThan(1e-6)
    expect(b.vx).toBeGreaterThan(a.vx)
    expect(c.firstHit).toBe(1)
  })

  it('draw: backspin makes a stationary cue reverse under friction', () => {
    const c = mkBall(0, 1, 0.5); c.wy = -30
    for (let i = 0; i < 200; i++) integrate(c, DT)
    expect(c.vx).toBeLessThan(0)
  })

  it('a rolling ball decelerates to rest (low cloth resistance => long roll)', () => {
    const e = mkBall(0, 1, 0.5); e.vx = 1.5; e.wy = 1.5 / BR
    for (let i = 0; i < 9000; i++) integrate(e, DT)   // ~15 s; stops near 12.8 s
    expect(Math.hypot(e.vx, e.vy)).toBeLessThan(V_STOP)
  })
})
