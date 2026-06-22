// Persistent shot memory: every shot's intent + parameters + outcome, stored in
// localStorage so the LLM can learn (in-context) from what worked and what fouled.
export interface ShotRecord {
  game: number
  player: number
  who: string // player name
  model: string | null // null for human shots
  group: 'solid' | 'stripe' | null
  cue: { x: number; y: number } // cm, before the shot
  aim: number // degrees
  power: number
  sx: number
  sy: number // spin
  intent?: string // the LLM's stated plan
  firstHit: number | null
  potted: number[]
  cuePotted: boolean
  foul: boolean
  cueEnd: { x: number; y: number } // cm, where the cue stopped
}

const KEY = 'pool.memory',
  GKEY = 'pool.gameId',
  MAX = 80
const ls = () => (typeof localStorage !== 'undefined' ? localStorage : null)

export function loadMemory(): ShotRecord[] {
  try {
    return JSON.parse(ls()?.getItem(KEY) || '[]')
  } catch {
    return []
  }
}
export function saveMemory(m: ShotRecord[]) {
  ls()?.setItem(KEY, JSON.stringify(m.slice(-MAX)))
}
export function clearMemory() {
  ls()?.removeItem(KEY)
}
export function nextGameId(): number {
  const n = +(ls()?.getItem(GKEY) || '0') + 1
  ls()?.setItem(GKEY, String(n))
  return n
}

/** Format recent shots for the prompt — the LLM's learning signal. */
export function formatHistory(records: ShotRecord[], currentPlayer: number, currentGame: number, n = 10): string {
  if (!records.length) return 'No prior shots recorded yet.'
  const lines = records.slice(-n).map((r) => {
    const who = r.player === currentPlayer ? 'YOU' : 'OPP'
    const tag = r.game !== currentGame ? ' (earlier game)' : ''
    const res = [
      r.firstHit == null ? 'no contact' : `first hit ${r.firstHit}`,
      r.potted.length ? `potted ${r.potted.join(',')}` : 'potted nothing',
      r.cuePotted ? 'SCRATCH' : null,
      r.foul ? 'FOUL' : null,
    ]
      .filter(Boolean)
      .join(', ')
    const plan = r.intent ? ` plan:"${r.intent.slice(0, 60)}"` : ''
    return (
      `- ${who}[${r.group || 'open'}]${tag} cue(${r.cue.x},${r.cue.y}) aim ${Math.round(r.aim)}° ` +
      `pow ${r.power.toFixed(2)} spin(${r.sx.toFixed(1)},${r.sy.toFixed(1)})${plan} => ${res}; cue ended (${r.cueEnd.x},${r.cueEnd.y})`
    )
  })
  return (
    'Recent shots (oldest first). Learn from these — adjust aim/power if a similar shot missed or fouled:\n' +
    lines.join('\n')
  )
}
