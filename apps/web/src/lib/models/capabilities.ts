// What the selected image models do with a parameter value (the ≈ chips and their hints), and the capability line of
// a model card. Same rules as the server (fitParams in core/src/image/params.ts) and the notes: an aspect ratio or size a
// model doesn't offer becomes its nearest one, other values (or a parameter it doesn't have) fall back to its default.
import type { TFunction } from 'i18next';
import type { ImageModel } from '../types';
import { enumVals, maxRefs, nearestAspect, nearestSize, RES_ORDER, ratio } from './models';

export type ParamKey = 'aspect_ratio' | 'resolution' | 'quality' | 'output_format';

/** What a model does instead of the wanted value: `to` = the nearest value it offers, no `to` = its default. */
export interface Fallback {
  to?: string;
}

/** null when the model takes the value as it is (or nothing is wanted), otherwise what it does instead. */
export function fallbackOf(m: ImageModel, key: ParamKey, value: string): Fallback | null {
  if (!value) return null;
  const supported = enumVals(m, key);
  if (supported?.includes(value)) return null;
  let to: string | undefined;
  if (supported && key === 'aspect_ratio') to = nearestAspect(supported, value);
  if (supported && key === 'resolution') to = nearestSize(supported, value);
  return to ? { to } : {};
}

export interface ModelFallback extends Fallback {
  model: string;
}

/** all: every selected model takes the value; partial: some don't; none: no selected model does. */
export interface ValueSupport {
  state: 'all' | 'partial' | 'none';
  fallbacks: ModelFallback[];
}

/** How the selected models handle a value, with each model that can't take it (by display name). */
export function valueSupport(
  selected: ImageModel[],
  key: ParamKey,
  value: string,
  modelName: (id: string) => string,
): ValueSupport {
  const fallbacks = selected.flatMap((m) => {
    const f = fallbackOf(m, key, value);
    return f ? [{ model: modelName(m.id), ...f }] : [];
  });
  if (!fallbacks.length) return { state: 'all', fallbacks };
  return { state: fallbacks.length === selected.length ? 'none' : 'partial', fallbacks };
}

export interface ChipState {
  /** Shows the ≈ marker: selectable, but not every selected model takes it as it is. */
  partial: boolean;
  disabled: boolean;
}

/**
 * A value no selected model offers is disabled (unless it is the current one). Aspect ratios are never disabled
 * (`alwaysSelectable`): every model uses its nearest one.
 */
export function chipState(support: ValueSupport, current: boolean, alwaysSelectable = false): ChipState {
  const disabled = support.state === 'none' && !current && !alwaysSelectable;
  return { partial: support.state !== 'all' && !disabled, disabled };
}

const IGNORES = {
  aspect_ratio: 'params.ignoresAspect',
  resolution: 'params.ignoresSize',
  quality: 'params.ignoresQuality',
  output_format: 'params.ignoresFormat',
} as const;

/** "21:9 — FLUX.2 Pro uses 16:9; MAI-Image 2 ignores the aspect ratio" (empty without fallbacks). */
export function fallbackText(t: TFunction, key: ParamKey, label: string, fallbacks: ModelFallback[]): string {
  if (!fallbacks.length) return '';
  const parts = fallbacks.map(({ model, to }) =>
    to ? t('params.uses', { model, value: to }) : t(IGNORES[key], { model }),
  );
  return `${label} — ${parts.join('; ')}`;
}

// ---------------------------------------------------------------- Model cards

export interface ImageCapabilities {
  /** Size range, e.g. "1K–4K" or "2K" (null: size not selectable). */
  sizes: string | null;
  /** Aspect ratios, from portrait to landscape. */
  aspects: string[];
  refs: number;
  /** Output formats, upper case. */
  formats: string[];
}

export function imageCapabilities(m: ImageModel): ImageCapabilities {
  const sizes = (enumVals(m, 'resolution') ?? [])
    .filter((v) => RES_ORDER.includes(v))
    .sort((a, b) => RES_ORDER.indexOf(a) - RES_ORDER.indexOf(b));
  const aspects = (enumVals(m, 'aspect_ratio') ?? [])
    .filter((v) => Number.isFinite(ratio(v)))
    .sort((a, b) => ratio(a) - ratio(b));
  return {
    sizes: sizes.length > 1 ? `${sizes[0]}–${sizes[sizes.length - 1]}` : (sizes[0] ?? null),
    aspects,
    refs: maxRefs(m),
    formats: (enumVals(m, 'output_format') ?? []).map((f) => f.toUpperCase()),
  };
}
