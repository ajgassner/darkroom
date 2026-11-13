// `darkroom gen`: an image run, and its questions in the interactive mode.
import { DEFAULT_MODEL, DEFAULT_PRIVACY, OUT_DIR } from '@darkroom/core/config';
import type { ManifestEntry } from '@darkroom/core/contract';
import { listElements } from '@darkroom/core/elements/refs';
import { runGeneration } from '@darkroom/core/image/generate';
import { estimateImagePrice, estimateRunCost } from '@darkroom/core/models/catalog';
import { costSummary, readEntries } from '@darkroom/core/storage/manifest';
import { resolveRefs } from '../args.ts';
import { estimateText, plural, usd } from '../interactive/choices.ts';
import { genArgs, type ImageRun } from '../interactive/command-line.ts';
import { askImage, type Mode, type Prompter } from '../interactive/flow.ts';
import { withProgress } from '../output/term.ts';
import { favoriteRun } from './favorites.ts';
import { context, interactiveRun, loadImageModels, remembered } from './shared.ts';

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

/** Total of all runs so far. */
export async function totalLine(): Promise<string> {
  const all = costSummary(await readEntries());
  return `Total so far: ${usd(all.total)} for ${plural(all.images, 'result')}`;
}

export function imageMode(ui: Prompter, fixed: Partial<ImageRun>): Mode<ImageRun> {
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
