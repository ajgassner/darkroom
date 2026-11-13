# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

darkroom is a local, private studio for images, speech, cloned voices and music via OpenRouter (web UI + CLI). The README covers features, CLI usage, elements, privacy modes and file layout in detail; read it before larger changes.

## Commands

Tools come from mise (`mise install`: Node 26, corepack/pnpm, agent-browser, gh); CI installs Node and corepack from the same `mise.toml` via `jdx/mise-action`. `pnpm install` is also run by `orca.yaml` for new worktrees.

End users install with `install.sh` / `install.ps1`: they download Node 26 and the source into `~/.darkroom`, run pnpm install + build, and add a `darkroom` wrapper (the CLI with `DARKROOM_HOME=~/darkroom`) to the PATH. Keep both scripts in sync, and keep `pnpm cli <cmd>` and `darkroom <cmd>` equivalent. Test the installer without touching the real setup: `SHELL=/bin/sh DARKROOM_DIR=<tmp>/app DARKROOM_HOME=<tmp>/data DARKROOM_SOURCE=file://<tarball> bash install.sh`.

```bash
pnpm dev                     # server (watch, :5177) + Vite dev server (:5173, proxies /api and /out)
pnpm build                   # build only the web UI into dist/web/ (node code runs without a build)
pnpm start                   # server on http://localhost:5177
pnpm cli <cmd>               # CLI, e.g. pnpm cli gen --help
pnpm check                   # typecheck + lint + test + analyze, the full gate
pnpm typecheck               # tsc for node code (tsconfig.json) and web (apps/web/tsconfig.json)
pnpm lint / pnpm format      # Biome check (warnings are errors) / auto-fix
pnpm test                    # Vitest, projects "node" and "web"
pnpm vitest run packages/core/src/elements/refs.test.ts   # single file
pnpm vitest run -t "name of test"                     # single test by name
pnpm vitest run --project web                         # one project
pnpm coverage                # coverage/; fallow uses it for CRAP scores (regenerate when stale)
pnpm analyze                 # fallow: dead code, duplicates, complexity, boundaries
pnpm mock                    # fake OpenRouter on :5299 for trying the UI without cost
```

Run the UI against the mock with an empty data folder:
`DARKROOM_HOME=$(mktemp -d) PORT=5199 OPENROUTER_API_KEY=test OPENROUTER_BASE=http://127.0.0.1:5299/api/v1 pnpm start`.
The `agent-browser` project skill drives the UI in a real browser for UI verification.

## CI and releases

`.github/workflows/ci.yml` runs on push/PR (typecheck, lint, coverage, fallow, build) and installs this commit with both installers on Linux, macOS and Windows. `main` is protected by a ruleset: changes go in through a branch and pull request (`gh pr create`), CI must pass, and pull requests are squash-merged, so the PR title and body become the commit on `main`. Label each PR `enhancement`, `bug` or `documentation`; the release notes are generated from the merged PRs and grouped by these labels (`.github/release.yml`). Releases are only made by `.github/workflows/release.yml` (workflow_dispatch with a version bump), whose release commit is pushed with the `RELEASE_DEPLOY_KEY` deploy key, the ruleset's only bypass: never tag or bump the version by hand. The version lives in the root `package.json` (`APP_VERSION`); the update check (`core/src/system/update-check.ts`) compares it with the latest GitHub release.

## Stop hook and quality gates

`.claude/settings.json` runs `scripts/stop-check.sh` on Stop: Biome, both tsc configs, the Vitest tests related to the changed `.ts`/`.tsx` files (`vitest related`; none for docs-only changes) and fallow. The full suite runs in CI and with `pnpm check`. Findings are sent back and must be fixed before finishing. fallow runs **without a baseline**, so any new finding fails:

- Limits in `.fallowrc.jsonc`: cyclomatic 20, cognitive 15, CRAP 60. Complex untested functions fail; add tests or split the function.
- Unused exports are reported inside the internal packages too (`includeEntryExports`), so remove exports that nothing imports.
- If CRAP results look wrong, check that `coverage/coverage-final.json` belongs to this checkout (fallow says "0/N functions matched" otherwise) and rerun `pnpm coverage`.

## Architecture

pnpm workspace; Node runs TypeScript directly (type stripping), so only erasable syntax is allowed (no enums, namespaces, parameter properties) and relative imports use explicit `.ts` extensions.

- `packages/core`: all logic. Exposed via `"./*": "./src/*.ts"`, imported as `@darkroom/core/<path>` (e.g. `@darkroom/core/image/generate`; no extension; relative imports inside a package use `.ts`). `src/` holds the shared base (`contract.ts`, `config.ts`, `errors.ts`) and domain folders: `openrouter/` (client, upstream calls, audio model lists, API key, privacy), `models/` (catalog, favorites), `image/` (generation, params, prompt, tools), `elements/` (refs), `audio/` (speech, music, voices, transcription, WAV), `storage/` (manifest, JSON files, debug log, HEIC decoding), `system/` (workers, update check). Heavy local work (background removal, Whisper) runs in separate worker processes (`image/removebg-worker.ts`, `audio/transcribe-worker.ts`), started by `system/worker.ts` with paths relative to `src/`.
- `apps/server`: Fastify, binds to 127.0.0.1 with Host/Origin checks (`http.ts`). Routes in `routes/`; generation runs stream NDJSON events to the client. Also serves `dist/web/`.
- `apps/cli`: commander + @clack/prompts on top of core. `src/cli.ts` holds the commander definitions (kept thin), `args.ts` the argument parsing. Folders: `commands/` (the implementations: `image.ts`, `speech.ts`, `music.ts`, `preview.ts`, `favorites.ts`, `show.ts` for the listings, `web.ts`, `menu.ts` for the interactive main menu, `shared.ts` for the catalog loaders and run wiring), `interactive/` (the questions in `flow.ts`, their choices, remembered state, the equivalent command line), `output/` (`out.ts` where output goes, `term.ts` spinners/progress/prompts, `json.ts`, text listings, `mode.ts`, `no-color.ts` which `cli.ts` must import first), `agent/` and `platform/` (opening files, playing audio). `darkroom skill` (`agent/skill.ts`) prints the usage guide for AI agents, partly generated from the command definitions; `--json` output shapes live in `output/json.ts`. Update the guide's text when commands, options, defaults or JSON shapes change (`agent/skill.test.ts` checks that every command and option appears).
- `apps/web`: React 19, Vite, Tailwind 4, zustand, i18next (EN/DE in `src/i18n/`). UI components in `features/` (`app/` shell, `gallery/`, `dialogs/`, `hooks/`, `image/` and `audio/` panels); decision logic lives in pure, tested helpers in `src/lib/`, not in components. `lib/` keeps server calls, state and flows at the top (`api`, `store`, `actions`, `runs`, `types`, `utils`) and the helpers in `models/`, `audio/`, `text/` and `ui/`.

Boundaries enforced by fallow: core imports nothing internal, and inside core each domain folder may only import the base and the folders its rule in `.fallowrc.jsonc` allows; server and CLI may import core, and the CLI folders have their own rules as well; **web may only import types from core** (`@darkroom/core/contract`, the shared API contract) and talks to the server over HTTP. Inside web, `lib/` never imports `features/` or `components/`, and the helpers and state never import the flows (`api`, `actions`, `runs`).

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
- Commit messages and PRs: imperative summary line (PR title), then a bullet list of the changes grouped by area (PR body).
