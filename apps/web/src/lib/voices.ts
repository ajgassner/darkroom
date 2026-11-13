import type { SpeechModel, VoiceInfo } from './types';

/** ISO 639-1 codes we can name; display names come from Intl.DisplayNames in the UI language. */
const KNOWN_CODES = new Set([
  'de',
  'en',
  'fr',
  'es',
  'it',
  'pt',
  'nl',
  'ja',
  'zh',
  'ko',
  'hi',
  'ar',
  'cs',
  'da',
  'fi',
  'pl',
  'ru',
  'sv',
  'tr',
  'nb',
  'no',
  'el',
  'hu',
  'ro',
  'uk',
  'id',
  'vi',
  'th',
  'he',
  'sk',
  'bg',
  'hr',
  'ca',
  'ms',
  'ta',
  'bn',
]);
const WORD_LANGS: Record<string, string> = {
  english: 'en',
  german: 'de',
  chinese: 'zh',
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
  cantonese: 'zh',
};
const KOKORO: Record<string, [string, string]> = {
  a: ['en', 'US'],
  b: ['en', 'GB'],
  e: ['es', ''],
  f: ['fr', ''],
  h: ['hi', ''],
  i: ['it', ''],
  j: ['ja', ''],
  p: ['pt', 'BR'],
  z: ['zh', ''],
};

export type VoiceLang = { code: string; region: string } | { code: 'multi' | 'own' };

/** Language of a voice, derived from provider naming conventions, otherwise from the model description. */
export function voiceLang(model: SpeechModel | undefined, voice: string): VoiceLang {
  let m: RegExpExecArray | null;
  if (voice.startsWith('voice:')) return { code: 'own' };
  m = /^([a-z]{2})-([A-Z]{2})-/.exec(voice);
  if (m) return { code: m[1], region: m[2] };
  m = /[-_]([a-z]{2})$/.exec(voice);
  if (m && KNOWN_CODES.has(m[1])) return { code: m[1], region: '' };
  m = /^([a-z])[fm]_/.exec(voice);
  if (model?.id.startsWith('hexgrad/kokoro') && m && KOKORO[m[1]])
    return { code: KOKORO[m[1]][0], region: KOKORO[m[1]][1] };
  m = /^([a-z]{2})_/.exec(voice);
  if (m && KNOWN_CODES.has(m[1])) return { code: m[1], region: '' };
  m = /^([A-Za-z]+)_/.exec(voice);
  if (m && WORD_LANGS[m[1].toLowerCase()]) return { code: WORD_LANGS[m[1].toLowerCase()], region: '' };
  const d = (model?.description ?? '').toLowerCase();
  if (/english[- ]only|english text-to-speech|natural, expressive english|produces english|an english/.test(d)) {
    return { code: 'en', region: '' };
  }
  return { code: 'multi' };
}

const LANG_ORDER = ['own', 'de', 'multi', 'en'];
export function langRank(code: string): number {
  const i = LANG_ORDER.indexOf(code);
  return i < 0 ? 10 : i;
}

/** Display name of a language in the UI language, e.g. "German (DE)". */
export function langName(l: VoiceLang, uiLang: string): string {
  if (l.code === 'multi' || l.code === 'own') return l.code;
  let name = l.code;
  try {
    name = new Intl.DisplayNames([uiLang], { type: 'language' }).of(l.code) ?? l.code;
  } catch {
    // keep the code
  }
  return 'region' in l && l.region ? `${name} (${l.region})` : name;
}

const DEMO_TEXTS: Record<string, string> = {
  de: 'Hallo! So klingt diese Stimme. Ich lese dir gerne deine Texte vor, klar, natürlich und mit Gefühl.',
  en: "Hi there! This is how this voice sounds. I'd be happy to read your texts aloud, clearly and naturally.",
  fr: 'Bonjour ! Voici comment sonne cette voix. Je lis volontiers vos textes à voix haute.',
  es: '¡Hola! Así suena esta voz. Con gusto leo tus textos en voz alta.',
  it: 'Ciao! Ecco come suona questa voce. Leggo volentieri i tuoi testi ad alta voce.',
  pt: 'Olá! É assim que esta voz soa. Leio com prazer os seus textos em voz alta.',
  nl: 'Hallo! Zo klinkt deze stem. Ik lees je teksten graag voor.',
};

