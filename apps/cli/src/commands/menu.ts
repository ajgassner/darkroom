// Interactive mode: the main menu (plain `darkroom` in a terminal) and the sessions of gen, speak and music
// without their required input. The questions themselves live in interactive/flow.ts.
import { DEFAULT_PRIVACY, type PrivacyMode } from '@darkroom/core/config';
import type { ModelKind } from '@darkroom/core/contract';
import pc from 'picocolors';
import type { ImageRun, MusicRun, SpeechRun } from '../interactive/command-line.ts';
import { BACK, type Mode, mainMenu, type Prompter, session } from '../interactive/flow.ts';
import { out } from '../output/out.ts';
import { cancelled } from '../output/term.ts';
import { fileOpener } from '../platform/open.ts';
import { showFavorites } from './favorites.ts';
import { imageMode } from './image.ts';
import { musicMode } from './music.ts';
import { loadSpeechModels } from './shared.ts';
import { showCosts, showElements, showModels, showVoices } from './show.ts';
import { speechMode } from './speech.ts';
import { startWeb } from './web.ts';

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
