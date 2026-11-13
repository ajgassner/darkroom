<img src="apps/web/public/favicon.svg" width="72" alt="darkroom icon: a violet lens on a dark background">

# darkroom

**A private, local studio for AI photos of yourself, your voice and your music, powered by [OpenRouter](https://openrouter.ai).**

A self-hosted alternative to getimg.ai and similar subscription services. Upload a few photos of a person, a logo or a product once, then generate realistic images with them across many models side by side. Edit results with AI and local tools, speak text in your own cloned voice and create music. Everything runs on your machine; you pay OpenRouter per use, no subscription.

[![CI](https://github.com/ajgassner/darkroom/actions/workflows/ci.yml/badge.svg)](https://github.com/ajgassner/darkroom/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/ajgassner/darkroom)](https://github.com/ajgassner/darkroom/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js 26+](https://img.shields.io/badge/node-%E2%89%A526-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)

![darkroom web UI: model selection and parameters on the left, prompt and gallery of runs on the right](docs/screenshot.png)

## Features

- **Elements**: reusable reference sets (person, logo, object, location, style) with their own instructions. Mention them in a prompt with `@name`.
- **Many models in parallel**: the same prompt and references go to several models at once for a direct comparison.
- **Model lists that stay current**: every list shows your favorites first (star a model in the web UI or use `darkroom favorites add <model>`), then the recommended models, then all others newest first, each with its release month and a "new" badge for the last 30 days. The recommendations are strong in current blind-vote rankings (LMArena, Artificial Analysis), recent and ZDR-capable where possible (reviewed November 2026).
- **Parameters that fit each model**: aspect ratios, sizes, formats and reference limits come live from the OpenRouter catalog; unsupported values snap to the closest supported one.
- **Privacy by default**: image, speech and transcription requests only go to Zero Data Retention endpoints unless you switch it off; music uses them whenever the model has one.
- **Image tools**: upscale, expand canvas, relight and clean up backgrounds with AI; resize, crop and remove backgrounds locally for free.
- **Audio**: text-to-speech with 39 models, cloned voices from your own samples, and music with Google Lyria.
- **Web UI and CLI**: the CLI generates images, speech and music (interactively or scripted) and lists models, elements, voices and costs; image tools, editing elements and voices, transcription and metadata removal are in the web UI, which is available in English and German.
- **AI-native**: AI agents that can run shell commands (Claude Code, Codex, Gemini CLI, Cursor, …) learn darkroom from `darkroom skill`, a usage guide that matches the installed version, and drive it with `--json`.
- **Full record**: every result lands in `out/` together with a manifest of prompt, model, parameters, provider, cost and duration, plus the exact request and response for debugging.

## Install

You need an [OpenRouter API key](https://openrouter.ai/settings/keys). The installer brings its own Node.js, so nothing else has to be installed first.

**macOS and Linux**, in a terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/ajgassner/darkroom/main/install.sh | bash
```

On a fresh Ubuntu without `curl`, install it with `sudo apt install curl` first.

**Windows**, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/ajgassner/darkroom/main/install.ps1 | iex
```

The installer asks for your API key (you can also enter it in the web UI on first start), puts darkroom into `~/.darkroom` and adds the `darkroom` command to your PATH. Your data (elements, voices, results and the key in `.env`) lives in `~/darkroom`. Open a new terminal, then:

```bash
darkroom start      # web UI on http://localhost:5177, Ctrl+C stops it
darkroom --help     # all commands
darkroom uninstall  # remove darkroom; your data stays in ~/darkroom
```

The installer installs the latest [release](https://github.com/ajgassner/darkroom/releases). When a newer one is out, the web UI shows an **Update** badge and `darkroom start` prints a note (darkroom asks GitHub at most once a day; `DARKROOM_UPDATE_CHECK=off` disables it). `darkroom update` installs it; your data stays untouched, and if the update fails, the previous version keeps working (on macOS and Linux, restart a running darkroom afterwards; on Windows, stop it first). `darkroom uninstall` asks for confirmation (`--yes` skips it), then removes the app, its Node.js and package caches and the PATH entry; `~/darkroom` holds your data, delete it only if you don't need it anymore. The install folder and the data folder must be separate (`DARKROOM_DIR` and `DARKROOM_HOME` change them); the installer refuses folders that overlap.

### From source

For development, or if you prefer to run darkroom from a git checkout with Node.js 26 and pnpm:

```bash
git clone https://github.com/ajgassner/darkroom.git
cd darkroom
mise install                # Node 26 and corepack (pnpm); without mise: install Node 26, then
                            # npm install -g corepack && corepack enable  (Node 25+ no longer ships corepack)
pnpm install
pnpm build                  # build the web UI
pnpm start                  # open http://localhost:5177 and enter your API key
```

In a checkout, `pnpm cli <command>` runs the same commands as `darkroom <command>` (except `update` and `uninstall`, which only say what to do in a checkout: `git pull && pnpm install && pnpm build`, or delete the folder), and the data lives in the checkout itself. Node runs the TypeScript backend and CLI directly; only the web UI is built, and `pnpm start` / `pnpm cli start` rebuild it by themselves when it is missing or older than its sources (after a `git pull`, for example). The server only listens on `127.0.0.1`.

## First steps

Start the web UI and create your first element: **Element → Manage**, enter a name such as `me` and drag in 3–6 photos. Good reference photos show only you, with the face clearly visible from the front and slightly from the side, in different lighting, without sunglasses or heavy filters.

## Elements and @mentions

An element is a folder `refs/<name>/` with images and an `element.json`, editable in the UI under **Element → Manage**. A name typed there becomes the display name, and the folder name is derived from it (`Max Müller` → `refs/max-mueller/`, mentioned as `@max-mueller`); elements and own voices can be deleted there too, which removes their folder.

```json
{
  "label": "companylogo",
  "type": "logo",
  "instructions": "Use the white logo on dark backgrounds and the dark logo on bright backgrounds"
}
```

| Type             | Effect                                                                   |
| ---------------- | ------------------------------------------------------------------------ |
| Person           | face and identity are preserved                                          |
| Logo             | reproduced exactly (shape, colors, typography); PNG transparency is kept |
| Object / product | shape, material, colors and labels are preserved                         |
| Location         | used as the setting                                                      |
| Style            | only look and mood, not the content                                      |

Mention elements in the prompt with `@name` (suggestions appear as you type), for example: _"A picture of @max in the office with the @companylogo in the top right"_. The element selected in the dropdown is always included; mentioned ones are added. A mention without a matching element is sent as plain text and the result carries a notice; e-mail addresses such as `max@example.com` are not mentions.

Before sending, darkroom downscales the reference images and tells the model which images belong to which element, together with the rules of its type and your instruction. Logos, objects, locations and styles are referred to by image number, so the model doesn't write the element name into the picture. If a model accepts fewer references than you have, the images are distributed round-robin and every element keeps at least one.

A single person with an instruction template containing `{prompt}` and `{label}` uses exactly that template.

## Image tools

Available in the detail view of every image:

| Tool                | How it works                                                                                          | Cost              |
| ------------------- | ----------------------------------------------------------------------------------------------------- | ----------------- |
| Upscale             | the selected model recreates the image in 2K or 4K; the element is sent along to keep the face stable | like a generation |
| Resize              | local with sharp (Lanczos)                                                                            | free              |
| Expand canvas       | outpainting to a new aspect ratio                                                                     | like a generation |
| Crop                | local, detects the subject or crops to the center                                                     | free              |
| Relight             | presets (golden hour, studio, window light, …) or your own description                                | like a generation |
| Clean up background | removes distracting objects and people                                                                | like a generation |
| Remove background   | local with `@imgly/background-removal-node`, transparent or with a color                              | free              |

**Keep editing** uses any result as an additional reference for the next prompt. Images you drop or paste under **Additional references** are kept in `out/uploads/`: pick them again (or delete them) under **Previous uploads**. An upload is removed when the last run that used it is deleted. **Remove metadata on download** strips EXIF, XMP, IPTC and C2PA data (and ID3 tags from MP3) losslessly. Invisible pixel watermarks such as Google's SynthID cannot be removed.

## Audio

- **Speech**: choose a model and voice, optionally add a style instruction (e.g. "calm and friendly"; Gemini, Fish Audio and OpenAI) and the speed.
- **Your own voice**: under **Own voices**, record or upload a 10–30 s sample. Samples are transcribed automatically, either locally with Whisper (offline, about 250 MB downloaded on first use) or via the API, and you can correct the transcript. Voice cloning works with Fish Audio, Seed Audio and HeyGen.
- **Music**: Google Lyria 3 (a 30 s clip costs about $0.04, a full song with Pro about $0.08). A music prompt goes to a ZDR endpoint when the model has one; otherwise it is sent without Zero Data Retention (with a notice), so keep personal details out of music prompts.

## CLI

Run `darkroom` without a command in a terminal for an interactive menu: image, speech, music, model lists, elements and voices, costs and the web UI. It asks for the privacy mode, models (type to search, Tab selects, Enter confirms; typing a search drops the remembered selection; favorites, then recommended, then newest first, with release month, price and ZDR status), element, aspect ratio and size (only values the chosen models support), the number of images and the prompt (for speech: model, voice, with "Listen to a preview" after choosing one, text, instructions and speed), shows a summary with the estimated cost and runs after you confirm. Afterwards it prints the same run as a command line (to reuse it or give it to an agent) and offers to open the result, run again, change settings, add the models to your favorites or go back to the menu. Escape goes back one question, Ctrl+C quits. Your last choices (not prompts or texts) are remembered in `.cli-state.json` in your data folder.

`darkroom gen`, `darkroom speak` and `darkroom music` without a prompt or text start the same questions; options given on the command line are not asked again. Outside a terminal (scripts, AI agents) the CLI never asks: a missing prompt is an error.

```bash
# default model, element "me", portrait 3:4 in 2K
darkroom gen -e me -a 3:4 -s 2K "Business portrait in a bright office, suit, soft window light"

# @mentions, three models in parallel, 2 images each
darkroom gen -n 2 -m google/gemini-3.1-flash-image,google/gemini-3-pro-image,bytedance-seed/seedream-5-0-pro \
  "Outdoor portrait of @me in an autumn park"

# keep editing a result: the path it printed, or just the file name from out/
darkroom gen -e me -r 2026-11-12T18-30-00_3f9a2c_google_gemini-3.1-flash-image_1.png "same scene, but with glasses"

# your own cloned voice: needs a model that can clone (Fish Audio, Seed Audio, HeyGen)
darkroom speak -m fish-audio/s2.1-pro -v voice:me "Hello, this is my cloned voice."

darkroom                           # interactive menu (in a terminal)
darkroom gen                       # interactive image run; also: darkroom speak, darkroom music
darkroom gen -m google/gemini-3-pro-image   # asks only for what is missing
darkroom start                     # web UI on http://localhost:5177 (or PORT)
darkroom speak --speed 1.1 "Hello! This is a short test."
darkroom preview -m elevenlabs/eleven-v4 -v <voice>  # listen to a voice from darkroom voices <model>
darkroom preview -m fish-audio/s2.1-pro -v voice:me "Is this me?"   # own text; --no-play only prints the file path
darkroom music "calm acoustic guitar jingle, 120 bpm"
darkroom models                    # image models: price, references, ZDR status
darkroom models --details          # plus sizes, aspect ratios, formats, images per request, other parameters
darkroom models speech --details   # speech models: price, voices by language, cloning, instructions, ZDR status
darkroom models music --privacy off --search lyria
darkroom favorites                 # your favorite models; also: darkroom favorites image
darkroom favorites add microsoft/mai-image-2.6   # kind found in the catalogs (or --kind image|speech|music)
darkroom favorites remove microsoft/mai-image-2.6
darkroom voices elevenlabs/eleven-v4   # a model's voices by language, plus your own voices
darkroom voices                    # your own voices (voice:<name>)
darkroom elements                  # reference sets
darkroom costs                     # cost per model and in total
darkroom skill                     # usage guide for AI agents; --json on most commands, see below
```

`darkroom --help` and `darkroom gen --help` list all options. Options such as `-m` and `-r` take one value each; repeat them or separate models with commas. `darkroom models` checks the models against your privacy mode (`--privacy` to check another one) and marks favorites (♥), recommended models (★), the release month and models released in the last 30 days (new). Music models are never blocked: without a matching ZDR endpoint the prompt is sent without ZDR (with a notice), which the listing shows. `darkroom preview` plays a voice with `afplay` (macOS), `paplay`, `aplay` or `ffplay` (Linux) or PowerShell (Windows) and prints the file path (without a player only the path); previews of model voices are cached (marked "cached, free"), own voices and own texts are always generated, and Ctrl+C stops the playback. Result paths are printed so you can open them or pass them to `-r`. Ctrl+C cancels a running generation, including the upstream calls; a second Ctrl+C quits right away. A cancelled prompt or run exits with code 130. Outside a terminal the output is plain lines without colors or frames: results (path, cost, duration, model) one per line on stdout, progress, totals, warnings and errors on stderr (`FORCE_COLOR=1` keeps the colors).

## Use with AI agents

Install darkroom first (see [Install](#install)), so the `darkroom` command exists. Your agent knows nothing about darkroom until it reads the guide, and `darkroom skill` is a shell command, not a skill the agent already has. So tell it, for example:

> Run the shell command `darkroom skill` and follow the guide it prints.

From a source checkout without the installer there is no `darkroom` command; tell the agent to run `pnpm --silent --dir <path to the checkout> cli skill` instead, and the guide then names that command for everything else. The guide explains the commands, how to pick models, privacy, costs and the JSON output, so you can ask for things like _"Make three portrait variants of @me with the recommended models and read this text in my voice."_ The agent may offer to remember darkroom; it then saves a short pointer to that command, so it stays current after updates.

Agents spend your OpenRouter credit like you do; the guide tells them to check prices, start with one image and ask before larger batches. Your API key stays in `.env` or the web UI; never paste it into a chat.

With `--json` (on `gen`, `speak`, `music`, `preview`, `models`, `voices`, `elements`, `favorites` and `costs`) a command never asks and prints exactly one JSON document on stdout, e.g. `{ "ok": true, "results": [{ "file": "/…/out/….png", "model": "…", "cost": 0.04, … }], "errors": [], "cost": { "run": 0.04, "totalSoFar": 1.23 } }`, or `{ "ok": false, "error": { "code", "message", "params" } }` when the command fails. Exit codes: 0 for success (also when only some models failed), 1 when nothing worked or the input was invalid, 130 when cancelled.

## Privacy

Your photos, voice samples and results stay on your disk. Only the data needed for a request is sent to OpenRouter, and by default only to endpoints that don't retain it:

| Mode (`PRIVACY` or UI selection) | Effect                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `zdr` (default)                  | only Zero Data Retention endpoints; allows "safety retention" of flagged prompts (e.g. Google Vertex, up to 90 days, no training) |
| `zdr-strict`                     | only ZDR endpoints without safety retention                                                                                       |
| `off`                            | normal OpenRouter routing                                                                                                         |

For images, speech (including cloned voices) and API transcription, darkroom pins each request to the model's ZDR endpoints allowed by the mode, without fallbacks; models without one (e.g. OpenAI's GPT Image 2.5 as of November 2026) are not called in ZDR mode and the run shows an error instead. Local transcription with Whisper sends nothing. Music prompts usually contain no personal data, so music is never blocked: it is pinned to the ZDR endpoints the mode allows; in `zdr-strict` it falls back to ZDR endpoints with safety retention, and only a model without any ZDR endpoint runs unrestricted (both with a notice). Model ids that are not in the catalog (e.g. a typo) are rejected before any of this, so a typo never reaches OpenRouter. For extra safety, also enforce ZDR and disable training in your [OpenRouter privacy settings](https://openrouter.ai/settings/privacy).

## Configuration

All settings are optional except the API key. Put them in `.env` in your data folder (see [`.env.example`](.env.example)) or set them as environment variables; `DARKROOM_HOME` works only as an environment variable, since it decides where `.env` is:

| Variable                            | Default                                                 | Purpose                                                      |
| ----------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| `OPENROUTER_API_KEY`                |                                                         | your OpenRouter key (required)                               |
| `PORT`                              | `5177`                                                  | port of the local server                                     |
| `PRIVACY`                           | `zdr`                                                   | `zdr`, `zdr-strict` or `off`                                 |
| `DEFAULT_MODEL`                     | `google/gemini-3.1-flash-image`                         | model preselected in the UI and CLI                          |
| `REF_MAX_SIDE`                      | `1024`                                                  | longest side of reference images in px                       |
| `REQUEST_TIMEOUT_MS`                | `300000`                                                | generations often take 20–90 s                               |
| `TRANSCRIBE`                        | `local`                                                 | `local` (Whisper offline) or `api`                           |
| `WHISPER_MODEL`                     | `onnx-community/whisper-small`                          | local transcription model                                    |
| `TRANSCRIBE_MODEL`                  | `openai/whisper-large-v3-turbo`                         | API transcription model                                      |
| `DARKROOM_UPDATE_CHECK`             | on                                                      | `off` disables the daily check for a new GitHub release      |
| `DARKROOM_HOME`                     | `~/darkroom` (installed), repository root (from source) | environment only: folder holding `.env` and the data folders |
| `OUT_DIR`, `REFS_DIR`, `VOICES_DIR` | `out`, `refs`, `voices`                                 | individual data folders, relative to `DARKROOM_HOME`         |

Your data lives in these folders, all ignored by git:

```
refs/<element>/   reference images + element.json
voices/<voice>/   voice samples + voice.json
out/              images, audio, manifest.jsonl, uploads/ and debug/
models/           local Whisper models
favorites.json    your favorite models (web UI and CLI)
```

Costs come from OpenRouter's `usage.cost`; with several images per call the amount is split evenly. Deleting a result removes the file but only marks the manifest entry, so the cost total stays correct. Speech costs are reported a few seconds after generation and added automatically.

## Development

darkroom is a pnpm workspace with four packages. `packages/core` holds all logic; `apps/server` (Fastify) and `apps/cli` (commander) build on it; `apps/web` (React 19, Vite, Tailwind 4, zustand, i18next) talks to the server over HTTP and only imports types from core. [fallow](https://fallow.tools) enforces these boundaries.

```bash
pnpm dev          # server in watch mode + Vite dev server on http://localhost:5173
pnpm check        # typecheck, Biome, Vitest and fallow; run before every commit
pnpm test         # tests only; pnpm coverage writes coverage/index.html
pnpm format       # fix formatting and imports
```

Tests never touch your data or the network: every test file gets its own temporary data folder, and OpenRouter is replaced by an in-process fake. fallow runs without a baseline, so any new finding (dead code, duplication, complexity, boundary violations) fails the check.

To try the UI without your data and without API costs, start the bundled OpenRouter mock and a server with an empty data folder:

```bash
pnpm mock         # fake OpenRouter on port 5299 (solid-color images, a beep as speech)
DARKROOM_HOME=$(mktemp -d) PORT=5199 OPENROUTER_API_KEY=test OPENROUTER_BASE=http://127.0.0.1:5299/api/v1 pnpm start
```

The backend writes all messages in English and attaches a machine-readable code to each one, which the web UI translates (`apps/web/src/i18n/`).

### CI and releases

Changes reach `main` only through pull requests that pass CI; they are squash-merged. Label a pull request `enhancement`, `bug` or `documentation` to sort it in the release notes.

[CI](.github/workflows/ci.yml) runs on every push and pull request: typecheck, Biome, tests with coverage, fallow and the UI build, plus a real installation with `install.sh` / `install.ps1` on Linux, macOS and Windows that starts the UI and uninstalls again.

To publish a release, open **Actions → Release → Run workflow** on GitHub and choose the version bump (`patch`, `minor` (the default), `major`, or `none` to release the current version). The very first release is made with `none`, since `package.json` already says `0.1.0`. The [workflow](.github/workflows/release.yml) runs the full CI, bumps `package.json`, commits, tags `v<version>` and creates the GitHub release with notes generated from the merged pull requests. From then on the installers install it and running darkroom installations show the update. With the GitHub CLI: `gh workflow run release.yml -f bump=minor`.

## Responsible use

darkroom makes it easy to create realistic images and voices of real people. Only use photos and voice recordings of yourself or of people who have explicitly agreed, label generated content where it could be mistaken for real, and follow the terms of OpenRouter and the model providers.

## License

[MIT](LICENSE) © 2026 Alex Gassner

The optional local background removal uses [`@imgly/background-removal-node`](https://github.com/imgly/background-removal-js), which is licensed under **AGPL-3.0** and downloads a model of about 130 MB. If that license doesn't suit your use, remove it with `pnpm --filter @darkroom/core remove @imgly/background-removal-node`; all other features keep working.

darkroom is not affiliated with OpenRouter, getimg.ai or any model provider.