/** Demo sentence in the voice's language; multilingual/own voices use the UI language. */
export function demoText(l: VoiceLang, uiLang: string): string {
  if (l.code === 'multi' || l.code === 'own') return DEMO_TEXTS[uiLang] ?? DEMO_TEXTS.en;
  return DEMO_TEXTS[l.code] ?? DEMO_TEXTS.en;
}

export const SPEEDS = [0.8, 0.9, 1, 1.1, 1.2];

/** Language codes of a model's voices (models without preset voices count as one voice). */
export function speechLangs(m: SpeechModel): Set<string> {
  return new Set((m.voices.length ? m.voices : ['']).map((v) => voiceLang(m, v).code));
}

/** Price per 1,000 characters from a per-character price, e.g. "$0.015". */
export function pricePerThousandChars(perChar: string | number): string {
  return `$${(Number(perChar) * 1000).toFixed(3)}`;
}

export type SpeechPrice = { per: 'chars' | 'unit'; value: string };

/** List price of a speech model: per 1,000 characters if known, otherwise per output unit (null if neither). */
export function speechPrice(m: SpeechModel): SpeechPrice | null {
  const perChar = Number(m.pricing?.prompt || 0);
  if (perChar) return { per: 'chars', value: pricePerThousandChars(perChar) };
  const perUnit = Number(m.pricing?.completion || 0);
  if (perUnit) return { per: 'unit', value: `$${perUnit}` };
  return null;
}

/**
 * Voice to switch to when the selected one is not available for the model, or null to keep it
 * (also when the fallback is the current voice, so callers that store the result do not loop).
 * Prefers the model's voices by language rank, then the first own voice (if the model can clone).
 */
export function fallbackVoice(model: SpeechModel, voice: string, ownVoices: VoiceInfo[]): string | null {
  const ownOk = voice.startsWith('voice:') && model.cloning && ownVoices.some((v) => `voice:${v.name}` === voice);
  if (ownOk || model.voices.includes(voice)) return null;
  const byLang = [...model.voices].sort(
    (a, b) => langRank(voiceLang(model, a).code) - langRank(voiceLang(model, b).code),
  );
  const next = byLang[0] ?? (model.cloning && ownVoices[0] ? `voice:${ownVoices[0].name}` : '');
  return next === voice ? null : next;
}

type TranscribeEngine = 'local' | 'api';

/** Engine and language for transcribing samples: the user's choice, else the server's default engine and auto-detect. */
export function transcribeOptions(
  choice: { transcribeEngine: '' | TranscribeEngine; transcribeLang: string },
  serverEngine: TranscribeEngine | undefined,
): { engine: TranscribeEngine; language: string } {
  return { engine: choice.transcribeEngine || serverEngine || 'local', language: choice.transcribeLang || 'auto' };
}

export interface VoiceGroup {
  label: string;
  options: { value: string; label: string; disabled?: boolean }[];
}

/** Group labels that come from the UI translation. */
export interface VoiceGroupLabels {
  own: string;
  ownNoClone: string;
  multi: string;
}

/** Voice options grouped by language for the select: own voices first, then by language rank and name. */
export function voiceGroups(
  model: SpeechModel | undefined,
  ownVoices: VoiceInfo[],
  uiLang: string,
  labels: VoiceGroupLabels,
): VoiceGroup[] {
  const groups = new Map<string, VoiceGroup & { rank: number }>();
  if (ownVoices.length) {
    groups.set('own', {
      rank: langRank('own'),
      label: model?.cloning ? labels.own : labels.ownNoClone,
      options: ownVoices.map((v) => ({ value: `voice:${v.name}`, label: v.label, disabled: !model?.cloning })),
    });
  }
  for (const v of model?.voices ?? []) {
    const l = voiceLang(model, v);
    const name = langName(l, uiLang);
    const group = groups.get(l.code) ?? {
      rank: langRank(l.code),
      label: l.code === 'multi' ? labels.multi : name.replace(/ \(.*\)$/, ''),
      options: [],
    };
    groups.set(l.code, group);
    group.options.push({
      value: v,
      label: `${v.replace(/:MAI-Voice.*$/, '')}${l.code === 'multi' ? '' : ` · ${name}`}`,
    });
  }
  return [...groups.values()]
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
    .map(({ label, options }) => ({ label, options }));
}
