// Runs, listings and the interactive mode, wired to core and the terminal (the commands in cli.ts call these).
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import * as p from '@clack/prompts';
import { listMusicModels, listSpeechModels } from '@darkroom/core/audio-models';
import { estimateImagePrice, estimateRunCost, estimateSpeechPrice } from '@darkroom/core/catalog';
import { DEFAULT_MODEL, DEFAULT_PRIVACY, OUT_DIR, type PrivacyMode } from '@darkroom/core/config';
import type { CostSummary, ManifestEntry } from '@darkroom/core/contract';
import { runGeneration } from '@darkroom/core/generate';
import { costSummary, readEntries } from '@darkroom/core/manifest';
import { runMusic } from '@darkroom/core/music';
import { imagePrices, listImageModels, zdrEndpoints } from '@darkroom/core/openrouter';
import { listElements } from '@darkroom/core/refs';
import { runSpeech } from '@darkroom/core/speech';
import { listVoices } from '@darkroom/core/voices';
import pc from 'picocolors';
import { resolveRefs } from './args.ts';
import { type CatalogImageModel, estimateText, plural, usd } from './choices.ts';
import {
  commandLine,
  genArgs,
  type ImageRun,
  type MusicRun,
  musicArgs,
  type SpeechRun,
  speakArgs,
} from './command-line.ts';
import { askImage, askMusic, askSpeech, BACK, type Mode, mainMenu, type Prompter, session } from './flow.ts';
import {
  imageModelBlocks,
  type ListOptions,
  type ModelKind,
  musicModelBlocks,
  speechModelBlocks,
  voiceBlocks,
} from './listing.ts';
import { fileOpener } from './open.ts';
import { type CliState, loadState, rememberRun } from './state.ts';
import { cancelled, loading, resultFiles, withProgress } from './term.ts';

export const SPEECH_MODEL = 'elevenlabs/eleven-v4';
export const MUSIC_MODEL = 'google/lyria-3-clip-preview';

// ---------------------------------------------------------------- Runs

export function runImage(r: ImageRun): Promise<ManifestEntry[]> {
  const extraRefs = resolveRefs(r.refs, OUT_DIR);
  return withProgress(
    `Generating ${r.models.map((m) => `${r.count}× ${m}`).join(', ')}`,
    r.models.length * r.count,
    (onEvent, signal) =>
      runGeneration(
        {
          prompt: r.prompt,
          models: r.models,
          element: r.element,
          usePrefix: r.prefix ?? true,
          extraRefs,
          count: r.count,
          aspectRatio: r.aspect,
          resolution: r.size,
          outputFormat: r.format,
          quality: r.quality,
          seed: r.seed,
          maxSide: r.maxSide,
          privacy: r.privacy,
        },
        onEvent,
        signal,
      ),
  );
}

export function runSpeechRun(r: SpeechRun): Promise<ManifestEntry[]> {
  return withProgress(`Speaking with ${r.model}`, 1, (onEvent, signal) =>
    runSpeech(
      {
        text: r.text,
        model: r.model,
        voice: r.voice,
        instructions: r.instructions,
        speed: r.speed,
        privacy: r.privacy,
      },
      onEvent,
      signal,
    ),
  );
}

export function runMusicRun(r: MusicRun): Promise<ManifestEntry[]> {
  return withProgress(`Composing with ${r.model}`, 1, (onEvent, signal) =>
    runMusic({ prompt: r.prompt, model: r.model, privacy: r.privacy }, onEvent, signal),
  );
}

/** Total of all runs so far. */
export async function totalLine(): Promise<string> {
  const all = costSummary(await readEntries());
  return `Total so far: ${usd(all.total)} for ${plural(all.images, 'result')}`;
}

// ---------------------------------------------------------------- Listings

async function imageCatalog(): Promise<CatalogImageModel[]> {
  const [models, zdr, prices] = await Promise.all([listImageModels(), zdrEndpoints(), imagePrices()]);
  return models.map((m) => ({ ...m, zdr: zdr.get(m.id) ?? [], price: prices.get(m.id) ?? null }));
}

const loadImageModels = () => loading('Loading image models', (m) => plural(m.length, 'image model'), imageCatalog);
const loadSpeechModels = () =>
  loading(
    'Loading speech models',
    (m) => plural(m.length, 'speech model'),
    () => listSpeechModels(),
  );
const loadMusicModels = () =>
  loading(
    'Loading music models',
    (m) => plural(m.length, 'music model'),
    () => listMusicModels(),
  );

