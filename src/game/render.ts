import { L, W, BR, PXPM, RAILPX, CANVAS_W, CANVAS_H, RPX, POCKETS, colorOf, isStripe } from './constants'
import type { Ball } from './types'

const SX = (x: number) => RAILPX + x * PXPM
const SY = (y: number) => RAILPX + y * PXPM
const TAU = Math.PI * 2

export const toMetres = (px: number, py: number) => ({ x: (px - RAILPX) / PXPM, y: (py - RAILPX) / PXPM })

export interface View {
  balls: Ball[]
  pointer: { x: number; y: number } // metres
  pull: PullView | null
  aiming: boolean // human is aiming -- draw guide
  placing: boolean // human ball-in-hand -- draw ghost cue
}

export interface PullView {
  active: boolean
  x: number
  y: number
  angle: number
  power: number
}

export function render(ctx: CanvasRenderingContext2D, v: View) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
  drawTable(ctx)

  if (v.aiming) drawAim(ctx, v.balls, v.pointer, v.pull)
  for (const b of v.balls) if (!b.potted) drawBallShadow(ctx, b)
  if (v.placing) {
    ctx.save()
    ctx.globalAlpha = 0.55
    drawBall(ctx, {
      num: 0,
      x: v.pointer.x,
      y: v.pointer.y,
      vx: 0,
      vy: 0,
      wx: 0,
      wy: 0,
      wz: 0,
      rx: 0,
      ry: 0,
      rz: 0,
      potted: false,
    })
    ctx.restore()
  }
  for (const b of v.balls) if (!b.potted) drawBall(ctx, b)
}

function drawTable(ctx: CanvasRenderingContext2D) {
  const feltX = RAILPX,
    feltY = RAILPX,
    feltW = L * PXPM,
    feltH = W * PXPM

  const rail = ctx.createLinearGradient(0, 0, 0, CANVAS_H)
  rail.addColorStop(0, '#8b5530')
  rail.addColorStop(0.18, '#4a2515')
  rail.addColorStop(0.5, '#6b3a1f')
  rail.addColorStop(1, '#2d170f')
  ctx.fillStyle = rail
  roundRect(ctx, 0, 0, CANVAS_W, CANVAS_H, 14)
  ctx.fill()

  ctx.save()
  roundRect(ctx, feltX - 5, feltY - 5, feltW + 10, feltH + 10, 8)
  ctx.clip()
  const felt = ctx.createLinearGradient(feltX, feltY, feltX + feltW, feltY + feltH)
  felt.addColorStop(0, '#095133')
  felt.addColorStop(0.46, '#0d7247')
  felt.addColorStop(1, '#063d2e')
  ctx.fillStyle = felt
  ctx.fillRect(feltX, feltY, feltW, feltH)

  ctx.globalAlpha = 0.18
  ctx.strokeStyle = '#3fb67b'
  ctx.lineWidth = 0.6
  for (let y = feltY + 10; y < feltY + feltH; y += 14) {
    ctx.beginPath()
    ctx.moveTo(feltX, y)
    ctx.lineTo(feltX + feltW, y + 10)
    ctx.stroke()
  }
  ctx.restore()

  ctx.strokeStyle = 'rgba(255,224,164,.25)'
  ctx.lineWidth = 1.2
  roundRect(ctx, feltX - 8, feltY - 8, feltW + 16, feltH + 16, 10)
  ctx.stroke()

  for (const p of POCKETS) {
    const x = SX(p.x),
      y = SY(p.y),
      r = p.r * PXPM
    const pocket = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, r * 0.2, x, y, r)
    pocket.addColorStop(0, '#1b1b1b')
    pocket.addColorStop(0.58, '#030303')
    pocket.addColorStop(1, '#000')
    ctx.fillStyle = pocket
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = 'rgba(229,178,104,.35)'
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

function drawBallShadow(ctx: CanvasRenderingContext2D, b: Ball) {
  const x = SX(b.x),
    y = SY(b.y)
  const speed = Math.hypot(b.vx, b.vy)
  const blur = Math.min(14, 4 + speed * 2.2)
  ctx.save()
  ctx.fillStyle = `rgba(0,0,0,${0.22 + Math.min(speed * 0.03, 0.18)})`
  ctx.filter = `blur(${blur}px)`
  ctx.beginPath()
  ctx.ellipse(x + 2, y + RPX * 0.55, RPX * 0.9 + speed * 0.5, RPX * 0.32, 0, 0, TAU)
  ctx.fill()
  ctx.restore()

  if (speed > 0.4) {
    const a = Math.atan2(b.vy, b.vx)
    ctx.save()
    ctx.globalAlpha = Math.min(0.28, speed * 0.05)
    ctx.strokeStyle = '#e8fff4'
    ctx.lineWidth = Math.min(5, 1.2 + speed * 0.35)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x - Math.cos(a) * RPX * 0.4, y - Math.sin(a) * RPX * 0.4)
    ctx.lineTo(
      x - Math.cos(a) * RPX * (1.2 + Math.min(speed, 4) * 0.35),
      y - Math.sin(a) * RPX * (1.2 + Math.min(speed, 4) * 0.35),
    )
    ctx.stroke()
    ctx.restore()
  }
}

