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
- **Parameters that fit each model**: aspect ratios, sizes, formats and reference limits come live from the OpenRouter catalog; unsupported values snap to the closest supported one.
- **Privacy by default**: requests only go to Zero Data Retention endpoints unless you switch it off.
- **Image tools**: upscale, expand canvas, relight and clean up backgrounds with AI; resize, crop and remove backgrounds locally for free.
- **Audio**: text-to-speech with 39 models, cloned voices from your own samples, and music with Google Lyria.
- **Web UI and CLI** with the same features. The UI is available in English and German.
- **Full record**: every result lands in `out/` together with a manifest of prompt, model, parameters, provider, cost and duration, plus the exact request and response for debugging.

## Install

You need an [OpenRouter API key](https://openrouter.ai/settings/keys). The installer brings its own Node.js, so nothing else has to be installed first.

**macOS and Linux**, in a terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/ajgassner/darkroom/main/install.sh | bash
```

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

The installer installs the latest [release](https://github.com/ajgassner/darkroom/releases). When a newer one is out, the web UI shows an **Update** badge and `darkroom start` prints a note (darkroom asks GitHub at most once a day; `DARKROOM_UPDATE_CHECK=off` disables it). `darkroom update` installs it; your data stays untouched. `darkroom uninstall` removes the app and the PATH entry; `~/darkroom` holds your data, delete it only if you don't need it anymore.

### From source

For development, or if you prefer to run darkroom from a git checkout with Node.js 26 and pnpm:

```bash
git clone https://github.com/ajgassner/darkroom.git
cd darkroom
mise install                # Node 26 and corepack (pnpm); or install Node 26 yourself and run: corepack enable
pnpm install
pnpm build                  # build the web UI
pnpm start                  # open http://localhost:5177 and enter your API key
```

In a checkout, `pnpm cli <command>` runs the same commands as `darkroom <command>`, and the data lives in the checkout itself. Node runs the TypeScript backend and CLI directly; only the web UI is built. The server only listens on `127.0.0.1`.

## First steps

Start the web UI and create your first element: **Element → Manage**, enter a name such as `me` and drag in 3–6 photos. Good reference photos show only you, with the face clearly visible from the front and slightly from the side, in different lighting, without sunglasses or heavy filters.

## Elements and @mentions

An element is a folder `refs/<name>/` with images and an `element.json`, editable in the UI under **Element → Manage**:

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

Mention elements in the prompt with `@name` (suggestions appear as you type), for example: _"A picture of @max in the office with the @companylogo in the top right"_. The element selected in the dropdown is always included; mentioned ones are added.

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

**Keep editing** uses any result as an additional reference for the next prompt. **Remove metadata on download** strips EXIF, XMP, IPTC and C2PA data (and ID3 tags from MP3) losslessly. Invisible pixel watermarks such as Google's SynthID cannot be removed.

## Audio

- **Speech**: choose a model and voice, optionally add a style instruction (e.g. "calm and friendly"; Gemini, Fish Audio and OpenAI) and the speed.
- **Your own voice**: under **Own voices**, record or upload a 10–30 s sample. Samples are transcribed automatically, either locally with Whisper (offline, about 250 MB downloaded on first use) or via the API, and you can correct the transcript. Voice cloning works with Fish Audio, Seed Audio and HeyGen.
- **Music**: Google Lyria 3 (a 30 s clip costs about $0.04, a full song with Pro about $0.08). Lyria has no Zero Data Retention, so keep personal details out of music prompts.

## CLI

```bash
# default model, element "me", portrait 3:4 in 2K
darkroom gen -e me -a 3:4 -s 2K "Business portrait in a bright office, suit, soft window light"

# @mentions, three models in parallel, 2 images each
darkroom gen -n 2 -m google/gemini-3.1-flash-image,google/gemini-3-pro-image,bytedance-seed/seedream-4.5 \
  "Outdoor portrait of @me in an autumn park"

# keep editing a result (a file from out/ as an additional reference)
darkroom gen -e me -r 2026-11-12T18-30-00_google_gemini-3.1-flash-image_1.png "same scene, but with glasses"

darkroom start                     # web UI on http://localhost:5177
darkroom gen                       # interactive: asks for prompt and element
darkroom speak -v voice:me "Hello, this is my cloned voice."
darkroom music "calm acoustic guitar jingle, 120 bpm"
darkroom models --search gemini    # models with reference support, parameters and ZDR status
darkroom elements                  # reference sets
darkroom voices                    # your voices
darkroom costs                     # cost per model and in total
```

`darkroom --help` and `darkroom gen --help` list all options. Options such as `-m` and `-r` take one value each; repeat them or separate models with commas. Ctrl+C cancels a running generation, including the upstream calls.

## Privacy

Your photos, voice samples and results stay on your disk. Only the data needed for a request is sent to OpenRouter, and by default only to endpoints that don't retain it:

| Mode (`PRIVACY` or UI selection) | Effect                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `zdr` (default)                  | only Zero Data Retention endpoints; allows "safety retention" of flagged prompts (e.g. Google Vertex, up to 90 days, no training) |
| `zdr-strict`                     | only ZDR endpoints without safety retention                                                                                       |
| `off`                            | normal OpenRouter routing                                                                                                         |

For images, darkroom pins each request to the model's ZDR endpoints without fallbacks; models without one (e.g. GPT Image 2 or FLUX.2 as of November 2026) are skipped in ZDR mode. For speech it sets `provider.zdr`. For extra safety, also enforce ZDR and disable training in your [OpenRouter privacy settings](https://openrouter.ai/settings/privacy).

## Configuration

All settings are optional except the API key. Put them in `.env` in your data folder (see [`.env.example`](.env.example)):

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
| `DARKROOM_HOME`                     | `~/darkroom` (installed), repository root (from source) | folder holding `.env`, `refs/`, `voices/`, `out/`, `models/` |
| `OUT_DIR`, `REFS_DIR`, `VOICES_DIR` | `out`, `refs`, `voices`                                 | individual data folders, relative to `DARKROOM_HOME`         |

Your data lives in these folders, all ignored by git:

```
refs/<element>/   reference images + element.json
voices/<voice>/   voice samples + voice.json
out/              images, audio, manifest.jsonl, uploads/ and debug/
models/           local Whisper models
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

To publish a release, open **Actions → Release → Run workflow** on GitHub and choose the version bump (`patch`, `minor`, `major`, or `none` to release the current version). The [workflow](.github/workflows/release.yml) runs the full CI, bumps `package.json`, commits, tags `v<version>` and creates the GitHub release with notes generated from the merged pull requests. From then on the installers install it and running darkroom installations show the update. With the GitHub CLI: `gh workflow run release.yml -f bump=minor`.

## Responsible use

darkroom makes it easy to create realistic images and voices of real people. Only use photos and voice recordings of yourself or of people who have explicitly agreed, label generated content where it could be mistaken for real, and follow the terms of OpenRouter and the model providers.

## License

[MIT](LICENSE) © 2026 Alex Gassner

The optional local background removal uses [`@imgly/background-removal-node`](https://github.com/imgly/background-removal-js), which is licensed under **AGPL-3.0** and downloads a model of about 130 MB. If that license doesn't suit your use, remove it with `pnpm --filter @darkroom/core remove @imgly/background-removal-node`; all other features keep working.

darkroom is not affiliated with OpenRouter, getimg.ai or any model provider.
