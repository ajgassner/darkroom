// Wiring shared by the commands: the model catalogs behind a spinner, and one run of the interactive mode.
import type { CostSummary, ManifestEntry } from '@darkroom/core/contract';
import { rankModels } from '@darkroom/core/models/catalog';
import { readFavorites } from '@darkroom/core/models/favorites';
import { listMusicModels, listSpeechModels } from '@darkroom/core/openrouter/audio-models';
import { imagePrices, listImageModels, zdrEndpoints } from '@darkroom/core/openrouter/openrouter';
import { costSummary, readEntries } from '@darkroom/core/storage/manifest';
import pc from 'picocolors';
import { type CatalogImageModel, plural } from '../interactive/choices.ts';
import { commandLine, type ImageRun, type MusicRun, type SpeechRun } from '../interactive/command-line.ts';
import { type CliState, loadState, rememberRun } from '../interactive/state.ts';
import { out } from '../output/out.ts';
import { loading, resultFiles } from '../output/term.ts';

// ---------------------------------------------------------------- Catalogs

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

export const loadImageModels = () =>
  loading('Loading image models', (m) => plural(m.length, 'image model'), imageCatalog);
export const loadSpeechModels = () =>
  loading(
    'Loading speech models',
    (m) => plural(m.length, 'speech model'),
    async () => rankModels(await listSpeechModels(), 'speech', (await readFavorites()).speech),
  );
export const loadMusicModels = () =>
  loading(
    'Loading music models',
    (m) => plural(m.length, 'music model'),
    async () => rankModels(await listMusicModels(), 'music', (await readFavorites()).music),
  );

// ---------------------------------------------------------------- Interactive mode

/** Run, remember the choices and print the same run as a command line. */
export async function interactiveRun<R extends ImageRun | SpeechRun | MusicRun>(
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

export const remembered = (state: CliState, kind: keyof CliState) =>
  Object.fromEntries(Object.entries(state[kind] ?? {}).filter(([, v]) => v !== undefined));

/** What the interactive mode needs to know besides the answers. */
interface Context {
  state: CliState;
  costs: CostSummary;
}

export async function context(): Promise<Context> {
  return { state: await loadState(), costs: costSummary(await readEntries()) };
}