function drawBall(ctx: CanvasRenderingContext2D, b: Ball) {
  const x = SX(b.x),
    y = SY(b.y),
    base = b.num === 0 ? '#f7f2e6' : colorOf(b.num)
  const face = faceOffset(b)

  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, RPX, 0, TAU)
  ctx.clip()

  ctx.fillStyle = base
  ctx.fillRect(x - RPX, y - RPX, RPX * 2, RPX * 2)

  if (isStripe(b.num)) drawStripe(ctx, b, x, y, base)
  if (b.num === 0) drawCueDots(ctx, b, x, y)
  else drawNumberPatch(ctx, b, x + face.x, y + face.y, face.scale)

  const shade = ctx.createRadialGradient(x - RPX * 0.42, y - RPX * 0.48, RPX * 0.05, x, y, RPX * 1.12)
  shade.addColorStop(0, 'rgba(255,255,255,.92)')
  shade.addColorStop(0.18, 'rgba(255,255,255,.28)')
  shade.addColorStop(0.55, 'rgba(255,255,255,0)')
  shade.addColorStop(0.82, 'rgba(0,0,0,.2)')
  shade.addColorStop(1, 'rgba(0,0,0,.55)')
  ctx.fillStyle = shade
  ctx.fillRect(x - RPX, y - RPX, RPX * 2, RPX * 2)

  ctx.restore()

  ctx.strokeStyle = 'rgba(255,255,255,.24)'
  ctx.lineWidth = 0.9
  ctx.beginPath()
  ctx.arc(x - RPX * 0.13, y - RPX * 0.13, RPX * 0.82, Math.PI * 1.08, Math.PI * 1.72)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(0,0,0,.45)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(x, y, RPX, 0, TAU)
  ctx.stroke()
}

function drawStripe(ctx: CanvasRenderingContext2D, b: Ball, x: number, y: number, base: string) {
  const bandY = Math.sin(b.rx) * RPX * 0.42
  const bandH = RPX * (0.72 + 0.18 * Math.cos(b.ry))
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(b.rz)
  ctx.fillStyle = '#fbf7ed'
  ctx.fillRect(-RPX * 1.2, bandY - bandH / 2, RPX * 2.4, bandH)
  ctx.strokeStyle = 'rgba(0,0,0,.16)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(-RPX * 1.2, bandY - bandH / 2)
  ctx.lineTo(RPX * 1.2, bandY - bandH / 2)
  ctx.moveTo(-RPX * 1.2, bandY + bandH / 2)
  ctx.lineTo(RPX * 1.2, bandY + bandH / 2)
  ctx.stroke()

  ctx.globalAlpha = 0.25
  ctx.fillStyle = base
  ctx.fillRect(-RPX * 1.2, bandY - bandH * 0.06, RPX * 2.4, bandH * 0.12)
  ctx.restore()
}

