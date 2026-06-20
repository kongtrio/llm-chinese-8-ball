export type Group = 'solid' | 'stripe' | 'eight'
export const groupOf = (n: number): Group => (n === 8 ? 'eight' : n < 8 ? 'solid' : 'stripe')

export interface Ball {
  num: number                 // 0 = cue
  x: number; y: number        // position (m)
  vx: number; vy: number      // linear velocity (m/s)
  wx: number; wy: number; wz: number  // angular velocity (rad/s); wz = vertical (side English)
  rx: number; ry: number; rz: number  // visual orientation (rad)
  potted: boolean
}

export interface ShotCtx {
  firstHit: number | null     // first object ball the cue touched
  railAfter: boolean          // a ball reached a cushion after contact
  potted: number[]            // object balls potted this shot
  cuePotted: boolean
  group: Group | null         // shooter's group at shot time
  clearedBefore: boolean      // shooter had cleared their group before this shot
}

export type PlayerType = 'human' | 'llm'
export interface PlayerConfig { type: PlayerType; model: string }
export interface RuntimePlayer extends PlayerConfig { group: Group | null; name: string }

export interface Move {
  reasoning?: string
  angle_degrees: number
  power: number
  spin_x: number
  spin_y: number
  cue_x?: number              // ball-in-hand placement, cm
  cue_y?: number
}

export const mkBall = (num: number, x: number, y: number): Ball =>
  ({ num, x, y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, rx: 0, ry: 0, rz: 0, potted: false })
