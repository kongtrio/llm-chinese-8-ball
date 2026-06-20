import {
  BR, L, W, G, MU_SLIDE, MU_ROLL, MU_BALL, E_BALL, E_CUSH,
  RAIL_SPIN, RAIL_SPIN_DECAY, TAU_SPIN, DT, V_STOP, SLIP_EPS, W_STOP, POCKETS,
} from './constants'
import type { Ball, ShotCtx } from './types'

const onTable = (b: Ball) => !b.potted

// contact-point (bottom of ball) velocity — drives the friction model
const slip = (b: Ball) => ({ x: b.vx - BR * b.wy, y: b.vy + BR * b.wx })

export function integrate(b: Ball, dt: number) {
  const u = slip(b), s = Math.hypot(u.x, u.y)
  if (s > SLIP_EPS) {                       // sliding: kinetic friction opposes slip
    const fx = -MU_SLIDE * G * u.x / s, fy = -MU_SLIDE * G * u.y / s
    b.vx += fx * dt; b.vy += fy * dt
    b.wx += (5 * fy / (2 * BR)) * dt        // torque from contact friction, I = 2/5 m R^2
    b.wy += (-5 * fx / (2 * BR)) * dt
  } else {                                   // rolling: rolling resistance opposes v
    const v = Math.hypot(b.vx, b.vy)
    if (v > 0) { const nv = Math.max(0, v - MU_ROLL * G * dt); b.vx *= nv / v; b.vy *= nv / v }
    b.wy = b.vx / BR; b.wx = -b.vy / BR     // enforce pure roll
  }
  b.wz *= Math.exp(-dt / TAU_SPIN)          // spinning (vertical) friction
  b.x += b.vx * dt; b.y += b.vy * dt
  const sl = slip(b)
  if (Math.hypot(b.vx, b.vy) < V_STOP && Math.hypot(sl.x, sl.y) < V_STOP && Math.abs(b.wz) < W_STOP)
    b.vx = b.vy = b.wx = b.wy = b.wz = 0
}

function cushion(b: Ball, ctx: ShotCtx) {
  if (POCKETS.some(p => Math.hypot(b.x - p.x, b.y - p.y) < p.r + BR + 0.01)) return  // pocket mouth
  let hit = false
  if (b.x < BR) { b.x = BR; b.vx = -b.vx * E_CUSH; b.vy += RAIL_SPIN * BR * b.wz; b.wz *= RAIL_SPIN_DECAY; hit = true }
  else if (b.x > L - BR) { b.x = L - BR; b.vx = -b.vx * E_CUSH; b.vy -= RAIL_SPIN * BR * b.wz; b.wz *= RAIL_SPIN_DECAY; hit = true }
  if (b.y < BR) { b.y = BR; b.vy = -b.vy * E_CUSH; b.vx -= RAIL_SPIN * BR * b.wz; b.wz *= RAIL_SPIN_DECAY; hit = true }
  else if (b.y > W - BR) { b.y = W - BR; b.vy = -b.vy * E_CUSH; b.vx += RAIL_SPIN * BR * b.wz; b.wz *= RAIL_SPIN_DECAY; hit = true }
  if (hit && ctx.firstHit !== null) ctx.railAfter = true
}

export function collide(a: Ball, b: Ball, ctx: ShotCtx) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy)
  if (d === 0 || d >= 2 * BR) return
  const nx = dx / d, ny = dy / d, tx = -ny, ty = nx
  const ov = 2 * BR - d; a.x -= nx * ov / 2; a.y -= ny * ov / 2; b.x += nx * ov / 2; b.y += ny * ov / 2
  const dvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
  if (dvn >= 0) return                      // separating
  const jn = -(1 + E_BALL) * dvn / 2        // equal-mass normal impulse (per unit mass)
  a.vx -= jn * nx; a.vy -= jn * ny; b.vx += jn * nx; b.vy += jn * ny
  // collision-induced throw: tangential friction incl. side spin at contact
  const relT = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty - BR * (a.wz + b.wz)
  const cap = MU_BALL * Math.abs(jn)
  const jt = Math.max(-cap, Math.min(cap, -relT / 2))
  a.vx -= jt * tx; a.vy -= jt * ty; b.vx += jt * tx; b.vy += jt * ty
  a.wz *= 0.95; b.wz *= 0.95
  if (a.num === 0 || b.num === 0) {
    const obj = a.num === 0 ? b : a
    if (ctx.firstHit === null) ctx.firstHit = obj.num
  }
}

function substep(balls: Ball[], dt: number, ctx: ShotCtx) {
  for (const b of balls) if (onTable(b)) integrate(b, dt)
  for (const b of balls) {                  // pockets
    if (!onTable(b)) continue
    for (const p of POCKETS) if (Math.hypot(b.x - p.x, b.y - p.y) < p.r) {
      b.potted = true; b.vx = b.vy = b.wx = b.wy = b.wz = 0
      if (b.num === 0) ctx.cuePotted = true; else ctx.potted.push(b.num)
      break
    }
  }
  for (const b of balls) if (onTable(b)) cushion(b, ctx)
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i]; if (!onTable(a)) continue
    for (let j = i + 1; j < balls.length; j++) { const b = balls[j]; if (onTable(b)) collide(a, b, ctx) }
  }
}

export function advance(balls: Ball[], seconds: number, ctx: ShotCtx) {
  let t = seconds
  while (t > 1e-9) { const dt = Math.min(DT, t); substep(balls, dt, ctx); t -= dt }
}

export function allStopped(balls: Ball[]) {
  return balls.every(b => {
    if (!onTable(b)) return true
    const sl = slip(b)
    return Math.hypot(b.vx, b.vy) < V_STOP && Math.hypot(sl.x, sl.y) < V_STOP
  })
}