function drawCueDots(ctx: CanvasRenderingContext2D, b: Ball, x: number, y: number) {
  const dots = [
    { ax: b.ry, ay: b.rx, r: 2.4, c: '#d43127' },
    { ax: b.ry + Math.PI * 0.9, ay: b.rx + Math.PI * 0.35, r: 1.5, c: '#3076cf' },
    { ax: b.ry - Math.PI * 0.7, ay: b.rx - Math.PI * 0.25, r: 1.3, c: '#111' },
  ]
  for (const d of dots) {
    const px = Math.sin(d.ax + b.rz * 0.35) * RPX * 0.43
    const py = -Math.sin(d.ay - b.rz * 0.35) * RPX * 0.43
    const depth = 0.55 + 0.45 * Math.cos(px / RPX) * Math.cos(py / RPX)
    ctx.globalAlpha = 0.58 + depth * 0.32
    ctx.fillStyle = d.c
    ctx.beginPath()
    ctx.arc(x + px, y + py, d.r * depth, 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawNumberPatch(ctx: CanvasRenderingContext2D, b: Ball, x: number, y: number, scale: number) {
  const r = RPX * 0.42 * scale
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(b.rz * 0.22)
  ctx.fillStyle = '#fbf8ed'
  ctx.beginPath()
  ctx.ellipse(0, 0, r, r * (0.82 + scale * 0.16), 0, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,.14)'
  ctx.stroke()
  ctx.fillStyle = '#111'
  ctx.font = `700 ${Math.max(8, 9.5 * scale)}px ui-sans-serif, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(b.num), 0, 0.5)
  ctx.restore()
}

function faceOffset(b: Ball) {
  const x = Math.sin(b.ry + b.rz * 0.22) * RPX * 0.32
  const y = -Math.sin(b.rx - b.rz * 0.22) * RPX * 0.32
  const edge = Math.min(1, Math.hypot(x, y) / (RPX * 0.48))
  return { x, y, scale: 1 - edge * 0.28 }
}

function drawAim(
  ctx: CanvasRenderingContext2D,
  balls: Ball[],
  pointer: { x: number; y: number },
  pull: PullView | null,
) {
  const cue = balls[0]
  if (cue.potted) return
  const ang = pull?.active ? pull.angle : Math.atan2(pointer.y - cue.y, pointer.x - cue.x)
  const dx = Math.cos(ang),
    dy = Math.sin(ang)
  let best: Ball | null = null,
    bt = Infinity
  for (const b of balls) {
    if (b.num === 0 || b.potted) continue
    const ox = b.x - cue.x,
      oy = b.y - cue.y,
      t = ox * dx + oy * dy
    if (t < 0) continue
    const perp = Math.hypot(ox - dx * t, oy - dy * t)
    if (perp >= 2 * BR) continue
    const tc = t - Math.sqrt(4 * BR * BR - perp * perp)
    if (tc > 0 && tc < bt) {
      bt = tc
      best = b
    }
  }
  const end = best ? { x: cue.x + dx * bt, y: cue.y + dy * bt } : { x: cue.x + dx * 5, y: cue.y + dy * 5 }
  ctx.save()
  if (pull?.active) drawCuePull(ctx, cue, pull)
  ctx.strokeStyle = 'rgba(255,255,255,.68)'
  ctx.lineWidth = 1.3
  ctx.setLineDash([8, 8])
  ctx.beginPath()
  ctx.moveTo(SX(cue.x), SY(cue.y))
  ctx.lineTo(SX(end.x), SY(end.y))
  ctx.stroke()
  ctx.setLineDash([])
  ctx.strokeStyle = 'rgba(255,216,118,.75)'
  ctx.beginPath()
  ctx.arc(SX(cue.x), SY(cue.y), RPX + 4, 0, TAU)
  ctx.stroke()
  if (best) {
    const hitX = SX(end.x),
      hitY = SY(end.y),
      bestX = SX(best.x),
      bestY = SY(best.y)
    ctx.save()
    ctx.shadowColor = 'rgba(255,211,115,.7)'
    ctx.shadowBlur = 16
    ctx.strokeStyle = 'rgba(255,211,115,.95)'
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.arc(bestX, bestY, RPX + 5, 0, TAU)
    ctx.stroke()
    ctx.restore()

    ctx.fillStyle = 'rgba(255,255,255,.9)'
    ctx.beginPath()
    ctx.arc(hitX, hitY, 3.4, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,.85)'
    ctx.beginPath()
    ctx.arc(hitX, hitY, RPX, 0, TAU)
    ctx.stroke()
    const pa = Math.atan2(best.y - end.y, best.x - end.x)
    ctx.strokeStyle = 'rgba(255,220,120,.9)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(bestX, bestY)
    ctx.lineTo(SX(best.x + Math.cos(pa) * 0.25), SY(best.y + Math.sin(pa) * 0.25))
    ctx.stroke()
  }
  ctx.restore()
}

function drawCuePull(ctx: CanvasRenderingContext2D, cue: Ball, pull: PullView) {
  const cueX = SX(cue.x),
    cueY = SY(cue.y)
  const backX = SX(pull.x),
    backY = SY(pull.y)
  const dx = Math.cos(pull.angle),
    dy = Math.sin(pull.angle)
  const stickBack = 28 + pull.power * 112
  const buttX = cueX - dx * stickBack,
    buttY = cueY - dy * stickBack
  const tipX = cueX - dx * (RPX + 5),
    tipY = cueY - dy * (RPX + 5)

  ctx.save()
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(255,255,255,.2)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 8])
  ctx.beginPath()
  ctx.moveTo(cueX, cueY)
  ctx.lineTo(backX, backY)
  ctx.stroke()
  ctx.setLineDash([])

  const cueStick = ctx.createLinearGradient(buttX, buttY, tipX, tipY)
  cueStick.addColorStop(0, '#533018')
  cueStick.addColorStop(0.7, '#c79552')
  cueStick.addColorStop(1, '#f7e4b7')
  ctx.strokeStyle = cueStick
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.moveTo(buttX, buttY)
  ctx.lineTo(tipX, tipY)
  ctx.stroke()
  ctx.strokeStyle = '#1d2624'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(cueX - dx * (RPX + 1), cueY - dy * (RPX + 1))
  ctx.stroke()

  ctx.strokeStyle = `rgba(216,173,103,${0.28 + pull.power * 0.58})`
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(cueX, cueY, RPX + 12 + pull.power * 12, -Math.PI / 2, -Math.PI / 2 + TAU * pull.power)
  ctx.stroke()
  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
