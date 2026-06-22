import { describe, expect, it } from 'vitest'
import { chooseFallbackTarget } from './fallback'
import { evaluateShot } from './rules'
import { rack } from './table'
import type { RuntimePlayer, ShotCtx } from './types'

const players = (): [RuntimePlayer, RuntimePlayer] => [
  { type: 'human', model: '', group: null, name: 'Player 1' },
  { type: 'human', model: '', group: null, name: 'Player 2' },
]

const shot = (patch: Partial<ShotCtx>): ShotCtx => ({
  firstHit: 1,
  railAfter: false,
  potted: [],
  cuePotted: false,
  group: null,
  clearedBefore: false,
  ...patch,
})

describe('rules', () => {
  it('assigns groups after a legal open-table pot', () => {
    const balls = rack()
    const ps = players()
    const r = evaluateShot(balls, ps, 0, false, shot({ potted: [1] }))

    expect(r.foul).toBe(false)
    expect(r.keepTurn).toBe(true)
    expect(ps[0].group).toBe('solid')
    expect(ps[1].group).toBe('stripe')
  })

  it('does not assign groups when the pot came with a foul', () => {
    const balls = rack()
    const ps = players()
    const r = evaluateShot(balls, ps, 0, false, shot({ cuePotted: true, potted: [1] }))

    expect(r.foul).toBe(true)
    expect(r.ballInHand).toBe(true)
    expect(ps[0].group).toBeNull()
    expect(ps[1].group).toBeNull()
  })

  it('does not assign groups before resolving an illegal 8-ball pot', () => {
    const balls = rack()
    const ps = players()
    const r = evaluateShot(balls, ps, 0, false, shot({ potted: [1, 8] }))

    expect(r.winner).toBe(1)
    expect(ps[0].group).toBeNull()
    expect(ps[1].group).toBeNull()
  })
})

describe('fallback target selection', () => {
  it('uses the 8 on an open table only when no non-8 target remains', () => {
    const balls = rack()
    balls
      .filter((b) => b.num !== 0 && b.num !== 8)
      .forEach((b) => {
        b.potted = true
      })

    expect(chooseFallbackTarget(balls, null)?.num).toBe(8)

    balls.find((b) => b.num === 1)!.potted = false
    expect(chooseFallbackTarget(balls, null)?.num).toBe(1)
  })

  it('chooses the 8 only after the shooter has cleared their group', () => {
    const balls = rack()
    balls
      .filter((b) => b.num > 0 && b.num < 8)
      .forEach((b) => {
        b.potted = true
      })

    expect(chooseFallbackTarget(balls, 'solid')?.num).toBe(8)
  })
})
