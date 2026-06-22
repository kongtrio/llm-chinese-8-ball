import { groupOf } from './types'
import type { Ball, RuntimePlayer, ShotCtx } from './types'
import { remainingOf, respot } from './table'
import { text, type Language } from '../i18n'

export interface ShotResult {
  lines: string[]
  winner: number | null // player index, or null if game continues
  keepTurn: boolean
  ballInHand: boolean
  foul: boolean
}

// Standard 8-ball, evaluated after all balls have stopped. Mutates players[].group
// (group assignment) and balls (respotting the 8 on a break). Returns what the
// engine should apply to turn state — it never touches turn order itself.
//
// Simplified vs WPA tournament rules: no called shots, no break-legality
// (4-to-rail), open-table split assigns by first potted ball. Enough for casual play.
export function evaluateShot(
  balls: Ball[],
  players: RuntimePlayer[],
  currentPlayer: number,
  isBreak: boolean,
  ctx: ShotCtx,
  lang: Language = 'en',
): ShotResult {
  const sp = players[currentPlayer],
    opp = players[1 - currentPlayer]
  const game = text[lang].game
  const lines: string[] = []
  let foul = false
  const openTable = !sp.group && !opp.group

  if (ctx.cuePotted) {
    foul = true
    lines.push(game.scratch)
  }
  if (ctx.firstHit === null) {
    foul = true
    lines.push(game.noContact)
  } else if (!isBreak) {
    if (openTable && !sp.group) {
      if (ctx.firstHit === 8) {
        foul = true
        lines.push(game.hitEightOpen)
      }
    } else if (sp.group) {
      const onEight = ctx.clearedBefore
      if (onEight && ctx.firstHit !== 8) {
        foul = true
        lines.push(game.mustHitEight)
      }
      if (!onEight && ctx.firstHit === 8) {
        foul = true
        lines.push(game.hitEightEarly)
      }
      if (!onEight && groupOf(ctx.firstHit) !== sp.group) {
        foul = true
        lines.push(game.wrongGroup)
      }
    }
  }
  if (!ctx.cuePotted && ctx.firstHit !== null && ctx.potted.length === 0 && !ctx.railAfter) {
    foul = true
    lines.push(game.noRail)
  }

  if (ctx.potted.includes(8)) {
    if (isBreak) {
      respot(balls, 8)
      lines.push(game.eightBreak)
    } else {
      const clearedNow = sp.group && remainingOf(balls, sp.group) === 0
      const win = !!(sp.group && ctx.clearedBefore && clearedNow && !foul && !ctx.cuePotted)
      lines.push(win ? game.legalEight : game.lostEight)
      return { lines, winner: win ? currentPlayer : 1 - currentPlayer, keepTurn: false, ballInHand: false, foul }
    }
  }

  if (!foul && !isBreak && openTable) {
    // group assignment (after a legal, non-break pot)
    const firstPot = ctx.potted.find((n) => n !== 8)
    if (firstPot) {
      const g = groupOf(firstPot)
      sp.group = g
      opp.group = g === 'solid' ? 'stripe' : 'solid'
      lines.push(game.groupAssigned(sp.name, g))
    }
  }

  const pottedMine = sp.group
    ? ctx.potted.filter((n) => groupOf(n) === sp.group).length
    : ctx.potted.filter((n) => n !== 8).length
  const named = ctx.potted.filter((n) => n !== 8)
  if (named.length) lines.push(game.potted(named))

  const keepTurn = !foul && pottedMine > 0
  if (keepTurn) lines.push(game.continues(sp.name))
  else {
    if (foul) lines.push(game.foul(opp.name))
    lines.push(game.turn(opp.name))
  }
  return { lines, winner: null, keepTurn, ballInHand: foul || ctx.cuePotted, foul }
}
