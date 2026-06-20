import { existsSync } from 'node:fs'
import { provider } from '../ai/llm'
import { runBenchmark } from './benchmark'
import type { Keys } from './types'

function parseArgs(argv: string[]) {
  const a: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i]
    if (!s.startsWith('--')) continue
    const eq = s.indexOf('=')
    if (eq > 0) { a[s.slice(2, eq)] = s.slice(eq + 1); continue }   // --flag=value
    const k = s.slice(2)
    const v = argv[i + 1]
    if (v != null && !v.startsWith('--')) { a[k] = v; i++ } else a[k] = true   // --flag value | --flag
  }
  return a
}

const args = parseArgs(process.argv.slice(2))

if (!args.models || args.models === true) {
  console.error(`Usage: npm run bench -- --models <id1,id2,...> [options]

  --models        comma-separated model IDs, e.g. claude-opus-4-8,gpt-5  (required)
  --games N       games per pair (default 1; use >=20 for a real ranking)
  --concurrency N max games in flight (default 3)
  --out PATH      JSON report path (.md written alongside; default ./bench-results/run-<ISO>.json)
  --history       feed prior-shot history into prompts (in-context learning; default off)
  --self-play     also pair each model against itself (baseline; default off)
  --verbose       print per-shot log lines

API keys come from the environment ONLY (never CLI args):
  ANTHROPIC_API_KEY   for claude* models
  OPENAI_API_KEY      for everything else`)
  process.exit(1)
}

const models = String(args.models).split(',').map(s => s.trim()).filter(Boolean)

// Load a local, gitignored .env if present so keys can live in a file instead of the shell profile.
// Shell env still wins (process.loadEnvFile doesn't clobber already-set vars).
if (existsSync('.env')) process.loadEnvFile()
const keys: Keys = { anthropic: process.env.ANTHROPIC_API_KEY ?? '', openai: process.env.OPENAI_API_KEY ?? '' }

// Preflight: every model's provider key must be present before we schedule (and pay for) any game.
const missing = new Set<string>()
for (const m of models) {
  const prov = provider(m)
  if (prov === 'anthropic' && !keys.anthropic.trim()) missing.add('ANTHROPIC_API_KEY (for claude* models)')
  if (prov === 'openai' && !keys.openai.trim()) missing.add('OPENAI_API_KEY (for non-claude models)')
}
if (missing.size) {
  console.error(`Missing required API key(s):\n  ${[...missing].join('\n  ')}`)
  process.exit(1)
}

const games = args.games ? Math.max(1, parseInt(String(args.games), 10) || 1) : 1
if (games < 20) console.warn(`⚠  --games ${games}: this is a smoke run. Use >=20 games/pair for a meaningful ranking.\n`)

await runBenchmark(models, keys, {
  gamesPerPair: games,
  concurrency: args.concurrency ? Math.max(1, parseInt(String(args.concurrency), 10) || 3) : 3,
  out: typeof args.out === 'string' ? args.out : undefined,
  history: !!args.history,
  selfPlay: !!args['self-play'],
  verbose: !!args.verbose,
})
