import type { ImageModel, ModelMarks, ParamSpec, PrivacyMode, ZdrEndpoint } from './types';

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

type Sortable = { name: string; created?: number } & ModelMarks;

/** Sort group: favorites, then recommended models, then the rest. */
function tier(m: Sortable): number {
  if (m.favorite) return 0;
  return m.recommended ? 1 : 2;
}

/** Newer release first; models without a date after the dated ones, alphabetical among themselves. */
function newestFirst(a: Sortable, b: Sortable): number {
  const da = a.created ?? Number.NEGATIVE_INFINITY;
  const db = b.created ?? Number.NEGATIVE_INFINITY;
  return da === db ? a.name.localeCompare(b.name) : db - da;
}

/**
 * List order from the server's marks: favorites (newest first), recommended models in their curated order (`rank`),
 * then the others newest first, models without a release date last.
 */
export function sortModels<T extends Sortable>(models: T[]): T[] {
  return [...models].sort((a, b) => {
    const byTier = tier(a) - tier(b);
    if (byTier) return byTier;
    return tier(a) === 1 ? (a.rank ?? 0) - (b.rank ?? 0) : newestFirst(a, b);
  });
}

/** The short model list (without "show all"): favorites, recommended models and the ones in use. */
export function shortList<T extends { id: string } & ModelMarks>(models: T[], inUse: string[]): T[] {
  return models.filter((m) => m.favorite || m.recommended || inUse.includes(m.id));
}

/** The list with one model's favorite mark changed (for the optimistic update), in list order again. */
export function withFavorite<T extends { id: string } & Sortable>(models: T[], id: string, favorite: boolean): T[] {
  return sortModels(models.map((m) => (m.id === id ? { ...m, favorite } : m)));
}

/** Whether a model came out within the last 30 days (`now` in milliseconds). */
export function isNewModel(created: number | undefined, now = Date.now()): boolean {
  return created !== undefined && now - created * 1000 < 30 * 86_400_000;
}

/** Release month in the UI language, e.g. "Okt. 2026" / "Oct 2026" (null without a date). */
export function releaseMonth(created: number | undefined, lang: string): string | null {
  if (created === undefined) return null;
  return new Intl.DateTimeFormat(lang, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(created * 1000);
}

/** Image models a tool can run on: reference support, allowed by privacy; upscaling needs 2K or 4K. */
export function toolModels(models: ImageModel[], toolId: string, privacy: PrivacyMode): ImageModel[] {
  const usable = models.filter(
    (m) =>
      maxRefs(m) > 0 &&
      allowedByPrivacy(m.zdr, privacy) &&
      (toolId !== 'upscale' || Boolean(enumVals(m, 'resolution')?.some((r) => r === '2K' || r === '4K'))),
  );
  return sortModels(usable);
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
