import type { ImageModel, ParamSpec, PrivacyMode, ZdrEndpoint } from './types';

export const RECOMMENDED_IMAGE = [
  'google/gemini-3.1-flash-image',
  'google/gemini-3-pro-image',
  'google/gemini-nano-banana-2.1',
  'openai/gpt-image-2',
  'black-forest-labs/flux.2-pro',
  'black-forest-labs/flux.2-max',
  'bytedance-seed/seedream-4.5',
  'bytedance-seed/seedream-5-0-pro',
];

export const RECOMMENDED_SPEECH = [
  'elevenlabs/eleven-v4',
  'elevenlabs/eleven-v4-turbo',
  'elevenlabs/eleven-multilingual-v2',
  'fish-audio/s2.1-pro',
  'fish-audio/drama-3',
  'microsoft/mai-voice-2.1',
  'google/gemini-3.8-flash-tts',
  'bytedance-seed/seed-audio-1-0',
];

export const ASPECTS = ['1:1', '4:5', '3:4', '2:3', '9:16', '5:4', '4:3', '3:2', '16:9', '21:9'];
export const SIZES = ['', '512', '1K', '2K', '4K'];
export const QUALITIES = ['', 'low', 'medium', 'high'];
export const FORMATS = ['', 'png', 'jpeg', 'webp'];
export const COUNTS = [1, 2, 3, 4, 6, 8];
const RES_ORDER = ['512', '768', '1K', '1.5K', '2K', '4K'];

export function enumVals(
  m: { supported_parameters?: Record<string, ParamSpec> } | undefined,
  key: string,
): string[] | null {
  const spec = m?.supported_parameters?.[key];
  return spec?.type === 'enum' ? spec.values : null;
}

export function maxRefs(m: ImageModel | undefined): number {
  const spec = m?.supported_parameters?.input_references;
  return spec?.type === 'range' ? spec.max : 0;
}

export function ratio(r: string): number {
  const [a, b] = r.split(':').map(Number);
  return a / b;
}

export function nearestAspect(values: string[], want: string): string | undefined {
  return values
    .filter((v) => !Number.isNaN(ratio(v)))
    .sort((a, b) => Math.abs(Math.log(ratio(a) / ratio(want))) - Math.abs(Math.log(ratio(b) / ratio(want))))[0];
}

export function nearestSize(values: string[], want: string): string | undefined {
  const w = RES_ORDER.indexOf(want);
  return values
    .filter((v) => RES_ORDER.includes(v))
    .sort((a, b) => Math.abs(RES_ORDER.indexOf(a) - w) - Math.abs(RES_ORDER.indexOf(b) - w))[0];
}

export type ZdrState = 'strict' | 'sr' | 'none';

/** ZDR state of a model: strict ZDR, ZDR with safety retention, or none. */
export function zdrState(zdr: ZdrEndpoint[]): ZdrState {
  if (zdr.some((e) => !e.safetyRetention)) return 'strict';
  return zdr.length ? 'sr' : 'none';
}

export function allowedByPrivacy(zdr: ZdrEndpoint[], mode: PrivacyMode): boolean {
  if (mode === 'off') return true;
  return mode === 'zdr' ? zdr.length > 0 : zdr.some((e) => !e.safetyRetention);
}

/** Drop the "Provider: " prefix of OpenRouter model names. */
export function shortName(name: string): string {
  return name.replace(/^[^:]+:\s*/, '');
}

/** Position in a list of recommended model IDs (not recommended: Infinity). */
function recommendedRank(recommended: string[], id: string): number {
  const i = recommended.indexOf(id);
  return i < 0 ? Number.POSITIVE_INFINITY : i;
}

/** Sort models: recommended ones first in their order, then the rest by name. */
export function sortByRecommendation<T extends { id: string; name: string }>(models: T[], recommended: string[]): T[] {
  return [...models].sort(
    (a, b) => recommendedRank(recommended, a.id) - recommendedRank(recommended, b.id) || a.name.localeCompare(b.name),
  );
}

/** Image models a tool can run on: reference support, allowed by privacy; upscaling needs 2K or 4K. */
export function toolModels(models: ImageModel[], toolId: string, privacy: PrivacyMode): ImageModel[] {
  const usable = models.filter(
    (m) =>
      maxRefs(m) > 0 &&
      allowedByPrivacy(m.zdr, privacy) &&
      (toolId !== 'upscale' || Boolean(enumVals(m, 'resolution')?.some((r) => r === '2K' || r === '4K'))),
  );
  return sortByRecommendation(usable, RECOMMENDED_IMAGE);
}

/** The first of the preferred model IDs that is in the list, otherwise the first model. */
export function preferredModel<T extends { id: string }>(
  models: T[],
  preferred: (string | undefined)[],
): T | undefined {
  for (const id of preferred) {
    const hit = id && models.find((m) => m.id === id);
    if (hit) return hit;
  }
  return models[0];
}
