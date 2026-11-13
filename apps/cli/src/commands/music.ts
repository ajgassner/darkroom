// `darkroom music`: a music run, and its questions in the interactive mode.
import { runMusic } from '@darkroom/core/audio/music';
import { DEFAULT_PRIVACY } from '@darkroom/core/config';
import type { ManifestEntry } from '@darkroom/core/contract';
import { estimateRunCost } from '@darkroom/core/models/catalog';
import { estimateText } from '../interactive/choices.ts';
import { type MusicRun, musicArgs } from '../interactive/command-line.ts';
import { askMusic, type Mode, type Prompter } from '../interactive/flow.ts';
import { withProgress } from '../output/term.ts';
import { favoriteRun } from './favorites.ts';
import { context, interactiveRun, loadMusicModels, remembered } from './shared.ts';

export const MUSIC_MODEL = 'google/lyria-3-clip-preview';

export function runMusicRun(r: MusicRun): Promise<ManifestEntry[]> {
  return withProgress(`Composing with ${r.model}`, 1, (onEvent, signal) =>
    runMusic({ prompt: r.prompt, model: r.model, privacy: r.privacy }, onEvent, signal),
  );
}

export function musicMode(ui: Prompter, fixed: Partial<MusicRun>): Mode<MusicRun> {
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
