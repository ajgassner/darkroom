// Voice previews (`darkroom preview` and "Listen to a preview" in the interactive speech run): what to say and
// how to report it. Generating and playing happen in studio.ts.

import { previewSentence } from '@darkroom/core/audio/voice-lang';
import type { PrivacyMode } from '@darkroom/core/config';
import type { SpeechModel } from '@darkroom/core/contract';
import { unknownModel } from '@darkroom/core/errors';

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
