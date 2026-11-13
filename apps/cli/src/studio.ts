// Runs, listings and the interactive mode, wired to core and the terminal (the commands in cli.ts call these).
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { listMusicModels, listSpeechModels } from '@darkroom/core/audio-models';
import { estimateImagePrice, estimateRunCost, estimateSpeechPrice, rankModels } from '@darkroom/core/catalog';
import { DEFAULT_MODEL, DEFAULT_PRIVACY, OUT_DIR, type PrivacyMode } from '@darkroom/core/config';
import type { CostSummary, ManifestEntry, ModelKind, SpeechModel } from '@darkroom/core/contract';
import { unknownModel } from '@darkroom/core/errors';
import { inCatalog, MODEL_KINDS, modelKindOf, readFavorites, setFavorite } from '@darkroom/core/favorites';
import { runGeneration } from '@darkroom/core/generate';
import { costSummary, readEntries } from '@darkroom/core/manifest';
import { runMusic } from '@darkroom/core/music';
import { imagePrices, listImageModels, zdrEndpoints } from '@darkroom/core/openrouter';
import { listElements } from '@darkroom/core/refs';
import { runSpeech, speechDemo } from '@darkroom/core/speech';
import { listVoices } from '@darkroom/core/voices';
import pc from 'picocolors';
import { displayPath, resolveRefs } from './args.ts';
import { type CatalogImageModel, estimateText, FAVORITE_MARK, plural, usd } from './choices.ts';
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
  favoriteBlocks,
  imageModelBlocks,
  LEGEND,
  type ListOptions,
  musicModelBlocks,
  speechModelBlocks,
  voiceBlocks,
} from './listing.ts';
import { fileOpener } from './open.ts';
import { out } from './out.ts';
import { type Playback, playFile } from './play.ts';
import { type PreviewRequest, previewCall, previewDetails, userLanguage } from './preview.ts';
import { type CliState, loadState, rememberRun } from './state.ts';
import { cancelled, failSpinner, loading, resultFiles, withProgress } from './term.ts';

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

/**
 * Voice preview: generated (or taken from the cache), its path printed and played unless `play` is false.
 * `models` saves loading the speech catalog again (interactive mode).
 */
export async function previewVoice(
  r: PreviewRequest,
  o: { play: boolean; models?: SpeechModel[] },
): Promise<Playback | 'off'> {
  const models = o.models ?? (await loadSpeechModels());
  const call = previewCall(r, models, userLanguage(process.env, Intl.DateTimeFormat().resolvedOptions().locale));
  const demo = await loading(
    `Preview of ${r.voice || 'the model default voice'}`,
    (d) => (d.cached ? 'Preview from the cache' : 'Preview generated'),
    () => speechDemo(call),
  );
  const file = path.join(OUT_DIR, demo.file);
  out.success(`${pc.bold(displayPath(file, process.cwd()))}  ${pc.dim(previewDetails(r, demo.cached))}`);
  if (!o.play) return 'off';
  const playback = await playFile(file, () => out.hint(pc.dim('Playing (Ctrl+C stops)')));
  if (playback === 'none') out.hint('No audio player found (afplay, paplay, aplay or ffplay): open the file above.');
  return playback;
}

// ---------------------------------------------------------------- Listings

// The catalogs come ranked like in the web UI: favorites, recommended, then newest first

async function imageCatalog(): Promise<CatalogImageModel[]> {
  const [models, zdr, prices, favorites] = await Promise.all([
    listImageModels(),
    zdrEndpoints(),
    imagePrices(),
    readFavorites(),
  ]);
  const infos = models.map((m) => ({ ...m, zdr: zdr.get(m.id) ?? [], price: prices.get(m.id) ?? null }));
  return rankModels(infos, 'image', favorites.image);
}

const loadImageModels = () => loading('Loading image models', (m) => plural(m.length, 'image model'), imageCatalog);
const loadSpeechModels = () =>
  loading(
    'Loading speech models',
    (m) => plural(m.length, 'speech model'),
    async () => rankModels(await listSpeechModels(), 'speech', (await readFavorites()).speech),
  );
const loadMusicModels = () =>
  loading(
    'Loading music models',
    (m) => plural(m.length, 'music model'),
    async () => rankModels(await listMusicModels(), 'music', (await readFavorites()).music),
  );

const BLOCKS: Record<ModelKind, (o: ListOptions) => Promise<string[]>> = {
  image: async (o) => imageModelBlocks(await loadImageModels(), o),
  speech: async (o) => speechModelBlocks(await loadSpeechModels(), o),
  music: async (o) => musicModelBlocks(await loadMusicModels(), o),
};

export async function showModels(kind: ModelKind, o: ListOptions): Promise<void> {
  const blocks = await BLOCKS[kind](o);
  if (!blocks.length) return out.warn('No models match');
  out.message(blocks.join('\n\n'));
  out.hint(pc.dim(LEGEND));
  if (kind === 'speech') out.hint(`Voices of a model: ${pc.bold('darkroom voices <model>')}`);
}

