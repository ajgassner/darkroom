// `darkroom speak`: a speech run, and its questions in the interactive mode.
import { runSpeech } from '@darkroom/core/audio/speech';
import { listVoices } from '@darkroom/core/audio/voices';
import { DEFAULT_PRIVACY } from '@darkroom/core/config';
import type { ManifestEntry } from '@darkroom/core/contract';
import { estimateRunCost, estimateSpeechPrice } from '@darkroom/core/models/catalog';
import { listSpeechModels } from '@darkroom/core/openrouter/audio-models';
import { estimateText } from '../interactive/choices.ts';
import { type SpeechRun, speakArgs } from '../interactive/command-line.ts';
import { askSpeech, type Mode, type Prompter } from '../interactive/flow.ts';
import { out } from '../output/out.ts';
import { failSpinner, withProgress } from '../output/term.ts';
import { favoriteRun } from './favorites.ts';
import { previewVoice } from './preview.ts';
import { context, interactiveRun, loadSpeechModels, remembered } from './shared.ts';

export const SPEECH_MODEL = 'elevenlabs/eleven-v4';

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

export function speechMode(ui: Prompter, fixed: Partial<SpeechRun>): Mode<SpeechRun> {
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
