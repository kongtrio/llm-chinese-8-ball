import { L, W, BR, POCKETS } from '../game/constants'
import { groupOf } from '../game/types'
import type { Ball, Group, Move } from '../game/types'

export const provider = (model: string): 'anthropic' | 'openai' =>
  model.startsWith('claude') ? 'anthropic' : 'openai'

const TOOL = {
  name: 'shoot',
  description: 'Aim and strike the cue ball.',
  input_schema: {
    type: 'object',
    properties: {
      reasoning: { type: 'string', description: 'Brief plan: target ball, pocket, why.' },
      angle_degrees: { type: 'number', description: 'Cue-ball travel direction. 0=right(+x), 90=down(+y), 180=left, 270=up. Clockwise (y points down).' },
      power: { type: 'number', description: '0 soft … 1 full break speed.' },
      spin_x: { type: 'number', description: 'Side English: -1 left, 0 none, +1 right.' },
      spin_y: { type: 'number', description: '+1 follow/topspin, -1 draw/backspin, 0 stun.' },
      cue_x: { type: 'number', description: 'Only with ball-in-hand: cue x in cm (0..254).' },
      cue_y: { type: 'number', description: 'Only with ball-in-hand: cue y in cm (0..127).' },
    },
    required: ['reasoning', 'angle_degrees', 'power', 'spin_x', 'spin_y'],
  },
}

export interface Snapshot {
  group: Group | null
  isBreak: boolean
  ballInHand: boolean
  cue: { x: number; y: number }
  balls: Ball[]
}

export function buildPrompt(s: Snapshot): string {
  const cm = (v: number) => Math.round(v * 100)
  const o: string[] = []
  o.push('You are playing 8-ball pool (top-down 2D). It is your turn.')
  o.push(`Table play area is ${cm(L)}x${cm(W)} cm. Origin top-left, +x right, +y DOWN. Ball radius ${cm(BR)} cm (diameter ${(BR * 200).toFixed(1)} cm).`)
  o.push('Pockets (x,y cm): ' + POCKETS.map(p => `(${cm(p.x)},${cm(p.y)})`).join(' ') + '. Pockets are tight.')
  o.push('Your group: ' + (s.group ? s.group + 's' : (s.isBreak ? 'BREAK — table open' : 'OPEN TABLE — first ball you legally pot sets your group')))
  if (s.group) o.push(`Pot all your ${s.group}s, then the 8 to win. Potting the 8 early or scratching on it loses.`)
  o.push(s.ballInHand ? 'BALL-IN-HAND: place the cue anywhere via cue_x, cue_y (cm).' : `Cue ball at (${cm(s.cue.x)}, ${cm(s.cue.y)}) cm.`)
  o.push('Balls on table:')
  for (const b of s.balls) if (b.num !== 0 && !b.potted)
    o.push(`  ${b.num} (${groupOf(b.num) === 'eight' ? '8-ball' : groupOf(b.num)}) at (${cm(b.x)}, ${cm(b.y)})`)
  o.push('Rules: cue must contact one of your balls first (any ball on open/break, but not the 8 first unless it is all you have left); after contact a ball must be pocketed or reach a cushion, else foul.')
  o.push('Aim: point angle_degrees from the cue ball at the target ball\'s near side — use the ghost-ball line so the cue centre arrives one ball-diameter from the target centre along the line toward your pocket. Call the "shoot" tool.')
  return o.join('\n')
}

export async function getMove(model: string, key: string, prompt: string): Promise<Move> {
  return provider(model) === 'anthropic' ? callClaude(model, key, prompt) : callOpenAI(model, key, prompt)
}

async function callClaude(model: string, key: string, prompt: string): Promise<Move> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-api-key': key,
      'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model, max_tokens: 1024, tools: [TOOL],
      tool_choice: { type: 'tool', name: 'shoot' },
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
  const tu = (data.content || []).find((b: any) => b.type === 'tool_use')
  if (!tu) throw new Error('no tool_use in response')
  return tu.input as Move
}

async function callOpenAI(model: string, key: string, prompt: string): Promise<Move> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model, max_completion_tokens: 3000, messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'function', function: { name: TOOL.name, description: TOOL.description, parameters: TOOL.input_schema } }],
      tool_choice: { type: 'function', function: { name: 'shoot' } },
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
  const call = data.choices?.[0]?.message?.tool_calls?.[0]
  if (!call) throw new Error('no tool call in response')
  return JSON.parse(call.function.arguments) as Move
}