// ---------------------------------------------------------------- Favorites

/** The favorites of one kind or all kinds (no network needed). */
export async function showFavorites(kind?: ModelKind): Promise<void> {
  out.message(favoriteBlocks(await readFavorites(), kind ? [kind] : MODEL_KINDS).join('\n\n'));
}

/** Add a model to the favorites; its kind comes from the catalogs unless given. */
export async function addFavorite(model: string, kind?: ModelKind): Promise<void> {
  const k = await loading(
    'Looking up the model',
    (k) => `${k} model`,
    async () => {
      if (!kind) return modelKindOf(model);
      if (!(await inCatalog(kind, model))) throw unknownModel(model);
      return kind;
    },
  );
  await setFavorite(k, model, true);
  out.success(`${FAVORITE_MARK} ${model} is one of your ${k} favorites`);
}

/** Remove a model from the favorites of its kind (or of every kind that has it); any id works. */
export async function removeFavorite(model: string, kind?: ModelKind): Promise<void> {
  const favorites = await readFavorites();
  const kinds = kind ? [kind] : MODEL_KINDS.filter((k) => favorites[k].includes(model));
  if (!kinds.some((k) => favorites[k].includes(model))) return out.info(`${model} is not a favorite`);
  for (const k of kinds) await setFavorite(k, model, false);
  out.success(`Removed ${model} from your ${kinds.join(' and ')} favorites`);
}

/** Next step "Add to favorites" of the interactive mode: the models of the run that are not favorites yet. */
async function favoriteRun(kind: ModelKind, models: string[]): Promise<string> {
  const known = (await readFavorites())[kind];
  const added: string[] = [];
  for (const m of models.filter((id) => !known.includes(id))) {
    if (!(await inCatalog(kind, m))) continue;
    await setFavorite(kind, m, true);
    added.push(m);
  }
  return added.length
    ? `${FAVORITE_MARK} Added ${added.join(', ')} to your ${kind} favorites`
    : `Nothing to add: already a favorite or not in the catalog`;
}

/** Own voices, or a speech model's voices by language together with the own voices. */
export async function showVoices(modelId?: string): Promise<void> {
  const own = await listVoices();
  if (modelId) {
    const model = (await loadSpeechModels()).find((m) => m.id === modelId);
    if (!model) throw new Error(`Unknown speech model: ${modelId} (see darkroom models speech)`);
    out.message(voiceBlocks(model, own).join('\n\n'));
    return;
  }
  if (!own.length) return out.info('No own voices yet. Record one in the web UI (Audio → Own voices).');
  for (const v of own)
    out.message(`${pc.bold(`voice:${v.name}`)}  ${pc.dim(`${v.label} · ${plural(v.samples.length, 'sample')}`)}`);
}

export async function showElements(): Promise<void> {
  const els = await listElements();
  if (!els.length) return out.info('No elements yet. Create one in the web UI or add photos to refs/<name>/.');
  for (const e of els)
    out.message(`${pc.bold(`@${e.name}`)}  ${pc.dim(`${e.type} · ${e.label} · ${plural(e.photos.length, 'image')}`)}`);
}

export async function showCosts(): Promise<void> {
  const s = costSummary(await readEntries());
  const lines = Object.entries(s.byModel)
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([m, v]) => `${usd(v.cost).padStart(10)}  ${String(v.images).padStart(4)}  ${m}`);
  out.note([...lines, pc.bold(`${usd(s.total).padStart(10)}  ${String(s.images).padStart(4)}  total`)], 'Costs');
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
  out.message(`${pc.dim('Same run without questions:')}\n${commandLine(argv)}`);
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
    favorite: (r) => favoriteRun('image', r.models),
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
        preview: async (r) => {
          try {
            // The catalog is cached in core: no second loading spinner
            await previewVoice(r, { play: true, models: await listSpeechModels() });
          } catch (err) {
            failSpinner();
            out.error((err as Error).message);
          }
        },
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
    favorite: (r) => favoriteRun('speech', [r.model]),
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
    favorite: (r) => favoriteRun('music', [r.model]),
  };
}

/** Models submenu: which list to show. */
async function modelsMenu(ui: Prompter, privacy: PrivacyMode): Promise<void> {
  const kind = await ui.select<ModelKind | 'voices' | 'favorites'>({
    message: 'Which models?',
    options: [
      { value: 'image', label: 'Image models' },
      { value: 'speech', label: 'Speech models' },
      { value: 'music', label: 'Music models' },
      { value: 'voices', label: 'Voices of a speech model' },
      { value: 'favorites', label: 'Your favorites', hint: 'darkroom favorites add|remove <model>' },
    ],
  });
  if (kind === BACK) return;
  if (kind === 'favorites') return showFavorites();
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
  out.outro(pc.dim('Bye'));
  process.exit(0);
}
