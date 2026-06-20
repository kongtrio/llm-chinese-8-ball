import { L, W, BR, CANVAS_W, CANVAS_H, MAX_CUE, TIME_SCALE } from './constants'
import type { Ball, PlayerConfig, RuntimePlayer, ShotCtx } from './types'
import { rack, onTable, objectBalls, remainingOf, freeSpot, spotFree } from './table'
import { advance, allStopped } from './physics'
import { evaluateShot } from './rules'
import { render, toMetres, type PullView } from './render'
import { getMove, buildPrompt, provider } from '../ai/llm'
import { loadMemory, saveMemory, clearMemory as clearMemoryStore, nextGameId, formatHistory, type ShotRecord } from '../ai/memory'
import { text, type Language } from '../i18n'

type PendingShot = Omit<ShotRecord, 'game' | 'firstHit' | 'potted' | 'cuePotted' | 'foul' | 'cueEnd'>

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
  memory: ShotRecord[] = loadMemory()
  keys: Keys = { anthropic: '', openai: '' }
  language: Language = 'en'
  pointer = { x: L / 2, y: W / 2 }     // metres, for aim
  ui = { power: 0, spinX: 0, spinY: 0 }
  pull: PullView | null = null

  private ctx: CanvasRenderingContext2D
  private shotCtx: ShotCtx | null = null
  private pending: PendingShot | null = null
  private gameId = 0
  private llmBusy = false
  private lastTs = 0
  private raf = 0
  private listeners = new Set<() => void>()

  constructor(canvas: HTMLCanvasElement) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    canvas.width = Math.round(CANVAS_W * dpr)
    canvas.height = Math.round(CANVAS_H * dpr)
    this.ctx = canvas.getContext('2d')!
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.ctx.imageSmoothingEnabled = true
    this.loop = this.loop.bind(this)
  }

  // --- subscription / lifecycle ---
  on(cb: () => void) { this.listeners.add(cb); return () => this.listeners.delete(cb) }
  private emit() { this.listeners.forEach(f => f()) }
  start() { this.raf = requestAnimationFrame(this.loop) }
  destroy() { cancelAnimationFrame(this.raf); this.listeners.clear() }
  private addLog(text: string, cls?: string) { this.log = [...this.log, { text, cls }]; this.emit() }

  cue() { return this.balls[0] }
  clearMemory() { this.memory = []; clearMemoryStore(); this.emit() }
  resetAimLine() {
    const c = this.cue()
    this.pointer = { x: Math.min(L - BR, c.x + 1), y: c.y }
  }
  setPointer(px: number, py: number) { const m = toMetres(px, py); this.pointer.x = m.x; this.pointer.y = m.y }
  aimFromCursor(px: number, py: number) {
    if (this.phase !== 'aiming' || this.players[this.current]?.type !== 'human') {
      this.setPointer(px, py)
      return
    }
    const c = this.cue()
    const p = toMetres(px, py)
    const dx = c.x - p.x, dy = c.y - p.y
    const dist = Math.hypot(dx, dy)
    if (dist < 0.01) this.resetAimLine()
    else this.pointer = { x: c.x + dx / dist, y: c.y + dy / dist }
  }
  beginPull(px: number, py: number) {
    if (this.gameOver || this.players[this.current]?.type !== 'human') return
    this.setPointer(px, py)
    if (this.phase !== 'aiming') return
    this.updatePull(px, py)
  }
  updatePull(px: number, py: number) {
    this.setPointer(px, py)
    if (this.phase !== 'aiming' || this.players[this.current]?.type !== 'human') return
    const c = this.cue()
    const p = toMetres(px, py)
    const dx = c.x - p.x, dy = c.y - p.y
    const dist = Math.hypot(dx, dy)
    if (dist < 0.01) {
      this.pull = { active: true, x: p.x, y: p.y, angle: Math.atan2(this.pointer.y - c.y, this.pointer.x - c.x), power: 0 }
    } else {
      this.pull = { active: true, x: p.x, y: p.y, angle: Math.atan2(dy, dx), power: Math.min(1, dist / 0.58) }
      this.pointer = { x: c.x + Math.cos(this.pull.angle), y: c.y + Math.sin(this.pull.angle) }
    }
    this.ui.power = this.pull.power
    this.emit()
  }
  endPull() {
    if (!this.pull?.active || this.phase !== 'aiming' || this.players[this.current]?.type !== 'human') {
      this.pull = null
      return
    }
    const { angle, power } = this.pull
    this.pull = null
    if (power < 0.04) { this.resetAimLine(); this.emit(); return }
    this.shoot(angle, power, this.ui.spinX, this.ui.spinY)
  }
  cancelPull() { this.pull = null; this.resetAimLine(); this.emit() }
  setLanguage(language: Language) {
    this.language = language
    this.players = this.players.map((p, i) => ({ ...p, name: text[language].game.player(i + 1) }))
    this.relocalizeStaticLogs()
    this.refreshStatus()
  }

  private relocalizeStaticLogs() {
    const newGameLines = [text.en.game.newGame, text.zh.game.newGame]
    this.log = this.log.map(line =>
      newGameLines.some(newGameLine => newGameLine === line.text)
        ? { ...line, text: text[this.language].game.newGame }
        : line)
  }

  newGame(cfgs: PlayerConfig[]) {
    const game = text[this.language].game
    this.balls = rack()
    this.resetAimLine()
    this.players = cfgs.map((c, i) => ({ ...c, group: null, name: game.player(i + 1) }))
    this.current = 0; this.ballInHand = false; this.isBreak = true; this.gameOver = false; this.shotCtx = null
    this.gameId = nextGameId()       // memory persists across games; tag records by game
    this.addLog(game.newGame)
    this.nextTurn()
  }

  /** Human click on the table: place the cue (ball-in-hand) or take the shot. */
  humanClick() {
    if (this.gameOver || this.players[this.current]?.type !== 'human') return
    if (this.phase === 'ballinhand') { this.placeCue(this.pointer.x, this.pointer.y); this.phase = 'aiming'; this.resetAimLine(); this.refreshStatus(); return }
  }

  shoot(angle: number, power: number, spinX: number, spinY: number, intent?: string) {
    const c = this.cue()
    const pw = Math.max(0, Math.min(1, power))
    const sp = pw * MAX_CUE
    let sx = spinX || 0, sy = spinY || 0; const m = Math.hypot(sx, sy); if (m > 1) { sx /= m; sy /= m }  // no miscue
    const dx = Math.cos(angle), dy = Math.sin(angle)
    const p = this.players[this.current]
    this.pending = {                                 // captured now; completed with the outcome in resolve()
      player: this.current, who: p.name, model: p.type === 'llm' ? p.model : null,
      group: p.group as 'solid' | 'stripe' | null, cue: { x: Math.round(c.x * 100), y: Math.round(c.y * 100) },
      aim: ((angle * 180 / Math.PI) % 360 + 360) % 360, power: pw, sx, sy, intent,
    }
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
    c.x = x; c.y = y; c.vx = c.vy = c.wx = c.wy = c.wz = 0; c.rx = c.ry = c.rz = 0; c.potted = false; this.ballInHand = false
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
      balls: this.balls, pointer: this.pointer, pull: this.pull,
      aiming: human && this.phase === 'aiming',
      placing: human && this.phase === 'ballinhand',
    })
    this.raf = requestAnimationFrame(this.loop)
  }

  private resolve() {
    const ctx = this.shotCtx!
    const game = text[this.language].game
    const r = evaluateShot(this.balls, this.players, this.current, this.isBreak, ctx, this.language)
    this.isBreak = false
    this.addLog(r.lines.join(' '))
    if (this.pending) {                              // complete the shot record with its outcome
      const cb = this.cue()
      this.memory = [...this.memory, {
        ...this.pending, game: this.gameId,
        firstHit: ctx.firstHit, potted: [...ctx.potted], cuePotted: ctx.cuePotted, foul: r.foul,
        cueEnd: { x: Math.round(cb.x * 100), y: Math.round(cb.y * 100) },
      }]
      saveMemory(this.memory); this.pending = null
    }
    if (r.winner !== null) {
      this.gameOver = true; this.phase = 'gameover'
      this.status = game.wins(this.players[r.winner].name)
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
    else {
      this.phase = this.ballInHand ? 'ballinhand' : 'aiming'
      if (this.phase === 'aiming') this.resetAimLine()
      this.refreshStatus()
    }
  }

  private refreshStatus() {
    if (this.gameOver) return
    const p = this.players[this.current]
    if (!p) return
    const game = text[this.language].game
    const g = p.group ? game.group(p.group) : (this.isBreak ? game.break : game.openTable)
    let s = `${p.name} (${game.playerType(p.type)}) - ${g}.`
    if (this.ballInHand) s += ` ${game.ballInHand}`
    if (this.phase === 'thinking') s += ` ${game.thinking}`
    this.status = s; this.emit()
  }

  private async doLLMTurn() {
    if (this.llmBusy) return
    this.llmBusy = true
    const game = text[this.language].game
    const model = this.players[this.current].model, prov = provider(model)
    const key = (prov === 'anthropic' ? this.keys.anthropic : this.keys.openai).trim()
    if (!key) { this.addLog(game.noKey(prov === 'anthropic' ? 'Anthropic' : 'OpenAI'), 'err'); this.llmBusy = false; return }
    try {
      const snap = {
        group: this.players[this.current].group, isBreak: this.isBreak, ballInHand: this.ballInHand,
        cue: { x: this.cue().x, y: this.cue().y }, balls: this.balls,
        history: formatHistory(this.memory, this.current, this.gameId),
      }
      const mv = await getMove(model, key, buildPrompt(snap))
      this.addLog(`${this.players[this.current].name} (${model}): ${mv.reasoning || game.noReasoning}`, 'you')
      this.addLog(game.shotParams(
        (+mv.angle_degrees || 0).toFixed(0),
        (+mv.power || 0).toFixed(2),
        (+mv.spin_x || 0).toFixed(1),
        (+mv.spin_y || 0).toFixed(1),
      ))
      if (this.ballInHand) this.placeCue(mv.cue_x == null ? undefined : mv.cue_x / 100, mv.cue_y == null ? undefined : mv.cue_y / 100)
      this.llmBusy = false
      const intent = mv.reasoning?.slice(0, 80)
      setTimeout(() => this.shoot((+mv.angle_degrees || 0) * Math.PI / 180, +mv.power || 0.4, +mv.spin_x || 0, +mv.spin_y || 0, intent), 250)
    } catch (e: any) {
      this.addLog(game.llmError(e.message), 'err'); this.llmBusy = false
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
    this.addLog(text[this.language].game.fallback, 'err')
    this.shoot(ang, 0.5, 0, 0)
  }
}