const BLOCKS: Record<ModelKind, (o: ListOptions) => Promise<string[]>> = {
  image: async (o) => imageModelBlocks(await loadImageModels(), o),
  speech: async (o) => speechModelBlocks(await loadSpeechModels(), o),
  music: async (o) => musicModelBlocks(await loadMusicModels(), o),
};

export async function showModels(kind: ModelKind, o: ListOptions): Promise<void> {
  const blocks = await BLOCKS[kind](o);
  if (!blocks.length) return p.log.warn('No models match');
  for (const b of blocks) p.log.message(b);
  if (kind === 'speech') p.log.info(`Voices of a model: ${pc.bold('darkroom voices <model>')}`);
}

/** Own voices, or a speech model's voices by language together with the own voices. */
export async function showVoices(modelId?: string): Promise<void> {
  const own = await listVoices();
  if (modelId) {
    const model = (await loadSpeechModels()).find((m) => m.id === modelId);
    if (!model) throw new Error(`Unknown speech model: ${modelId} (see darkroom models speech)`);
    for (const b of voiceBlocks(model, own)) p.log.message(b);
    return;
  }
  if (!own.length) return p.log.info('No own voices yet. Record one in the web UI (Audio → Own voices).');
  for (const v of own)
    p.log.message(`${pc.bold(`voice:${v.name}`)}  ${pc.dim(`${v.label} · ${plural(v.samples.length, 'sample')}`)}`);
}

export async function showElements(): Promise<void> {
  const els = await listElements();
  if (!els.length) return p.log.info('No elements yet. Create one in the web UI or add photos to refs/<name>/.');
  for (const e of els)
    p.log.message(
      `${pc.bold(`@${e.name}`)}  ${pc.dim(`${e.type} · ${e.label} · ${plural(e.photos.length, 'image')}`)}`,
    );
}

export async function showCosts(): Promise<void> {
  const s = costSummary(await readEntries());
  const lines = Object.entries(s.byModel)
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([m, v]) => `${usd(v.cost).padStart(10)}  ${String(v.images).padStart(4)}  ${m}`);
  p.note(
    [...lines, pc.bold(`${usd(s.total).padStart(10)}  ${String(s.images).padStart(4)}  total`)].join('\n'),
    'Costs',
  );
}

/** Run the web UI server until it stops (Ctrl+C); the CLI exits with its exit code. */
export function startWeb(): Promise<never> {
  // The server is its own app: run it as a child process instead of importing it into the CLI
  const server = path.resolve(import.meta.dirname, '../../server/src/server.ts');
  const child = spawn(process.execPath, [server], { stdio: 'inherit' });
  // Pass signals on and wait for the server to shut down. Ctrl+C in a terminal also reaches the server directly
  // (same process group): it takes the forwarded copy right after as the same Ctrl+C. Windows has no signals:
  // kill() ends the server abruptly there, so Ctrl+C (which reaches it through the shared console) is not passed on.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (signal === 'SIGTERM' || process.platform !== 'win32') child.kill(signal);
    });
  }
  return new Promise(() => {
    child.on('exit', (code, signal) => process.exit(code ?? 128 + (signal ? os.constants.signals[signal] : 0)));
  });
}

// ---------------------------------------------------------------- Interactive mode

/** Run, remember the choices and print the same run as a command line. */
async function interactiveRun<R extends ImageRun | SpeechRun | MusicRun>(
  kind: 'image' | 'speech' | 'music',
  r: R,
  run: (r: R) => Promise<ManifestEntry[]>,
  argv: string[],
): Promise<string[]> {
  await rememberRun(kind, r);
  const entries = await run(r);
  p.log.message(`${pc.dim('Same run without questions:')}\n${commandLine(argv)}`);
  return resultFiles(entries);
}

const remembered = (state: CliState, kind: keyof CliState) =>
  Object.fromEntries(Object.entries(state[kind] ?? {}).filter(([, v]) => v !== undefined));

/** What the interactive mode needs to know besides the answers. */
interface Context {
  state: CliState;
  costs: CostSummary;
}

async function context(): Promise<Context> {
  return { state: await loadState(), costs: costSummary(await readEntries()) };
}

