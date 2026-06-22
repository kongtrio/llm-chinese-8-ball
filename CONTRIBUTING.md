# Contributing

Thanks for improving LLM Chinese 8-Ball.

## Local setup

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env` only if you want to run headless benchmarks against hosted models.

## Before opening a PR

```bash
npm run check
npm run standalone
```

Commit `standalone.html` when it changes. It is generated from the Vite build; edit source files instead of editing the generated HTML directly.

## Benchmark notes

Use `bot-basic` for free smoke tests and baseline comparisons. Hosted LLM benchmarks use real API calls and can spend money, so prefer low `--games` counts while testing CLI changes.
