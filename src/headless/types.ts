import type { ShotRecord } from '../ai/memory'
import type { Language } from '../i18n'

export interface Keys { anthropic: string; openai: string }

export interface GameOptions {
  maxShots?: number          // hard cap on shots before a game is declared a stalemate (default 240)
  maxSubsteps?: number       // physics substep cap per shot before voiding the game (default 6000 = 10s game-time)
  perCallTimeoutMs?: number  // per-LLM-call timeout (default 90000; reasoning models are slow)
  maxRetries?: number        // retries on 429/5xx/timeout (default 3)
  lang?: Language            // language for evaluateShot log lines (default 'en')
  history?: boolean          // feed prior-shot history into the prompt (in-context learning; default false)
  verbose?: boolean          // print per-shot log lines (default false)
}

// How a game ended. Skill ranking uses only the decisive outcomes (legal-8 / lost-on-8);
// stalemate and void are neutral diagnostics that never count as a win or a loss.
export type Outcome = 'legal-8' | 'lost-on-8' | 'stalemate' | 'void'

export interface PlayerStats {
  model: string
  shots: number
  ballsPotted: number
  fouls: number
  validMoves: number     // LLM returned a usable move
  illegalMoves: number   // LLM returned but the move was malformed/non-finite (-> fallback shot)
  apiErrors: number      // network/429/5xx/timeout after retries (-> fallback shot)
  fallbackShots: number  // shots played by the safety fallback (illegal + apiError)
  latenciesMs: number[]
  inputTokens: number    // billed prompt tokens (summed across the model's calls)
  outputTokens: number   // billed completion tokens incl. reasoning
}

export interface GameResult {
  modelA: string
  modelB: string
  breaker: 0 | 1         // which player index broke
  winner: 0 | 1 | null
  outcome: Outcome
  totalShots: number
  stats: [PlayerStats, PlayerStats]
  shots: ShotRecord[]    // full shot-by-shot record, for post-hoc analysis
  errors: { shot: number; player: 0 | 1; message: string }[]
  startMs: number
  endMs: number
}