function imageMode(ui: Prompter, fixed: Partial<ImageRun>): Mode<ImageRun> {
  return {
    ask: async (previous) => {
      const { state, costs } = await context();
      return askImage(ui, {
        fixed: previous ? {} : fixed,
        initial: previous ?? remembered(state, 'image'),
        privacy: DEFAULT_PRIVACY,
        defaultModel: DEFAULT_MODEL,
        models: loadImageModels,
        elements: await listElements(),
        estimate: (r, models) =>
          estimateText(
            estimateRunCost(
              r.models.map((id) => {
                const m = models.find((x) => x.id === id);
                return {
                  model: id,
                  count: r.count,
                  listPrice: m ? estimateImagePrice(m, m.price, r.size, r.quality) : null,
                };
              }),
              costs,
            ),
          ),
      });
    },
    run: (r) => interactiveRun('image', r, runImage, genArgs(r)),
  };
}

function speechMode(ui: Prompter, fixed: Partial<SpeechRun>): Mode<SpeechRun> {
  return {
    ask: async (previous) => {
      const { state, costs } = await context();
      return askSpeech(ui, {
        fixed: previous ? {} : fixed,
        initial: previous ?? remembered(state, 'speech'),
        privacy: DEFAULT_PRIVACY,
        defaultModel: SPEECH_MODEL,
        models: loadSpeechModels,
        ownVoices: await listVoices(),
        estimate: (r, m) =>
          estimateText(
            estimateRunCost(
              [{ model: r.model, count: 1, listPrice: m ? estimateSpeechPrice(m, r.text) : null }],
              costs,
            ),
          ),
      });
    },
    run: (r) => interactiveRun('speech', r, runSpeechRun, speakArgs(r)),
  };
}

function musicMode(ui: Prompter, fixed: Partial<MusicRun>): Mode<MusicRun> {
  return {
    ask: async (previous) => {
      const { state, costs } = await context();
      return askMusic(ui, {
        fixed: previous ? {} : fixed,
        initial: previous ?? remembered(state, 'music'),
        privacy: DEFAULT_PRIVACY,
        defaultModel: MUSIC_MODEL,
        models: loadMusicModels,
        estimate: (r) => estimateText(estimateRunCost([{ model: r.model, count: 1, listPrice: null }], costs)),
      });
    },
    run: (r) => interactiveRun('music', r, runMusicRun, musicArgs(r)),
  };
}

/** Models submenu: which list to show. */
async function modelsMenu(ui: Prompter, privacy: PrivacyMode): Promise<void> {
  const kind = await ui.select<ModelKind | 'voices'>({
    message: 'Which models?',
    options: [
      { value: 'image', label: 'Image models' },
      { value: 'speech', label: 'Speech models' },
      { value: 'music', label: 'Music models' },
      { value: 'voices', label: 'Voices of a speech model' },
    ],
  });
  if (kind === BACK) return;
  if (kind !== 'voices') return showModels(kind, { privacy });
  const models = await loadSpeechModels();
  const id = await ui.search({ message: 'Speech model', options: models.map((m) => ({ value: m.id, label: m.id })) });
  if (id !== BACK) await showVoices(id);
}

export interface Fixed {
  image?: Partial<ImageRun>;
  speech?: Partial<SpeechRun>;
  music?: Partial<MusicRun>;
}

/** The main menu (plain `darkroom` in a terminal). */
async function menu(ui: Prompter, fixed: Fixed): Promise<void> {
  const open = fileOpener();
  await mainMenu(ui, {
    image: () => session(ui, imageMode(ui, fixed.image ?? {}), open),
    speech: () => session(ui, speechMode(ui, fixed.speech ?? {}), open),
    music: () => session(ui, musicMode(ui, fixed.music ?? {}), open),
    models: () => modelsMenu(ui, DEFAULT_PRIVACY).then(() => 'menu' as const),
    library: async () => {
      await showElements();
      await showVoices();
      return 'menu';
    },
    costs: () => showCosts().then(() => 'menu' as const),
    web: startWeb,
  });
}

/**
 * Interactive mode: `start` is the kind of run to begin with (`darkroom gen` without a prompt …), or the main
 * menu. Leaving the first question with Escape cancels (exit 130); "Quit" ends with 0.
 */
export async function interactiveMode(ui: Prompter, start: keyof Fixed | 'menu', fixed: Fixed = {}): Promise<never> {
  if (start !== 'menu') {
    const modes = { image: imageMode, speech: speechMode, music: musicMode } as const;
    const mode = modes[start](ui, fixed[start] as never);
    const r = await session(ui, mode as Mode<unknown>, fileOpener());
    if (r === BACK) cancelled();
    if (r === 'quit') bye();
  }
  await menu(ui, {});
  bye();
}

function bye(): never {
  p.outro(pc.dim('Bye'));
  process.exit(0);
}
