import { useEffect, useReducer, useRef, useState } from 'react'
import { GameEngine } from '../game/engine'
import { CANVAS_W, CANVAS_H } from '../game/constants'
import type { PlayerConfig, PlayerType } from '../game/types'
import { SpinPad } from './SpinPad'

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
    const s = localStorage.getItem(key); return s == null ? init : (JSON.parse(s) as T)
  })
  return [v, (nv: T) => { setV(nv); localStorage.setItem(key, JSON.stringify(nv)) }]
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<GameEngine | null>(null)
  const [, force] = useReducer(x => x + 1, 0)

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
    if (import.meta.env.DEV) (window as unknown as { engine: GameEngine }).engine = eng
    eng.keys = keys; eng.ui.power = power; eng.ui.spinX = spin.x; eng.ui.spinY = spin.y
    const off = eng.on(force)
    eng.start(); eng.newGame(players)
    return () => { off(); eng.destroy() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // push live config into the running engine
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
          <div id="status">{eng?.status}</div>
          <button onClick={() => engineRef.current?.newGame(players)}>New Game</button>
        </div>

        <div className="card">
          <h3>Your shot</h3>
          <label>Power {Math.round(power * 100)}%</label>
          <input type="range" min={0} max={100} value={Math.round(power * 100)}
            onChange={e => setPower(+e.target.value / 100)} />
          <div className="spinpad">
            <SpinPad x={spin.x} y={spin.y} onChange={(x, y) => setSpin({ x, y })} />
            <div className="hint">Click the ball for spin:<br />horizontal = side English,<br />vertical = follow / draw.<br />Center = no spin.</div>
          </div>
          <p className="hint">Mouse to aim, click table to shoot. On a foul you get ball-in-hand — click to place the cue ball.</p>
        </div>

        <div className="card">
          <h3>Players</h3>
          {players.map((p, i) => (
            <div key={i}>
              <label>Player {i + 1}</label>
              <div className="prow">
                <select value={p.type} onChange={e => setPlayer(i, { type: e.target.value as PlayerType })}>
                  <option value="human">Human</option>
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
            </div>
          ))}
          <p className="hint">Each LLM player uses its own model — pit Claude against GPT. Applies on New Game.</p>
        </div>

        <div className="card">
          <h3>API keys (stored locally only)</h3>
          <label>Anthropic key (for Claude)</label>
          <input type="password" placeholder="sk-ant-..." value={keys.anthropic}
            onChange={e => setKeys({ ...keys, anthropic: e.target.value })} />
          <label>OpenAI key (for GPT)</label>
          <input type="password" placeholder="sk-..." value={keys.openai}
            onChange={e => setKeys({ ...keys, openai: e.target.value })} />
          <p className="hint">The browser calls each provider directly. Don't host this page publicly with a real key in it.</p>
        </div>

        <div className="card">
          <h3>Log</h3>
          <div id="log">
            {eng?.log.map((l, i) => <div key={i} className={l.cls}>{l.text}</div>)}
          </div>
        </div>
      </div>
    </div>
  )
}
