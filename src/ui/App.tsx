import { useEffect, useReducer, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { GameEngine } from '../game/engine'
import { CANVAS_W, CANVAS_H, colorOf, isStripe } from '../game/constants'
import { groupOf } from '../game/types'
import type { Ball, Group, PlayerConfig, PlayerType } from '../game/types'
import { SpinPad } from './SpinPad'
import { isLanguage, text, type Language } from '../i18n'

function BallChip({ n }: { n: number }) {
  const c = colorOf(n)
  const style: CSSProperties = isStripe(n)
    ? { background: `radial-gradient(circle at 32% 24%, rgba(255,255,255,.8), transparent 28%), linear-gradient(${c} 0 28%, #fff 28% 72%, ${c} 72% 100%)` }
    : { background: `radial-gradient(circle at 32% 24%, rgba(255,255,255,.75), transparent 30%), ${c}` }
  return <span className="chip" style={style}><span className="chipnum">{n}</span></span>
}

const remainingNums = (balls: Ball[], g: Group) =>
  balls.filter(b => b.num !== 0 && !b.potted && groupOf(b.num) === g).map(b => b.num).sort((a, b) => a - b)

const MODELS: [string, { value: string; label: string }[]][] = [
  ['Claude (Anthropic)', [
    { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ]],
  ['OpenAI', [
    { value: 'gpt-5', label: 'GPT-5' },
    { value: 'gpt-5-mini', label: 'GPT-5 mini' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'gpt-4o', label: 'GPT-4o' },
  ]],
]

function useLocal<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    const s = localStorage.getItem(key)
    if (s == null) return init
    try { return JSON.parse(s) as T } catch { return init }
  })
  return [v, (nv: T) => { setV(nv); localStorage.setItem(key, JSON.stringify(nv)) }]
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<GameEngine | null>(null)
  const [, force] = useReducer(x => x + 1, 0)
  const [language, setLanguage] = useLocal<Language>('pool.language.v2', 'en')
  const lang = isLanguage(language) ? language : 'en'
  const t = text[lang].ui

  const [players, setPlayers] = useLocal<PlayerConfig[]>('pool.players.v2', [
    { type: 'human', model: 'claude-opus-4-8' },
    { type: 'human', model: 'claude-sonnet-4-6' },
  ])
  const [keys, setKeys] = useLocal('pool.keys', { anthropic: '', openai: '' })
  const [spin, setSpin] = useState({ x: 0, y: 0 })

  // create engine once
  useEffect(() => {
    const eng = new GameEngine(canvasRef.current!)
    engineRef.current = eng
    eng.setLanguage(lang)
    if (import.meta.env.DEV) (window as unknown as { engine: GameEngine }).engine = eng
    eng.keys = keys; eng.ui.spinX = spin.x; eng.ui.spinY = spin.y
    const off = eng.on(force)
    eng.start(); eng.newGame(players)
    return () => { off(); eng.destroy() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // push live config into the running engine
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    document.title = lang === 'zh' ? '中式八球 - 真人 vs LLM' : 'Chinese 8-Ball - Human vs LLM'
    engineRef.current?.setLanguage(lang)
  }, [lang])
  useEffect(() => { if (engineRef.current) engineRef.current.keys = keys }, [keys])
  useEffect(() => {
    const e = engineRef.current; if (!e) return
    e.ui.spinX = spin.x; e.ui.spinY = spin.y
  }, [spin])

  const eng = engineRef.current
  const setPlayer = (i: number, patch: Partial<PlayerConfig>) =>
    setPlayers(players.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  const canvasPoint = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return {
      x: (e.clientX - r.left) * CANVAS_W / r.width,
      y: (e.clientY - r.top) * CANVAS_H / r.height,
    }
  }

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = canvasPoint(e)
    const engine = engineRef.current
    if (!engine) return
    if (engine.phase === 'aiming') engine.beginPull(p.x, p.y)
    else engine.setPointer(p.x, p.y)
  }

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = canvasPoint(e)
    const engine = engineRef.current
    if (!engine) return
    if (e.buttons && engine.phase === 'aiming') engine.updatePull(p.x, p.y)
    else engine.aimFromCursor(p.x, p.y)
  }

  const onPointerUp = () => {
    const engine = engineRef.current
    if (!engine) return
    if (engine.phase === 'ballinhand') engine.humanClick()
    else engine.endPull()
  }

  const pullPower = Math.round(((eng?.pull?.power ?? eng?.ui.power ?? 0) * 100))

  return (
    <div id="wrap">
      <div id="side">
        <div className="appHeader card">
          <div>
            <div className="eyebrow">LLM Pool Table</div>
            <h1>{lang === 'zh' ? '中式八球' : 'Chinese 8-Ball'}</h1>
          </div>
          <select className="langSelect" value={lang} aria-label={t.langLabel} onChange={e => setLanguage(e.target.value as Language)}>
            <option value="en">{t.english}</option>
            <option value="zh">{t.chinese}</option>
          </select>
        </div>

        <div className="card statusCard">
          <div id="status">{eng?.status}</div>
          <button onClick={() => engineRef.current?.newGame(players)}>{t.newGame}</button>
        </div>

        <details className="card shotCard optionPanel">
          <summary>{t.yourShot}</summary>
          <div className="optionBody">
            <label className="meterLabel"><span>{t.pullPower}</span><strong>{pullPower}%</strong></label>
            <div className="pullMeter" aria-label={t.pullPower} aria-valuenow={pullPower} role="meter">
              <span style={{ width: `${pullPower}%` }} />
            </div>
            <div className="spinpad">
              <SpinPad x={spin.x} y={spin.y} onChange={(x, y) => setSpin({ x, y })} />
              <p className="hint">{t.aimHelp}</p>
            </div>
          </div>
        </details>

        <details className="card playersCard optionPanel">
          <summary>{t.players}</summary>
          <div className="optionBody">
            <div className="playersGrid">
              {players.map((p, i) => {
                const group = eng?.players[i]?.group ?? null
                const remaining = eng && group ? remainingNums(eng.balls, group) : []
                const onEight = !!(eng && group && remaining.length === 0)
                const active = !!eng && !eng.gameOver && eng.current === i
                return (
                  <div key={i} className={'player' + (active ? ' active' : '')}>
                    <label>
                      {active && <span className="turn">▶ </span>}{t.player(i + 1)}
                      {active && <span className="turn"> · {t.toPlay}</span>}
                      {group && <span className="grouptag">{text[lang].game.group(group)}</span>}
                    </label>
                    <div className="prow">
                      <select value={p.type} onChange={e => setPlayer(i, { type: e.target.value as PlayerType })}>
                        <option value="human">{t.human}</option>
                        <option value="llm">LLM</option>
                      </select>
                      <select value={p.model} onChange={e => setPlayer(i, { model: e.target.value })}>
                        {MODELS.map(([grp, opts]) => (
                          <optgroup key={grp} label={grp}>
                            {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                    {group ? (
                      <div className="balls">
                        {onEight
                          ? <><BallChip n={8} /><span className="hint">- {t.onEightBall}</span></>
                          : remaining.map(n => <BallChip key={n} n={n} />)}
                      </div>
                    ) : <div className="balls hint">{t.groupUndecided}</div>}
                  </div>
                )
              })}
            </div>
          </div>
        </details>

        <details className="card compactPanel">
          <summary>{t.apiKeys}</summary>
          <label>{t.anthropicKey}</label>
          <input type="password" placeholder="sk-ant-..." value={keys.anthropic}
            onChange={e => setKeys({ ...keys, anthropic: e.target.value })} />
          <label>{t.openaiKey}</label>
          <input type="password" placeholder="sk-..." value={keys.openai}
            onChange={e => setKeys({ ...keys, openai: e.target.value })} />
          <p className="hint">{t.apiHelp}</p>
        </details>

        <details className="card compactPanel logPanel">
          <summary>{t.log}</summary>
          <div id="log">
            {eng?.log.map((l, i) => <div key={i} className={l.cls}>{l.text}</div>)}
          </div>
          <button style={{ marginTop: 8 }} onClick={() => engineRef.current?.clearMemory()}>
            {t.clearMemory(eng?.memory.length ?? 0)}
          </button>
          <p className="hint">{t.memoryHelp}</p>
        </details>
      </div>

      <main id="playArea">
        <div className="tableShell">
          <canvas
            ref={canvasRef} className="table" width={CANVAS_W} height={CANVAS_H}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => engineRef.current?.cancelPull()}
          />
        </div>
      </main>
    </div>
  )
}
