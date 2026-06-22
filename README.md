<p align="center">
  <img src="docs/banner.svg" alt="Chinese 8-Ball - Human vs LLM" width="100%">
</p>

<p align="center">
  Browser-based Chinese 8-ball with shared physics, LLM players, a local bot, and a headless benchmark harness.
</p>

<p align="center">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-149ECA">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-7-646CFF">
  <img alt="Vitest" src="https://img.shields.io/badge/tested%20with-Vitest-6E9F18">
</p>

## Overview

LLM Chinese 8-Ball is both a playable pool game and a model benchmark. The browser app supports human, LLM, and local bot players. The headless runner uses the same game core to run reproducible round-robin tournaments between models or against the built-in `bot-basic` baseline.

LLM players receive only table coordinates and must return a shot through a forced tool call. API requests are made directly to Anthropic or OpenAI with your own keys.

## Features

- Real-time 2D pool simulation in SI units.
- Shared physics, shot model, and rules between browser play and benchmarks.
- Human, Claude/GPT, and deterministic local bot players.
- Resumable headless round-robin benchmark with checkpoints.
- Markdown/JSON reports with leaderboard, head-to-head matrix, confidence intervals, reliability metrics, token usage, and cost estimates.
- English and Chinese UI.
- Generated single-file `standalone.html` artifact.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

Common scripts:

| Command              | Description                                     |
| -------------------- | ----------------------------------------------- |
| `npm run dev`        | Start the Vite dev server.                      |
| `npm run check`      | Run lint, format check, tests, and build.       |
| `npm test`           | Run Vitest tests.                               |
| `npm run bench`      | Run the headless benchmark CLI.                 |
| `npm run standalone` | Regenerate `standalone.html` from the Vite app. |
| `npm run format`     | Format source files with Prettier.              |
| `npm run lint`       | Run ESLint with zero-warning enforcement.       |

## Playing

- Drag back from the cue ball and release to shoot.
- Use the spin pad to apply side English, follow, or draw.
- After a foul, click the table to place the cue ball.
- Set a player to **Bot** for the offline `bot-basic` opponent.
- Set a player to **LLM** and choose a Claude or GPT model to use API-backed play.

Browser API keys are stored in `localStorage` and sent directly to the selected provider. Do not deploy a public copy with real keys embedded or prefilled.

## Headless Benchmark

Create a local `.env` for hosted models:

```bash
cp .env.example .env
```

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

Run a benchmark:

```bash
npm run bench -- --models bot-basic,gpt-5 --games 20 --out bench-results/bot-vs-gpt5.json
```

Resume an interrupted run:

```bash
npm run bench -- --models bot-basic,gpt-5 --games 20 --out bench-results/bot-vs-gpt5.json --resume
```

Benchmark options:

| Flag                 | Default                        | Description                                                                                    |
| -------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--models a,b,c`     | required                       | Comma-separated model IDs. `bot-basic` is local; `claude-*` uses Anthropic; others use OpenAI. |
| `--games N`          | `1`                            | Games per pairing. Use an even value for balanced breaks.                                      |
| `--concurrency N`    | `3`                            | Games to run in parallel.                                                                      |
| `--max-shots N`      | `240`                          | Shot cap before a game is scored as a stalemate.                                               |
| `--reasoning-effort` | `low`                          | `low`, `medium`, or `high` for OpenAI reasoning models.                                        |
| `--out PATH`         | `bench-results/run-<ISO>.json` | JSON report path. A Markdown report is written next to it.                                     |
| `--resume`           | off                            | Reuse matching games from the report or checkpoint and run only missing games.                 |
| `--self-play`        | off                            | Include same-model pairings.                                                                   |
| `--history`          | off                            | Include prior-shot history in model prompts.                                                   |

Scoring uses win = 3, stalemate = 1, loss = 0. Malformed moves and API failures are tracked separately from pool results so model reliability is not conflated with game skill.

## Architecture

```text
src/
  game/        physics, rules, table geometry, rendering, shot model
  ai/          LLM prompting/API calls, local bot, browser shot memory
  headless/    benchmark CLI, game loop, reports, pricing, stats
  ui/          React app, controls, styling
  i18n.ts      English and Chinese strings
docs/          README artwork
scripts/       generated standalone build/check scripts
```

Key modules:

- `src/game/shoot.ts`: shared shot-to-velocity conversion.
- `src/game/physics.ts`: fixed-step physics integration.
- `src/game/rules.ts`: shot adjudication and turn outcomes.
- `src/ai/llm.ts`: coordinate prompt construction and provider calls.
- `src/ai/bot.ts`: deterministic `bot-basic` implementation.
- `src/headless/benchmark.ts`: parallel tournament runner and checkpointing.

## Quality

CI runs on push and pull request via `.github/workflows/ci.yml`:

```bash
npm ci
npm run lint
npm run format:check
npm test
npm run build
npm run standalone:check
```

`standalone.html` is generated. Edit source files and run `npm run standalone` instead of editing it by hand.

## Caveats

- Rules are simplified WPA-style 8-ball, not a full official Heyball ruleset.
- Hosted-model benchmarks use real API calls and can incur real costs.
- LLM pool play is noisy; benchmark rankings should be treated as directional unless run at sufficient scale.

## License

MIT
