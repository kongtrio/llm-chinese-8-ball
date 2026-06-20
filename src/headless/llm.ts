import { getMove, type MoveResult } from '../ai/llm'
import type { GameOptions } from './types'

// Retry only on transient infra failures. getMove() throws either the provider's
// error.message (e.g. "rate_limit_error", "overloaded_error") or the bare `HTTP <n>`
// form when there's no message; auth/parse/no-tool-call errors won't fix on retry.
const retryable = (msg: string) =>
  msg === 'timeout' ||
  /HTTP\s*(408|409|429|5\d\d)\b/i.test(msg) ||
  /rate[ _-]?limit|overload|timed?[ _-]?out|temporar|unavailable|fetch failed|network|socket hang|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(msg)

/** getMove() wrapped with a per-call timeout + exponential backoff (jittered) on transient errors. */
export async function callLLMWithRetry(model: string, key: string, prompt: string, opts: GameOptions = {}): Promise<MoveResult> {
  if (!key?.trim()) throw new Error('missing api key')           // never retry, never burn quota
  const maxRetries = opts.maxRetries ?? 3
  const timeoutMs = opts.perCallTimeoutMs ?? 90_000
  let lastErr: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let handle: ReturnType<typeof setTimeout> | undefined
    try {
      // explicit timeout Promise raced against getMove — getMove's fetch is left to settle and GC,
      // we just stop awaiting it. clearTimeout in finally so timers don't pile up at high concurrency.
      const timeout = new Promise<never>((_, rej) => { handle = setTimeout(() => rej(new Error('timeout')), timeoutMs) })
      return await Promise.race([getMove(model, key, prompt), timeout])
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      if (attempt === maxRetries || !retryable(msg)) throw e
      const delay = Math.min(1000 * 2 ** attempt, 10_000) + Math.random() * 2000  // backoff + jitter
      await new Promise(r => setTimeout(r, delay))
    } finally {
      clearTimeout(handle)
    }
  }
  throw lastErr
}
