// What the interactive mode offers: choices for privacy, models, sizes and voices, their defaults and the summary.
// Pure functions on catalog data, so the prompts in flow.ts stay thin.
import {
  imagePriceLabel,
  isNewModel,
  privacyAllows,
  releaseMonth,
  speechPriceLabel,
  zdrStatus,
} from '@darkroom/core/catalog';
import type { PrivacyMode } from '@darkroom/core/config';
import type {
  ImageModel,
  ImagePrice,
  ModelMarks,
  MusicModelInfo,
  SpeechModel,
  SpeechModelInfo,
  VoiceInfo,
  ZdrEndpoint,
} from '@darkroom/core/contract';
import { fitParams, maxRefs } from '@darkroom/core/params';
import { voiceGroups } from '@darkroom/core/voice-lang';
import type { ImageRun, MusicRun, SpeechRun } from './command-line.ts';

export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
}

/** Image model with marks, ZDR endpoints and list price (as the web UI gets it from /api/models). */
export interface CatalogImageModel extends ImageModel, ModelMarks {
  zdr: ZdrEndpoint[];
  price: ImagePrice | null;
}

/** The three modes, each explained in its label (a select shows hints only on the focused entry). */
export const PRIVACY_CHOICES: Choice<PrivacyMode>[] = [
  { value: 'zdr', label: 'zdr         only providers with Zero Data Retention (recommended)' },
  { value: 'zdr-strict', label: 'zdr-strict  ZDR, and no provider that keeps data for safety checks' },
  { value: 'off', label: 'off         any provider; prompts and images may be retained' },
];

export const FAVORITE_MARK = '♥';
export const RECOMMENDED_MARK = '★';

const details = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(' · ');

/** Marks and release of a model for a hint: "♥ favorite · recommended · Oct 2026 · new". */
function release(m: { created?: number } & ModelMarks): string {
  return details(
    m.favorite && `${FAVORITE_MARK} favorite`,
    m.recommended && 'recommended',
    releaseMonth(m.created),
    isNewModel(m.created) && 'new',
  );
}

/** The models allowed in the privacy mode as choices, in list order (favorites first). */
function modelChoices<M extends { id: string; zdr: ZdrEndpoint[] }>(
  models: M[],
  privacy: PrivacyMode,
  hint: (m: M) => string,
): Choice<string>[] {
  return models.filter((m) => privacyAllows(m.zdr, privacy)).map((m) => ({ value: m.id, label: m.id, hint: hint(m) }));
}

/** Image models that take references and are allowed in the privacy mode. */
export function imageModelChoices(models: CatalogImageModel[], privacy: PrivacyMode): Choice<string>[] {
  return modelChoices(
    models.filter((m) => (maxRefs(m) ?? 0) > 0),
    privacy,
    (m) => details(release(m), imagePriceLabel(m.price), zdrStatus(m.zdr)),
  );
}

const ASPECT_ORDER = ['1:1', '4:5', '3:4', '2:3', '9:16', '5:4', '4:3', '3:2', '16:9', '21:9'];
const SIZE_ORDER = ['512', '768', '1K', '1.5K', '2K', '4K'];

type FitKey = { param: 'aspect_ratio'; want: 'aspectRatio' } | { param: 'resolution'; want: 'resolution' };

/**
 * Values of an enum parameter that at least one of the models supports, plus "model default". The hint names
 * the models that use another value, snapped with the same rule as the generation (or ignore it).
 */
function paramChoices(models: ImageModel[], key: FitKey, order: string[]): Choice<string>[] {
  const values = new Set<string>();
  for (const m of models) {
    const spec = m.supported_parameters?.[key.param];
    if (spec?.type === 'enum') for (const v of spec.values) values.add(v);
  }
  if (!values.size) return [];
  const rank = (v: string) => (order.includes(v) ? order.indexOf(v) : order.length);
  const sorted = [...values].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return [
    { value: '', label: 'model default' },
    ...sorted.map((value) => {
      const others = models.flatMap((m) => {
        const got = fitParams(m, { [key.want]: value }).params[key.param];
        return got === value ? [] : [`${m.id}: ${got ?? 'ignored'}`];
      });
      return { value, label: value, ...(others.length ? { hint: others.join(', ') } : {}) };
    }),
  ];
}

export function aspectChoices(models: ImageModel[]): Choice<string>[] {
  return paramChoices(models, { param: 'aspect_ratio', want: 'aspectRatio' }, ASPECT_ORDER);
}

