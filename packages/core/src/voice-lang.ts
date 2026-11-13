// Languages of speech model voices, derived from provider naming conventions (for grouping voices in a client).
import type { SpeechModel, VoiceInfo } from './contract.ts';

/** ISO 639-1 codes a voice suffix or prefix may carry. */
const CODES = new Set(
  'de en fr es it pt nl ja zh ko hi ar cs da fi pl ru sv tr nb no el hu ro uk id vi th he sk bg hr ca ms ta bn'.split(
    ' ',
  ),
);
/** Language words used as voice prefixes, e.g. "German_Female". */
const WORDS: Record<string, string> = {
  english: 'en',
  german: 'de',
  chinese: 'zh',
  cantonese: 'zh',
  spanish: 'es',
  french: 'fr',
  japanese: 'ja',
  korean: 'ko',
  portuguese: 'pt',
  italian: 'it',
  russian: 'ru',
  arabic: 'ar',
  dutch: 'nl',
  turkish: 'tr',
  polish: 'pl',
  indonesian: 'id',
  vietnamese: 'vi',
  thai: 'th',
  hindi: 'hi',
  ukrainian: 'uk',
  czech: 'cs',
  finnish: 'fi',
  romanian: 'ro',
  greek: 'el',
};
/** Kokoro voices start with a language letter, e.g. "af_heart" (American English, female). */
const KOKORO: Record<string, string> = {
  a: 'en-US',
  b: 'en-GB',
  e: 'es',
  f: 'fr',
  h: 'hi',
  i: 'it',
  j: 'ja',
  p: 'pt-BR',
  z: 'zh',
};

/** Language of a voice: "de", "en-US", … or "multi" when the name does not tell (multilingual or unknown). */
interface VoiceLanguage {
  code: string;
  region: string;
}

type Rule = (voice: string, model: Pick<SpeechModel, 'id'> | undefined) => string | undefined;

const RULES: Rule[] = [
  (v) => /^([a-z]{2}-[A-Z]{2})-/.exec(v)?.[1], // de-DE-KatjaNeural
  (v) => [/[-_]([a-z]{2})$/.exec(v)?.[1]].find((c) => c && CODES.has(c)), // Rachel_en
  (v, m) => (m?.id.startsWith('hexgrad/kokoro') ? KOKORO[/^([a-z])[fm]_/.exec(v)?.[1] ?? ''] : undefined),
  (v) => [/^([a-z]{2})_/.exec(v)?.[1]].find((c) => c && CODES.has(c)), // de_female
  (v) => WORDS[/^([A-Za-z]+)_/.exec(v)?.[1].toLowerCase() ?? ''], // German_Female
];

const ENGLISH_ONLY = /english[- ]only|english text-to-speech|natural, expressive english|produces english|an english/;

export function voiceLanguage(
  model: Pick<SpeechModel, 'id' | 'description'> | undefined,
  voice: string,
): VoiceLanguage {
  for (const rule of RULES) {
    const hit = rule(voice, model);
    if (hit) {
      const [code, region = ''] = hit.split('-');
      return { code, region };
    }
  }
  return { code: ENGLISH_ONLY.test((model?.description ?? '').toLowerCase()) ? 'en' : 'multi', region: '' };
}

/** English name of a language, e.g. "German (DE)"; "multilingual" for voices without a known language. */
export function languageName({ code, region }: VoiceLanguage): string {
  if (code === 'multi') return 'multilingual';
  let name = code;
  try {
    name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    // keep the code
  }
  return region ? `${name} (${region})` : name;
}

/** Group order: own voices, German, multilingual, English, then the other languages by name. */
const GROUP_ORDER = ['own', 'de', 'multi', 'en'];
const groupRank = (code: string) => (GROUP_ORDER.includes(code) ? GROUP_ORDER.indexOf(code) : GROUP_ORDER.length);

export interface VoiceGroup {
  /** "own", a language code or "multi". */
  code: string;
  label: string;
  voices: { value: string; label: string }[];
}

/**
 * Voices to choose from for a model, grouped by language: own voices (voice:<name>) first when the model can
 * clone, then the model's voices.
 */
export function voiceGroups(model: SpeechModel, ownVoices: Pick<VoiceInfo, 'name' | 'label'>[]): VoiceGroup[] {
  const groups = new Map<string, VoiceGroup>();
  if (model.cloning && ownVoices.length) {
    const voices = ownVoices.map((v) => ({ value: `voice:${v.name}`, label: v.label }));
    groups.set('own', { code: 'own', label: 'own voices', voices });
  }
  for (const voice of model.voices) {
    const lang = voiceLanguage(model, voice);
    const group = groups.get(lang.code) ?? {
      code: lang.code,
      label: languageName({ ...lang, region: '' }),
      voices: [],
    };
    groups.set(lang.code, group);
    const region = lang.region ? ` (${lang.region})` : '';
    group.voices.push({ value: voice, label: `${voice.replace(/:MAI-Voice.*$/, '')}${region}` });
  }
  return [...groups.values()].sort((a, b) => groupRank(a.code) - groupRank(b.code) || a.label.localeCompare(b.label));
}
