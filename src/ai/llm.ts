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
  const dia = (BR * 200).toFixed(1)
  o.push('You are a world-class Chinese 8-ball player. Play the highest-percentage shot, control the cue ball for your next shot, plan the whole run-out — and above all, DO NOT FOUL.')
  o.push(`Table play area ${cm(L)}x${cm(W)} cm. Origin top-left, +x = right, +y = DOWN, so angle_degrees is clockwise (0=right, 90=down, 180=left, 270=up). Ball diameter ${dia} cm.`)
  o.push('Pockets (x,y cm): ' + POCKETS.map(p => `(${cm(p.x)},${cm(p.y)})`).join(' ') + '. Pockets are TIGHT — aim precisely.')
  o.push('Your group: ' + (s.group ? `${s.group}s (solids = 1-7, stripes = 9-15; the 8-ball is neither)` : (s.isBreak ? 'BREAK — table open' : 'OPEN TABLE — the first ball you legally pot sets your group')))
  if (s.group) o.push(`Win by potting all your ${s.group}s, THEN legally potting the 8. Potting the 8 before your group is cleared, or fouling as you pot it, LOSES the game.`)
  o.push(s.ballInHand ? 'You have BALL-IN-HAND: place the cue anywhere via cue_x, cue_y (cm) — put it where you have the easiest, straightest pot.' : `Cue ball at (${cm(s.cue.x)}, ${cm(s.cue.y)}) cm.`)
  o.push('Balls on table:')
  for (const b of s.balls) if (b.num !== 0 && !b.potted)
    o.push(`  ${b.num} (${groupOf(b.num) === 'eight' ? '8-ball' : groupOf(b.num)}) at (${cm(b.x)}, ${cm(b.y)})`)

  if (s.isBreak) {
    o.push('THIS IS THE BREAK — aim straight at the apex (front) rack ball nearest the cue and hit near full power (0.92–1.0) to scatter the pack. Add a little draw/stun (spin_y −0.2..0) so the cue stays mid-table and does not scratch. Do not play it soft.')
  } else {
    o.push([
      'LEGAL SHOT — the cue ball must FIRST touch a legal ball:',
      ' • open table: any ball except the 8;   • once you have a group: one of YOUR balls;   • the 8 only after your whole group is potted.',
      'THEN a ball must be POTTED, or — if nothing is potted — at least one ball must reach a CUSHION after contact (the "rail rule"). Otherwise it is a FOUL and your opponent gets ball-in-hand anywhere. Scratching the cue ball, or touching the 8 / wrong group first, are also fouls. (Avoiding fouls is the biggest thing separating good play from bad here.)',
      '',
      'AIMING (ghost-ball) — to send target T into pocket K (coordinates in cm):',
      ' 1. u = (K − T) / |K − T|            // unit vector from the target toward the pocket',
      ` 2. G = T − ${dia} · u                // "ghost" cue position: one ball-diameter behind T, away from K`,
      ' 3. angle_degrees = degrees(atan2(Gy − Cy, Gx − Cx))   // aim the cue (at C) straight at G',
      ' Cut angle = angle between line C→T and line T→K: under ~30° is easy, ~50°+ is low-percentage — prefer a different ball or a safety.',
      '',
      'CLEARANCE — reject the shot unless BOTH straight lines are clear of every other ball (a ball within one ball-diameter of a line blocks it):',
      ' • cue → G  (else you contact the wrong ball first = foul);   • T → K  (else the target cannot reach the pocket).',
      '',
      'CUE-BALL CONTROL — predict where the cue goes after contact, to avoid scratching it AND to get shape on your next ball:',
      ' • stun (spin_y ≈ 0): cue leaves at ~90° to the target’s direction (the tangent line);',
      ' • follow (spin_y > 0): cue carries forward, bending ~30° off its line on medium cuts;',
      ' • draw (spin_y < 0): cue comes back to the opposite side (~3× the cut angle on shallow cuts).',
      ' Less power = less cue travel. NEVER leave the cue rolling toward a pocket. Choose power+spin so the cue stops with an open shot on your next ball.',
      '',
      'PLAN — consider EVERY one of your balls (not just the nearest); order them so each pot leaves an easy angle on the next, saving balls near pockets for last. If NO pot is makeable, play a SAFETY: roll the cue safe behind your balls or the 8 — but you MUST still drive some ball to a cushion after contact (do not just nudge your ball into place), or the rail rule makes it a foul.',
    ].join('\n'))
  }
  if (s.history) o.push('\n' + s.history)
  o.push('\nFINAL CHECK before you answer: (1) does the cue hit a LEGAL ball first? (2) will a ball be potted OR reach a rail after contact? (3) does the cue avoid rolling into every pocket (no scratch)? If any answer is "no", change the shot. Put your plan in `reasoning`, then call the "shoot" tool.')
  return o.join('\n')
}

export type ReasoningEffort = 'low' | 'medium' | 'high'
export interface Usage { inputTokens: number; outputTokens: number }
export interface MoveResult { move: Move; usage: Usage }

export async function getMove(model: string, key: string, prompt: string, effort: ReasoningEffort = 'low'): Promise<MoveResult> {
  return provider(model) === 'anthropic' ? callClaude(model, key, prompt) : callOpenAI(model, key, prompt, effort)
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

async function callOpenAI(model: string, key: string, prompt: string, effort: ReasoningEffort): Promise<MoveResult> {
  return isReasoning(model) ? callResponses(model, key, prompt, effort) : callChat(model, key, prompt)
}

async function callResponses(model: string, key: string, prompt: string, effort: ReasoningEffort): Promise<MoveResult> {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model,
      input: prompt,
      tools: [{ type: 'function', name: TOOL.name, description: TOOL.description, parameters: TOOL.input_schema }],
      tool_choice: { type: 'function', name: 'shoot' },
      reasoning: { effort },   // higher effort = more reasoning tokens (output-billed) + latency; no max_output_tokens so it can't truncate
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
