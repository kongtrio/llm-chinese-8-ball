// Realistic Chinese 8-ball (中式八球) geometry. Playing area 2540 x 1270 mm (exactly 2:1),
// ball Ø 57.15 mm. Everything internal is in SI units (metres, seconds); px is render-only.
export const L = 2.54,
  W = 1.27,
  BR = 0.028575 // metres
export const PXPM = 900 / L // px per metre (table drawn 900px long)
export const RAILPX = 28
export const CANVAS_W = Math.round(L * PXPM) + 2 * RAILPX
export const CANVAS_H = Math.round(W * PXPM) + 2 * RAILPX
export const RPX = BR * PXPM

// pockets: 4 corners + 2 side-middles, tight (capture radius, metres)
export const POCK_C = 0.06,
  POCK_M = 0.067
export const POCKETS = [
  { x: 0, y: 0, r: POCK_C },
  { x: L, y: 0, r: POCK_C },
  { x: 0, y: W, r: POCK_C },
  { x: L, y: W, r: POCK_C },
  { x: L / 2, y: 0, r: POCK_M },
  { x: L / 2, y: W, r: POCK_M },
]

// physics constants (SI)
export const G = 9.8,
  MU_SLIDE = 0.2,
  MU_ROLL = 0.012,
  MU_BALL = 0.06
export const E_BALL = 0.95,
  E_CUSH = 0.86
export const RAIL_SPIN = 0.4,
  RAIL_SPIN_DECAY = 0.55,
  TAU_SPIN = 4.0
export const MAX_CUE = 7.0 // m/s at power=1
// SLIP_EPS: below this contact-slip speed the ball is treated as rolling. Must sit above the
// per-substep slip change (~3.5·μ·g·DT ≈ 0.011 m/s) or the sliding solver oscillates and never settles.
export const DT = 1 / 600,
  V_STOP = 0.008,
  SLIP_EPS = 0.02,
  W_STOP = 0.4,
  TIME_SCALE = 1.3

export const BASECOLORS: Record<number, string> = {
  1: '#e6b800',
  2: '#1f4fd1',
  3: '#d11f1f',
  4: '#6a1fb0',
  5: '#e07b1f',
  6: '#1f8f3a',
  7: '#7a1f2b',
  8: '#111',
}
export const colorOf = (n: number) => (n === 8 ? '#111' : BASECOLORS[n > 8 ? n - 8 : n])
export const isStripe = (n: number) => n > 8
