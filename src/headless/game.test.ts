import { describe, it, expect } from 'vitest'
import { BR, MAX_CUE } from '../game/constants'
import { computeShot } from '../game/shoot'
import { wilson } from './stats'
import { costUsd } from './pricing'
import { playGame, type MoveSource } from './game'
import type { Move } from '../game/types'

const KEYS = { anthropic: 'x', openai: 'x' }

// Deterministic scripted bot: aim at the first on-table ball of my group, fixed power, no spin.
const scripted: MoveSource = async (_model, snap) => {
  const c = snap.balls[0]
  const mine = snap.balls.filter(b => b.num !== 0 && !b.potted)
    .filter(b => !snap.group || (b.num !== 8 && (snap.group === 'solid' ? b.num < 8 : b.num > 8)))
  const t = mine[0] ?? snap.balls.find(b => b.num !== 0 && !b.potted)
  const ang = t ? (Math.atan2(t.y - c.y, t.x - c.x) * 180) / Math.PI : 0
  return { move: { angle_degrees: ang, power: 0.7, spin_x: 0, spin_y: 0 } }
}

describe('computeShot (shared source of truth)', () => {
  it('full-power straight shot has speed MAX_CUE along +x, no spin', () => {
    const s = computeShot(0, 1, 0, 0)
    expect(s.vx).toBeCloseTo(MAX_CUE, 10)
    expect(s.vy).toBeCloseTo(0, 10)
    expect(s.wx).toBeCloseTo(0, 10); expect(s.wy).toBeCloseTo(0, 10); expect(s.wz).toBeCloseTo(0, 10)
  })
  it('clamps power and normalizes spin to the unit circle', () => {
    const s = computeShot(0, 5, 1, 1)             // power>1 clamped; spin (1,1) normalized to ~0.707
    expect(s.pw).toBe(1)
    expect(Math.hypot(s.sx, s.sy)).toBeCloseTo(1, 10)
    expect(s.wz).toBeCloseTo(s.sx * 1.25 * (MAX_CUE / BR), 6)   // side English from sp
    expect(s.wy).toBeCloseTo(s.sy * 1.25 * (s.vx / BR), 6)      // follow from vx
  })
})

describe('wilson', () => {
  it('gives sane intervals and clamps the edges', () => {
    const m = wilson(7, 10)
    expect(m.lo).toBeGreaterThan(0.35); expect(m.lo).toBeLessThan(0.45)
    expect(m.hi).toBeGreaterThan(0.85); expect(m.hi).toBeLessThan(0.92)
    expect(wilson(0, 10).lo).toBe(0)
    expect(wilson(10, 10).hi).toBe(1)
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 0 })
  })
})

describe('playGame', () => {
  it('is deterministic: identical scripted moves -> bit-identical shot sequence', async () => {
    const runs = await Promise.all([0, 1, 2, 3, 4].map(() => playGame('A', 'B', 0, KEYS, { maxShots: 60 }, scripted)))
    const ref = JSON.stringify(runs[0].shots)
    for (const r of runs) {
      expect(JSON.stringify(r.shots)).toBe(ref)
      expect(r.outcome).toBe(runs[0].outcome)
      expect(r.winner).toBe(runs[0].winner)
    }
  })

  it('terminates within the shot cap and records every shot', async () => {
    const r = await playGame('A', 'B', 0, KEYS, { maxShots: 80 }, scripted)
    expect(r.totalShots).toBe(r.shots.length)
    expect(r.totalShots).toBeLessThanOrEqual(80)
    expect(['legal-8', 'lost-on-8', 'stalemate', 'void']).toContain(r.outcome)
    expect(r.stats[0].validMoves + r.stats[1].validMoves).toBeGreaterThan(0)
  })

  it('flags malformed (missing field) moves against reliability but still plays a coerced shot', async () => {
    const broken: MoveSource = async () => ({ move: { power: 0.5 } as Move })   // missing angle/spin -> malformed
    const r = await playGame('A', 'B', 0, KEYS, { maxShots: 12 }, broken)
    expect(r.stats[0].illegalMoves + r.stats[1].illegalMoves).toBeGreaterThan(0)
    expect(r.stats[0].validMoves + r.stats[1].validMoves).toBe(0)
    expect(r.totalShots).toBeGreaterThan(0)
    expect(r.stats[0].fallbackShots + r.stats[1].fallbackShots).toBe(0)   // present-but-malformed != fallback
  })

  it('coerces falsy power to 0.4 like the engine (power:0 is well-formed, not a dead shot)', async () => {
    const zero: MoveSource = async (m, s) => ({ move: { ...(await scripted(m, s)).move, power: 0 } })
    const r = await playGame('A', 'B', 0, KEYS, { maxShots: 4 }, zero)
    expect(r.shots[0].power).toBe(0.4)                                  // coerced
    expect(r.stats[0].validMoves + r.stats[1].validMoves).toBeGreaterThan(0)
    expect(r.stats[0].illegalMoves + r.stats[1].illegalMoves).toBe(0)
  })

  it('treats null fields as malformed (not a coerced 0) but still plays', async () => {
    const nullPow: MoveSource = async (m, s) => ({ move: { ...(await scripted(m, s)).move, power: null as unknown as number } })
    const r = await playGame('A', 'B', 0, KEYS, { maxShots: 4 }, nullPow)
    expect(r.stats[0].illegalMoves + r.stats[1].illegalMoves).toBeGreaterThan(0)
    expect(r.shots[0].power).toBe(0.4)                                  // null -> 0.4, shot still played
    expect(r.stats[0].fallbackShots + r.stats[1].fallbackShots).toBe(0)
  })

  it('survives a thrown move source by recording an error + playing a fallback', async () => {
    let n = 0
    const r = await playGame('A', 'B', 0, KEYS, { maxShots: 6 }, async (m, s) => {
      if (n++ === 0) throw new Error('boom')   // first move throws; game must continue
      return scripted(m, s)
    })
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.stats[0].apiErrors).toBeGreaterThan(0)
    expect(r.stats[0].fallbackShots).toBeGreaterThan(0)
  })

  it('accumulates per-call token usage into player stats', async () => {
    const withUsage: MoveSource = async (m, s) => ({ ...(await scripted(m, s)), usage: { inputTokens: 100, outputTokens: 40 } })
    const r = await playGame('A', 'B', 0, KEYS, { maxShots: 20 }, withUsage)
    for (const st of r.stats) {
      expect(st.inputTokens).toBe(st.shots * 100)
      expect(st.outputTokens).toBe(st.shots * 40)
    }
  })
})

describe('pricing', () => {
  it('prices known models and returns null for unknown ones', () => {
    expect(costUsd('gpt-5.5', 1_000_000, 1_000_000)).toBeCloseTo(35, 6)      // $5 in + $30 out
    expect(costUsd('gpt-5.4-nano', 1_000_000, 1_000_000)).toBeCloseTo(1.45, 6)
    expect(costUsd('gpt-5.5-pro', 1000, 1000)).toBeNull()                     // variant not in table -> no fabricated price
    expect(costUsd('some-unknown-model', 1000, 1000)).toBeNull()
  })
})
