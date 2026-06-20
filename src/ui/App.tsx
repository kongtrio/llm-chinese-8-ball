import { useEffect, useReducer, useRef, useState, type CSSProperties } from 'react'
import { GameEngine } from '../game/engine'
import { CANVAS_W, CANVAS_H, colorOf, isStripe } from '../game/constants'
import { groupOf } from '../game/types'
import type { Ball, Group, PlayerConfig, PlayerType } from '../game/types'
import { SpinPad } from './SpinPad'
import { isLanguage, text, type Language } from '../i18n'

function BallChip({ n }: { n: number }) {
  const c = colorOf(n)
  const style: CSSProperties = isStripe(n)
    ? { background: `linear-gradient(${c} 0 28%, #fff 28% 72%, ${c} 72% 100%)` }
    : { background: c }
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
  const [language, setLanguage] = useLocal<Language>('pool.language', 'en')
  const lang = isLanguage(language) ? language : 'en'
  const t = text[lang].ui

  const [players, setPlayers] = useLocal<PlayerConfig[]>('pool.players', [
    { type: 'human', model: 'claude-opus-4-8' },
    { type: 'llm', model: 'claude-sonnet-4-6' },
  ])
  const [keys, setKeys] = useLocal('pool.keys', { anthropic: '', openai: '' })
  const [power, setPower] = useLocal('pool.power', 0.55)
  const [spin, setSpin] = useState({ x: 0, y: 0 })

  // create engine once
  useEffect(() => {
    const eng = new GameEngine(canvasRef.current!)
    engineRef.current = eng
    eng.setLanguage(lang)
    if (import.meta.env.DEV) (window as unknown as { engine: GameEngine }).engine = eng
    eng.keys = keys; eng.ui.power = power; eng.ui.spinX = spin.x; eng.ui.spinY = spin.y
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
    e.ui.power = power; e.ui.spinX = spin.x; e.ui.spinY = spin.y
  }, [power, spin])

  const eng = engineRef.current
  const setPlayer = (i: number, patch: Partial<PlayerConfig>) =>
    setPlayers(players.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    engineRef.current?.setPointer(e.clientX - r.left, e.clientY - r.top)
  }

  return (
    <div id="wrap">
      <canvas
        ref={canvasRef} className="table" width={CANVAS_W} height={CANVAS_H}
        style={{ width: CANVAS_W, height: CANVAS_H }}
        onMouseMove={onMove} onClick={() => engineRef.current?.humanClick()}
      />
      <div id="side">
        <div className="card">
          <label>{t.langLabel}</label>
          <select value={lang} onChange={e => setLanguage(e.target.value as Language)}>
            <option value="en">{t.english}</option>
            <option value="zh">{t.chinese}</option>
          </select>
        </div>

        <div className="card">
          <div id="status">{eng?.status}</div>
          <button onClick={() => engineRef.current?.newGame(players)}>{t.newGame}</button>
        </div>

        <div className="card">
          <h3>{t.yourShot}</h3>
          <label>{t.power} {Math.round(power * 100)}%</label>
          <input type="range" min={0} max={100} value={Math.round(power * 100)}
            onChange={e => setPower(+e.target.value / 100)} />
          <div className="spinpad">
            <SpinPad x={spin.x} y={spin.y} onChange={(x, y) => setSpin({ x, y })} />
            <div className="hint">
              {t.spinHelp.map(line => <span key={line}>{line}<br /></span>)}
            </div>
          </div>
          <p className="hint">{t.aimHelp}</p>
        </div>

        <div className="card">
          <h3>{t.players}</h3>
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
          <p className="hint">{t.playerHelp}</p>
        </div>

        <div className="card">
          <h3>{t.apiKeys}</h3>
          <label>{t.anthropicKey}</label>
          <input type="password" placeholder="sk-ant-..." value={keys.anthropic}
            onChange={e => setKeys({ ...keys, anthropic: e.target.value })} />
          <label>{t.openaiKey}</label>
          <input type="password" placeholder="sk-..." value={keys.openai}
            onChange={e => setKeys({ ...keys, openai: e.target.value })} />
          <p className="hint">{t.apiHelp}</p>
        </div>

        <div className="card">
          <h3>{t.log}</h3>
          <div id="log">
            {eng?.log.map((l, i) => <div key={i} className={l.cls}>{l.text}</div>)}
          </div>
        </div>
      </div>
    </div>
  )
}
