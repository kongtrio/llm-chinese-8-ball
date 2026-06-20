import {
  L, W, BR, PXPM, RAILPX, CANVAS_W, CANVAS_H, RPX, POCKETS, colorOf, isStripe,
} from './constants'
import type { Ball } from './types'

const SX = (x: number) => RAILPX + x * PXPM
const SY = (y: number) => RAILPX + y * PXPM
export const toMetres = (px: number, py: number) => ({ x: (px - RAILPX) / PXPM, y: (py - RAILPX) / PXPM })

export interface View {
  balls: Ball[]
  pointer: { x: number; y: number }   // metres
  aiming: boolean                     // human is aiming — draw guide
  placing: boolean                    // human ball-in-hand — draw ghost cue
}

export function render(ctx: CanvasRenderingContext2D, v: View) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.fillStyle = '#5a3a22'; roundRect(ctx, 0, 0, CANVAS_W, CANVAS_H, 10); ctx.fill()
  ctx.fillStyle = '#0d6b3f'; ctx.fillRect(RAILPX, RAILPX, L * PXPM, W * PXPM)
  ctx.fillStyle = '#000'
  for (const p of POCKETS) { ctx.beginPath(); ctx.arc(SX(p.x), SY(p.y), p.r * PXPM, 0, 7); ctx.fill() }

  if (v.aiming) drawAim(ctx, v.balls, v.pointer)
  if (v.placing) { ctx.globalAlpha = 0.5; drawBall(ctx, { num: 0, x: v.pointer.x, y: v.pointer.y } as Ball); ctx.globalAlpha = 1 }
  for (const b of v.balls) if (!b.potted) drawBall(ctx, b)
}

function drawBall(ctx: CanvasRenderingContext2D, b: Ball) {
  const x = SX(b.x), y = SY(b.y)
  ctx.beginPath(); ctx.arc(x, y, RPX, 0, 7); ctx.fillStyle = b.num === 0 ? '#f5f5f5' : colorOf(b.num); ctx.fill()
  if (isStripe(b.num)) {
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, RPX, 0, 7); ctx.clip()
    ctx.fillStyle = '#f5f5f5'; ctx.fillRect(x - RPX, y - RPX * 0.45, 2 * RPX, RPX * 0.9); ctx.restore()
  }
  if (b.num > 0) {
    ctx.beginPath(); ctx.arc(x, y, RPX * 0.42, 0, 7); ctx.fillStyle = '#fff'; ctx.fill()
    ctx.fillStyle = '#000'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(String(b.num), x, y + 0.5)
  }
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.arc(x, y, RPX, 0, 7); ctx.stroke()
}

function drawAim(ctx: CanvasRenderingContext2D, balls: Ball[], pointer: { x: number; y: number }) {
  const cue = balls[0]; if (cue.potted) return
  const ang = Math.atan2(pointer.y - cue.y, pointer.x - cue.x), dx = Math.cos(ang), dy = Math.sin(ang)
  let best: Ball | null = null, bt = Infinity
  for (const b of balls) {
    if (b.num === 0 || b.potted) continue
    const ox = b.x - cue.x, oy = b.y - cue.y, t = ox * dx + oy * dy; if (t < 0) continue
    const perp = Math.hypot(ox - dx * t, oy - dy * t); if (perp >= 2 * BR) continue
    const tc = t - Math.sqrt(4 * BR * BR - perp * perp); if (tc > 0 && tc < bt) { bt = tc; best = b }
  }
  const end = best ? { x: cue.x + dx * bt, y: cue.y + dy * bt } : { x: cue.x + dx * 5, y: cue.y + dy * 5 }
  ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.setLineDash([6, 6])
  ctx.beginPath(); ctx.moveTo(SX(cue.x), SY(cue.y)); ctx.lineTo(SX(end.x), SY(end.y)); ctx.stroke(); ctx.setLineDash([])
  if (best) {
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(SX(end.x), SY(end.y), RPX, 0, 7); ctx.stroke()
    const pa = Math.atan2(best.y - end.y, best.x - end.x); ctx.strokeStyle = 'rgba(255,220,120,.8)'
    ctx.beginPath(); ctx.moveTo(SX(best.x), SY(best.y)); ctx.lineTo(SX(best.x + Math.cos(pa) * 0.25), SY(best.y + Math.sin(pa) * 0.25)); ctx.stroke()
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}
