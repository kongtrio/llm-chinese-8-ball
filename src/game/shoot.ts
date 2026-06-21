import { BR, MAX_CUE } from './constants'

export interface ShotVel {
  vx: number; vy: number              // cue linear velocity (m/s)
  wx: number; wy: number; wz: number  // cue angular velocity (rad/s)
  pw: number                          // clamped power 0..1 (for shot records)
  sx: number; sy: number              // normalized spin (for shot records)
}

// Single source of truth: angle/power/spin -> cue ball linear + angular velocity.
// Shared by the browser engine (GameEngine.shoot) and the headless benchmark so both
// apply identical physics — benchmark validity depends on this matching the UI exactly.
export function computeShot(angle: number, power: number, spinX: number, spinY: number): ShotVel {
  const pw = Math.max(0, Math.min(1, power))
  const sp = pw * MAX_CUE
  let sx = spinX || 0, sy = spinY || 0
  const m = Math.hypot(sx, sy); if (m > 1) { sx /= m; sy /= m }   // no miscue
  const dx = Math.cos(angle), dy = Math.sin(angle)
  const vx = dx * sp, vy = dy * sp
  const K = 1.25                                                  // tip offset (≤0.5R) -> spin
  // wz is negated: screen y points DOWN, so right English (sx>0) is a torque toward -z (clockwise-from-
  // above maps to negative wz here). Without this, right side spin threw/rebounded to the left.
  return { vx, vy, wy: sy * K * (vx / BR), wx: -sy * K * (vy / BR), wz: -sx * K * (sp / BR), pw, sx, sy }
}
