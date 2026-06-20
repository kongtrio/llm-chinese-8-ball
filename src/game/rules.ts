import { groupOf } from './types'
import type { Ball, RuntimePlayer, ShotCtx } from './types'
import { remainingOf, respot } from './table'

export interface ShotResult {
  lines: string[]
  winner: number | null       // player index, or null if game continues
  keepTurn: boolean
  ballInHand: boolean
}

// Standard 8-ball, evaluated after all balls have stopped. Mutates players[].group
// (group assignment) and balls (respotting the 8 on a break). Returns what the
// engine should apply to turn state — it never touches turn order itself.
//
// ponytail: simplified vs WPA tournament rules — no called shots, no break-legality
// (4-to-rail), open-table split assigns by first potted ball. Enough for casual play.
export function evaluateShot(
  balls: Ball[], players: RuntimePlayer[], currentPlayer: number, isBreak: boolean, ctx: ShotCtx,
): ShotResult {
  const sp = players[currentPlayer], opp = players[1 - currentPlayer]
  const lines: string[] = []
  let foul = false
  const openTable = !sp.group && !opp.group

  if (!isBreak && openTable && !ctx.cuePotted) {     // group assignment (after the break)
    const firstPot = ctx.potted.find(n => n !== 8)
    if (firstPot) {
      const g = groupOf(firstPot)
      sp.group = g; opp.group = g === 'solid' ? 'stripe' : 'solid'
      lines.push(`${sp.name} is ${g}s.`)
    }
  }

  if (ctx.cuePotted) { foul = true; lines.push('Scratch (cue pocketed).') }
  if (ctx.firstHit === null) { foul = true; lines.push('No ball contacted.') }
  else if (!isBreak) {
    if (openTable && !sp.group) {
      if (ctx.firstHit === 8) { foul = true; lines.push('Hit the 8 on an open table.') }
    } else if (sp.group) {
      const onEight = ctx.clearedBefore
      if (onEight && ctx.firstHit !== 8) { foul = true; lines.push('Must hit the 8 first.') }
      if (!onEight && ctx.firstHit === 8) { foul = true; lines.push('Hit the 8 too early.') }
      if (!onEight && groupOf(ctx.firstHit) !== sp.group) { foul = true; lines.push('Hit the wrong group first.') }
    }
  }
  if (!ctx.cuePotted && ctx.firstHit !== null && ctx.potted.length === 0 && !ctx.railAfter) {
    foul = true; lines.push('No rail after contact.')
  }

  if (ctx.potted.includes(8)) {
    if (isBreak) { respot(balls, 8); lines.push('8 on the break — respotted.') }
    else {
      const clearedNow = sp.group && remainingOf(balls, sp.group) === 0
      const win = !!(sp.group && ctx.clearedBefore && clearedNow && !foul && !ctx.cuePotted)
      lines.push(win ? 'Potted the 8 legally.' : 'Lost on the 8.')
      return { lines, winner: win ? currentPlayer : 1 - currentPlayer, keepTurn: false, ballInHand: false }
    }
  }

  const pottedMine = sp.group
    ? ctx.potted.filter(n => groupOf(n) === sp.group).length
    : ctx.potted.filter(n => n !== 8).length
  const named = ctx.potted.filter(n => n !== 8)
  if (named.length) lines.push('Potted ' + named.join(', ') + '.')

  const keepTurn = !foul && pottedMine > 0
  if (keepTurn) lines.push(`${sp.name} continues.`)
  else {
    if (foul) lines.push(`Foul — ${opp.name} has ball-in-hand.`)
    lines.push(`${opp.name}'s turn.`)
  }
  return { lines, winner: null, keepTurn, ballInHand: foul || ctx.cuePotted }
}
