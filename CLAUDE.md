# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

darkroom is a local, private studio for images, speech, cloned voices and music via OpenRouter (web UI + CLI). The README covers features, CLI usage, elements, privacy modes and file layout in detail; read it before larger changes.

## Commands

Tools come from mise (`mise install`: Node 26, corepack/pnpm, agent-browser). `pnpm install` is also run by `orca.yaml` for new worktrees.

```bash
pnpm dev                     # server (watch, :5177) + Vite dev server (:5173, proxies /api and /out)
pnpm build                   # build only the web UI into dist/web/ (node code runs without a build)
pnpm start                   # server on http://localhost:5177
pnpm cli <cmd>               # CLI, e.g. pnpm cli gen --help
pnpm check                   # typecheck + lint + test + analyze, the full gate
pnpm typecheck               # tsc for node code (tsconfig.json) and web (apps/web/tsconfig.json)
pnpm lint / pnpm format      # Biome check (warnings are errors) / auto-fix
pnpm test                    # Vitest, projects "node" and "web"
pnpm vitest run packages/core/src/refs.test.ts        # single file
pnpm vitest run -t "name of test"                     # single test by name
pnpm vitest run --project web                         # one project
pnpm coverage                # coverage/; fallow uses it for CRAP scores (regenerate when stale)
pnpm analyze                 # fallow: dead code, duplicates, complexity, boundaries
pnpm mock                    # fake OpenRouter on :5299 for trying the UI without cost
```

Run the UI against the mock with an empty data folder:
`DARKROOM_HOME=$(mktemp -d) PORT=5199 OPENROUTER_API_KEY=test OPENROUTER_BASE=http://127.0.0.1:5299/api/v1 pnpm start`.
The `agent-browser` project skill drives the UI in a real browser for UI verification.

## Stop hook and quality gates

`.claude/settings.json` runs `scripts/stop-check.sh` on Stop: Biome, both tsc configs, Vitest and fallow. Findings are sent back and must be fixed before finishing. fallow runs **without a baseline**, so any new finding fails:

- Limits in `.fallowrc.jsonc`: cyclomatic 20, cognitive 15, CRAP 60. Complex untested functions fail; add tests or split the function.
- Unused exports are reported inside the internal packages too (`includeEntryExports`), so remove exports that nothing imports.
- If CRAP results look wrong, check that `coverage/coverage-final.json` belongs to this checkout (fallow says "0/N functions matched" otherwise) and rerun `pnpm coverage`.

## Architecture

pnpm workspace; Node runs TypeScript directly (type stripping), so only erasable syntax is allowed (no enums, namespaces, parameter properties) and relative imports use explicit `.ts` extensions.

- `packages/core`: all logic (OpenRouter client, generation runs, tools, audio, elements, manifest). Exposed via `"./*": "./src/*.ts"`, imported as `@darkroom/core/<module>` (no extension; relative imports inside a package use `.ts`). Heavy local work (background removal, Whisper) runs in separate worker processes (`*-worker.ts`).
- `apps/server`: Fastify, binds to 127.0.0.1 with Host/Origin checks (`http.ts`). Routes in `routes/`; generation runs stream NDJSON events to the client. Also serves `dist/web/`.
- `apps/cli`: commander + @clack/prompts on top of core.
- `apps/web`: React 19, Vite, Tailwind 4, zustand, i18next (EN/DE in `src/i18n/`). UI components in `features/`; decision logic lives in pure, tested helpers in `src/lib/`, not in components.

Boundaries enforced by fallow: core imports nothing internal; server and CLI may import core; **web may only import types from core** (`@darkroom/core/contract`, the shared API contract) and talks to the server over HTTP.

Data lives under `ROOT` (`packages/core/src/config.ts`): the repo root, or `DARKROOM_HOME`. It holds `.env`, `refs/`, `voices/`, `out/` (results + `manifest.jsonl`), `models/`. App files (`presets.json`, `dist/web/`) always come from the repo. Manifest deletions only mark entries so cost totals stay correct.

## Messages and i18n

The backend writes English messages only, and every message it generates also carries a machine-readable code that the web UI translates:

- Errors are thrown as `AppError(code, englishMessage, params)` (`core/src/errors.ts`).
- Manifest entries: `warnings` + `notices: [{ code, params }]`; errors `error` + `errorCode` / `errorParams`.
- API errors `{ error, code?, params? }`; stream errors `{ type: "fatal", error, code?, params? }`.

New codes need translations in both `apps/web/src/i18n/en.ts` and `de.ts`.

## Tests

Tests sit next to the code (`*.test.ts`). The node project's setup (`packages/core/test/setup.ts`) gives each test file its own temporary data folder, a fake API key and an unreachable API base. OpenRouter is replaced by an in-process fake (`packages/core/test/fake-openrouter.ts`, stubbed `fetch`). The server is tested with `fastify.inject`. Tests must never touch real `refs/`, `out/`, `voices/`, `.env` or the network.

## Conventions

- Biome: 2-space indent, line width 120, single quotes, semicolons, trailing commas (`.editorconfig` matches).
- Commit messages: imperative summary line, then a bullet list of the changes grouped by area.
