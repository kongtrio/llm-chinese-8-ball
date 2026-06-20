import { L, W, BR, MAX_CUE, TIME_SCALE } from './constants'
import type { Ball, PlayerConfig, RuntimePlayer, ShotCtx } from './types'
import { rack, onTable, objectBalls, remainingOf, freeSpot, spotFree } from './table'
import { advance, allStopped } from './physics'
import { evaluateShot } from './rules'
import { render, toMetres } from './render'
import { getMove, buildPrompt, provider } from '../ai/llm'

export type Phase = 'aiming' | 'rolling' | 'thinking' | 'ballinhand' | 'gameover'
export interface LogLine { text: string; cls?: string }
export interface Keys { anthropic: string; openai: string }

/** Owns the whole game. Framework-agnostic: drives a canvas + emits change events. */
export class GameEngine {
  balls: Ball[] = []
  players: RuntimePlayer[] = []
  current = 0
  ballInHand = false
  isBreak = true
  phase: Phase = 'aiming'
  gameOver = false
  status = ''
  log: LogLine[] = []
  keys: Keys = { anthropic: '', openai: '' }
  pointer = { x: L / 2, y: W / 2 }     // metres, for aim
  ui = { power: 0.55, spinX: 0, spinY: 0 }

  private ctx: CanvasRenderingContext2D
  private shotCtx: ShotCtx | null = null
  private llmBusy = false
  private lastTs = 0
  private raf = 0
  private listeners = new Set<() => void>()

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!
    this.loop = this.loop.bind(this)
  }

  // --- subscription / lifecycle ---
  on(cb: () => void) { this.listeners.add(cb); return () => this.listeners.delete(cb) }
  private emit() { this.listeners.forEach(f => f()) }
  start() { this.raf = requestAnimationFrame(this.loop) }
  destroy() { cancelAnimationFrame(this.raf); this.listeners.clear() }
  private addLog(text: string, cls?: string) { this.log = [...this.log, { text, cls }]; this.emit() }

  cue() { return this.balls[0] }
  setPointer(px: number, py: number) { const m = toMetres(px, py); this.pointer.x = m.x; this.pointer.y = m.y }

  newGame(cfgs: PlayerConfig[]) {
    this.balls = rack()
    this.players = cfgs.map((c, i) => ({ ...c, group: null, name: `Player ${i + 1}` }))
    this.current = 0; this.ballInHand = false; this.isBreak = true; this.gameOver = false; this.shotCtx = null
    this.addLog('New game. Player 1 to break.')
    this.nextTurn()
  }

  /** Human click on the table: place the cue (ball-in-hand) or take the shot. */
  humanClick() {
    if (this.gameOver || this.players[this.current]?.type !== 'human') return
    if (this.phase === 'ballinhand') { this.placeCue(this.pointer.x, this.pointer.y); this.phase = 'aiming'; this.refreshStatus(); return }
    if (this.phase !== 'aiming') return
    const c = this.cue()
    this.shoot(Math.atan2(this.pointer.y - c.y, this.pointer.x - c.x), this.ui.power, this.ui.spinX, this.ui.spinY)
  }

  shoot(angle: number, power: number, spinX: number, spinY: number) {
    const c = this.cue()
    const sp = Math.max(0, Math.min(1, power)) * MAX_CUE
    let sx = spinX || 0, sy = spinY || 0; const m = Math.hypot(sx, sy); if (m > 1) { sx /= m; sy /= m }  // no miscue
    const dx = Math.cos(angle), dy = Math.sin(angle)
    c.vx = dx * sp; c.vy = dy * sp
    const K = 1.25                                   // tip offset (≤0.5R) -> spin
    c.wy = sy * K * (c.vx / BR); c.wx = -sy * K * (c.vy / BR)   // follow(+)/draw(-)
    c.wz = sx * K * (sp / BR)                                   // side English
    this.shotCtx = {
      firstHit: null, railAfter: false, potted: [], cuePotted: false,
      group: this.players[this.current].group,
      clearedBefore: this.players[this.current].group ? remainingOf(this.balls, this.players[this.current].group!) === 0 : false,
    }
    this.phase = 'rolling'; this.refreshStatus()
  }

  placeCue(x?: number, y?: number) {
    const c = this.cue()
    if (x == null || y == null || !(x > BR && x < L - BR && y > BR && y < W - BR)) {
      const d = freeSpot(this.balls, L * 0.25, W / 2); x = d.x; y = d.y
    } else if (!spotFree(this.balls, x, y, c)) { const d = freeSpot(this.balls, x, y); x = d.x; y = d.y }
    c.x = x; c.y = y; c.vx = c.vy = c.wx = c.wy = c.wz = 0; c.potted = false; this.ballInHand = false
  }

  // --- main loop ---
  private loop(ts: number) {
    const dt = this.lastTs ? Math.min((ts - this.lastTs) / 1000, 0.03) * TIME_SCALE : 0
    this.lastTs = ts
    if (this.phase === 'rolling' && this.shotCtx) {
      advance(this.balls, dt, this.shotCtx)
      if (allStopped(this.balls)) this.resolve()
    }
    const human = this.players[this.current]?.type === 'human'
    render(this.ctx, {
      balls: this.balls, pointer: this.pointer,
      aiming: human && this.phase === 'aiming',
      placing: human && this.phase === 'ballinhand',
    })
    this.raf = requestAnimationFrame(this.loop)
  }

  private resolve() {
    const ctx = this.shotCtx!
    const r = evaluateShot(this.balls, this.players, this.current, this.isBreak, ctx)
    this.isBreak = false
    this.addLog(r.lines.join(' '))
    if (r.winner !== null) {
      this.gameOver = true; this.phase = 'gameover'
      this.status = `🏆 ${this.players[r.winner].name} wins!`
      this.addLog(this.status, 'win'); this.emit(); return
    }
    if (r.keepTurn) this.ballInHand = false
    else { this.current = 1 - this.current; this.ballInHand = r.ballInHand }
    if (ctx.cuePotted) this.ballInHand = true
    this.nextTurn()
  }

  private nextTurn() {
    if (this.gameOver) return
    const p = this.players[this.current]
    if (p.type === 'llm') { this.phase = 'thinking'; this.refreshStatus(); void this.doLLMTurn() }
    else { this.phase = this.ballInHand ? 'ballinhand' : 'aiming'; this.refreshStatus() }
  }

  private refreshStatus() {
    if (this.gameOver) return
    const p = this.players[this.current]
    const g = p.group ? p.group + 's' : (this.isBreak ? 'break' : 'open table')
    let s = `${p.name} (${p.type}) — ${g}.`
    if (this.ballInHand) s += ' Ball-in-hand.'
    if (this.phase === 'thinking') s += ' Thinking…'
    this.status = s; this.emit()
  }

  private async doLLMTurn() {
    if (this.llmBusy) return
    this.llmBusy = true
    const model = this.players[this.current].model, prov = provider(model)
    const key = (prov === 'anthropic' ? this.keys.anthropic : this.keys.openai).trim()
    if (!key) { this.addLog(`No ${prov === 'anthropic' ? 'Anthropic' : 'OpenAI'} key — add one or set this player to Human.`, 'err'); this.llmBusy = false; return }
    try {
      const snap = {
        group: this.players[this.current].group, isBreak: this.isBreak, ballInHand: this.ballInHand,
        cue: { x: this.cue().x, y: this.cue().y }, balls: this.balls,
      }
      const mv = await getMove(model, key, buildPrompt(snap))
      this.addLog(`${this.players[this.current].name} (${model}): ${mv.reasoning || '(no reasoning)'}`, 'you')
      this.addLog(`  angle=${(+mv.angle_degrees || 0).toFixed(0)}° power=${(+mv.power || 0).toFixed(2)} spin=(${(+mv.spin_x || 0).toFixed(1)},${(+mv.spin_y || 0).toFixed(1)})`)
      if (this.ballInHand) this.placeCue(mv.cue_x == null ? undefined : mv.cue_x / 100, mv.cue_y == null ? undefined : mv.cue_y / 100)
      this.llmBusy = false
      setTimeout(() => this.shoot((+mv.angle_degrees || 0) * Math.PI / 180, +mv.power || 0.4, +mv.spin_x || 0, +mv.spin_y || 0), 250)
    } catch (e: any) {
      this.addLog('LLM error: ' + e.message, 'err'); this.llmBusy = false
      if (this.ballInHand) this.placeCue()
      this.fallbackShot()
    }
  }

  // ponytail: dumb-but-legal shot so an API failure never stalls the game
  private fallbackShot() {
    const c = this.cue(), grp = this.players[this.current].group
    const t = objectBalls(this.balls).filter(onTable).filter(b => !grp || b.num !== 8 && (grp === 'solid' ? b.num < 8 : b.num > 8))[0]
      || objectBalls(this.balls).filter(onTable)[0]
    const ang = t ? Math.atan2(t.y - c.y, t.x - c.x) : 0
    this.addLog('Falling back to a straight shot at the nearest legal ball.', 'err')
    this.shoot(ang, 0.5, 0, 0)
  }
}
