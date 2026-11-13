// Voice previews (`darkroom preview` and "Listen to a preview" in the interactive speech run): what to say, how to
// report it, and generating and playing it.
import path from 'node:path';
import { speechDemo } from '@darkroom/core/audio/speech';
import { previewSentence } from '@darkroom/core/audio/voice-lang';
import { OUT_DIR, type PrivacyMode } from '@darkroom/core/config';
import type { SpeechModel } from '@darkroom/core/contract';
import { unknownModel } from '@darkroom/core/errors';
import pc from 'picocolors';
import { displayPath } from '../args.ts';
import { out } from '../output/out.ts';
import { loading } from '../output/term.ts';
import { type Playback, playFile } from '../platform/play.ts';
import { loadSpeechModels } from './shared.ts';

export interface PreviewRequest {
  model: string;
  /** A model voice, voice:<name> for an own voice, or '' for the model's default voice. */
  voice: string;
  /** Own text; without it a sentence in the voice's language. */
  text?: string;
  privacy: PrivacyMode;
}

/** The user's language from the locale environment (LC_ALL, LC_MESSAGES, LANG), else from `locale`. */
export function userLanguage(env: Record<string, string | undefined>, locale: string): string {
  const tag = [env.LC_ALL, env.LC_MESSAGES, env.LANG, locale].find((v) => v && /^[a-z]{2}([_.-]|$)/i.test(v));
  return tag?.slice(0, 2).toLowerCase() ?? 'en';
}

/**
 * The arguments for core's speechDemo. Previews of model voices are cached per model and voice, so an own text
 * is always generated (it then becomes the cached preview). Throws for an unknown model or voice.
 */
export function previewCall(
  r: PreviewRequest,
  models: SpeechModel[],
  userLang: string,
): { model: string; voice: string; text: string; privacy: PrivacyMode; regenerate: boolean } {
  const model = models.find((m) => m.id === r.model);
  if (!model) throw unknownModel(r.model);
  if (r.voice && !r.voice.startsWith('voice:') && model.voices.length && !model.voices.includes(r.voice)) {
    throw new Error(`Unknown voice "${r.voice}" for ${r.model} (list: darkroom voices ${r.model})`);
  }
  const text = r.text?.trim();
  return {
    model: r.model,
    voice: r.voice,
    text: text || previewSentence(model, r.voice, userLang),
    privacy: r.privacy,
    regenerate: Boolean(text),
  };
}

/** What the preview line says after the path: "cached, free" or "new", the voice and the model. */
export function previewDetails(r: PreviewRequest, cached: boolean): string {
  return [cached ? 'cached, free' : 'new', r.voice || 'model default voice', r.model].join(' · ');
}

/** A voice preview: the audio file (absolute), whether it came from the cache, and how playing it went. */
export interface Preview {
  file: string;
  cached: boolean;
  playback: Playback | 'off';
}

/**
 * Voice preview: generated (or taken from the cache), its path printed and played unless `play` is false.
 * `models` saves loading the speech catalog again (interactive mode).
 */
export async function previewVoice(r: PreviewRequest, o: { play: boolean; models?: SpeechModel[] }): Promise<Preview> {
  const models = o.models ?? (await loadSpeechModels());
  const call = previewCall(r, models, userLanguage(process.env, Intl.DateTimeFormat().resolvedOptions().locale));
  const demo = await loading(
    `Preview of ${r.voice || 'the model default voice'}`,
    (d) => (d.cached ? 'Preview from the cache' : 'Preview generated'),
    () => speechDemo(call),
  );
  const file = path.join(OUT_DIR, demo.file);
  out.success(`${pc.bold(displayPath(file, process.cwd()))}  ${pc.dim(previewDetails(r, demo.cached))}`);
  if (!o.play) return { file, cached: demo.cached, playback: 'off' };
  const playback = await playFile(file, () => out.hint(pc.dim('Playing (Ctrl+C stops)')));
  if (playback === 'none') out.hint('No audio player found (afplay, paplay, aplay or ffplay): open the file above.');
  return { file, cached: demo.cached, playback };
}
