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
      reasoning: { type: 'string', description: 'Your plan: which target ball and pocket; why both the cue→ball and ball→pocket lines are clear of other balls; the power/spin choice; where you expect the cue ball to end up; and the next ball you intend to play.' },
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
  history?: string            // recent shots + outcomes, for in-context learning
}

export function buildPrompt(s: Snapshot): string {
  const cm = (v: number) => Math.round(v * 100)
  const o: string[] = []
  o.push('You are a world-class 8-ball pool player. It is your turn — play like a pro: take the high-percentage shot, control the cue ball for the next one, and plan the whole run-out.')
  o.push(`Table play area is ${cm(L)}x${cm(W)} cm. Origin top-left, +x right, +y DOWN. Ball radius ${cm(BR)} cm (diameter ${(BR * 200).toFixed(1)} cm).`)
  o.push('Pockets (x,y cm): ' + POCKETS.map(p => `(${cm(p.x)},${cm(p.y)})`).join(' ') + '. Pockets are tight.')
  o.push('Your group: ' + (s.group ? s.group + 's' : (s.isBreak ? 'BREAK — table open' : 'OPEN TABLE — first ball you legally pot sets your group')))
  if (s.isBreak) o.push('THIS IS THE BREAK — smash the rack. Aim straight at the apex (front) ball, i.e. the rack ball nearest the cue, and hit it near full power (power 0.92–1.0) to explode the pack and pot balls. Add a little draw or stun (spin_y about -0.2 to 0) so the cue stays near mid-table and does not scratch or fly off. A hard, square, controlled break is the goal — do not play it soft.')
  if (s.group) o.push(`Pot all your ${s.group}s, then the 8 to win. Potting the 8 early or scratching on it loses.`)
  o.push(s.ballInHand ? 'BALL-IN-HAND: place the cue anywhere via cue_x, cue_y (cm).' : `Cue ball at (${cm(s.cue.x)}, ${cm(s.cue.y)}) cm.`)
  o.push('Balls on table:')
  for (const b of s.balls) if (b.num !== 0 && !b.potted)
    o.push(`  ${b.num} (${groupOf(b.num) === 'eight' ? '8-ball' : groupOf(b.num)}) at (${cm(b.x)}, ${cm(b.y)})`)
  o.push('Rules: cue must contact one of your balls first (any ball on open/break, but not the 8 first unless it is all you have left); after contact a ball must be pocketed or reach a cushion, else foul.')
  o.push([
    'How to choose your shot — reason about the WHOLE table before deciding, not just one ball:',
    '1. Consider EVERY one of your balls, not just the nearest. For each candidate check two straight lines against the coordinates of ALL other balls:',
    '   - cue → target ball: must be clear (no other ball within ~6 cm of the line), or you will hit the wrong ball first and foul;',
    '   - target ball → chosen pocket: must be clear, or the object ball cannot reach the pocket.',
    '   Reject any shot whose path is blocked, and prefer shorter, straighter, more open shots.',
    '2. POSITION PLAY: the cue ball keeps rolling after contact — plan where it stops. Choose power and spin to leave the cue with an easy, open shot on your NEXT ball. follow (spin_y>0) sends it forward along the shot line, draw (spin_y<0) pulls it back, stun (spin_y≈0) stops it near the contact point; softer power = less cue travel. Never aim the cue toward a pocket after contact (scratch).',
    '3. THINK AHEAD 2–3 balls: pick the order of your balls so each pot leaves a good angle on the next, and so the last ones are near pockets. Prefer an easy run-out over one spectacular shot that wrecks position.',
    '4. If no pot is makeable, play SAFE: roll gently to leave the cue where the opponent has no open shot (tuck it behind your balls or the 8), rather than forcing a low-percentage pot that risks selling out or fouling.',
    '5. On the 8-ball, choose the pocket you can reach with both lines clear AND a controlled cue finish.',
  ].join('\n'))
  if (s.history) o.push('\n' + s.history)
  o.push('\nAim mechanics: angle_degrees points from the cue ball toward the target — use the ghost-ball line so the cue centre arrives one ball-diameter from the target centre, along the line from the target to your chosen pocket. Decide the full plan, then call the "shoot" tool.')
  return o.join('\n')
}

export interface Usage { inputTokens: number; outputTokens: number }
export interface MoveResult { move: Move; usage: Usage }

export async function getMove(model: string, key: string, prompt: string): Promise<MoveResult> {
  return provider(model) === 'anthropic' ? callClaude(model, key, prompt) : callOpenAI(model, key, prompt)
}

async function callClaude(model: string, key: string, prompt: string): Promise<MoveResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-api-key': key,
      'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model, max_tokens: 8096, tools: [TOOL],   // Anthropic requires a cap; generous headroom
      tool_choice: { type: 'tool', name: 'shoot' },
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
  const tu = (data.content || []).find((b: any) => b.type === 'tool_use')
  if (!tu) throw new Error('no tool_use in response')
  return { move: tu.input as Move, usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 } }
}

// gpt-5* and o-series are reasoning models: function tools + reasoning_effort are rejected on
// /v1/chat/completions ("please use /v1/responses"), so route them through the Responses API.
const isReasoning = (model: string) => /^(gpt-5|o\d)/.test(model)

async function callOpenAI(model: string, key: string, prompt: string): Promise<MoveResult> {
  return isReasoning(model) ? callResponses(model, key, prompt) : callChat(model, key, prompt)
}

async function callResponses(model: string, key: string, prompt: string): Promise<MoveResult> {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model,
      input: prompt,
      tools: [{ type: 'function', name: TOOL.name, description: TOOL.description, parameters: TOOL.input_schema }],
      tool_choice: { type: 'function', name: 'shoot' },
      reasoning: { effort: 'low' },   // big latency/cost win; no max_output_tokens so it can't truncate
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
  const call = (data.output || []).find((o: any) => o.type === 'function_call')
  if (!call) {
    const why = data.status === 'incomplete' ? `incomplete (${data.incomplete_details?.reason})` : `status=${data.status ?? 'unknown'}`
    throw new Error(`no tool call — ${why}`)
  }
  let move: Move
  try { move = JSON.parse(call.arguments) as Move }
  catch { throw new Error('tool call arguments were not valid JSON') }
  return { move, usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 } }
}

async function callChat(model: string, key: string, prompt: string): Promise<MoveResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'function', function: { name: TOOL.name, description: TOOL.description, parameters: TOOL.input_schema } }],
      tool_choice: { type: 'function', function: { name: 'shoot' } },
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
  const choice = data.choices?.[0]
  const call = choice?.message?.tool_calls?.[0]
  if (!call) {
    const why = choice?.finish_reason === 'length'
      ? 'ran out of tokens before answering'
      : choice?.message?.refusal ? `refused: ${choice.message.refusal}`
        : `finish_reason=${choice?.finish_reason ?? 'unknown'}`
    throw new Error(`no tool call — ${why}`)
  }
  let move: Move
  try { move = JSON.parse(call.function.arguments) as Move }
  catch { throw new Error('tool call arguments were not valid JSON') }
  return { move, usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 } }
}