export function sizeChoices(models: ImageModel[]): Choice<string>[] {
  return paramChoices(models, { param: 'resolution', want: 'resolution' }, SIZE_ORDER);
}

export const COUNT_CHOICES: Choice<number>[] = [1, 2, 3, 4, 6, 8, 10].map((n) => ({
  value: n,
  label: String(n),
}));

/** Speech models allowed in the privacy mode, in list order; the hint tells release, price and voice cloning. */
export function speechModelChoices(models: SpeechModelInfo[], privacy: PrivacyMode): Choice<string>[] {
  return modelChoices(models, privacy, (m) =>
    details(
      release(m),
      speechPriceLabel(m),
      zdrStatus(m.zdr),
      m.cloning && 'clones voices',
      m.voices.length > 0 && `${m.voices.length} voice${m.voices.length === 1 ? '' : 's'}`,
    ),
  );
}

/** Voices of a model grouped by language (own voices first if it can clone); "model default" without presets. */
export function voiceChoices(model: SpeechModel, ownVoices: VoiceInfo[]): Choice<string>[] {
  const voices = voiceGroups(model, ownVoices).flatMap((g) =>
    g.voices.map((v) => ({ value: v.value, label: v.label, hint: g.label })),
  );
  return model.voices.length ? voices : [{ value: '', label: 'model default' }, ...voices];
}

export function musicModelChoices(models: MusicModelInfo[], privacy: PrivacyMode): Choice<string>[] {
  return modelChoices(models, privacy, (m) => details(m.name, release(m), zdrStatus(m.zdr)));
}

/** Providers whose speech models follow free-text delivery instructions. */
export function takesInstructions(model: string): boolean {
  return /^(google|fish-audio|openai)\//.test(model);
}

export const SPEED_CHOICES: Choice<number>[] = [0.8, 0.9, 1, 1.1, 1.2].map((v) => ({
  value: v,
  label: `${v}×`,
  ...(v === 1 ? { hint: 'normal' } : {}),
}));

/** The first preferred value that is a choice, otherwise the first choice. */
export function initialValue<T>(choices: Choice<T>[], ...preferred: (T | null | undefined)[]): T | undefined {
  const values = choices.map((c) => c.value);
  return preferred.find((v): v is T => v !== undefined && v !== null && values.includes(v)) ?? values[0];
}

/** The preferred values that are choices, otherwise the first choice. */
export function initialValues(choices: Choice<string>[], preferred: string[] | undefined): string[] {
  const values = choices.map((c) => c.value);
  const kept = (preferred ?? []).filter((v) => values.includes(v));
  return kept.length ? kept : values.slice(0, 1);
}

export function usd(v: number | null | undefined): string {
  return v === null || v === undefined ? 'n/a' : `$${v.toFixed(4)}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Estimated cost as text: "≈ $0.0800", with a note when some models have no known price. */
export function estimateText(e: { total: number; unknown: boolean }): string {
  if (e.unknown) return e.total ? `≈ ${usd(e.total)} + models without a known price` : 'unknown';
  return `≈ ${usd(e.total)}`;
}

type Line = [string, string | number | null | undefined];

function lines(rows: Line[]): string[] {
  return rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k.padEnd(13)}${v}`);
}

export function imageSummary(r: ImageRun, estimate: string): string[] {
  return lines([
    ['Models', r.models.join(', ')],
    ['Images', `${r.count} per model, ${r.count * r.models.length} in total`],
    ['Privacy', r.privacy],
    ['Element', r.element && `@${r.element}`],
    ['Aspect ratio', r.aspect],
    ['Size', r.size],
    ['Prompt', r.prompt],
    ['Cost', estimate],
  ]);
}

export function speechSummary(r: SpeechRun, estimate: string): string[] {
  return lines([
    ['Model', r.model],
    ['Voice', r.voice || 'model default'],
    ['Privacy', r.privacy],
    ['Instructions', r.instructions],
    ['Speed', r.speed !== undefined && r.speed !== 1 ? `${r.speed}×` : undefined],
    ['Text', r.text],
    ['Cost', estimate],
  ]);
}

export function musicSummary(r: MusicRun, estimate: string): string[] {
  return lines([
    ['Model', r.model],
    ['Privacy', r.privacy],
    ['Prompt', r.prompt],
    ['Cost', estimate],
  ]);
}
