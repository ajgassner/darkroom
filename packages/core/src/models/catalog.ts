// Choosing models: recommendations, favorites and the list order (server and CLI), privacy filter, release dates,
// price labels and cost estimates. Pure functions on catalog data; the web UI has its own copy of the display rules
// (it may only import core's types) and gets the marks for the order from the server.
import type {
  CostSummary,
  ImageModel,
  ImagePrice,
  ModelKind,
  ModelMarks,
  PrivacyMode,
  SpeechModel,
  ZdrEndpoint,
} from '../contract.ts';
import { fitParams } from '../image/params.ts';

// Curated recommendations, offered first in this order (after the user's favorites). Criteria: strong in current
// blind-vote rankings (LMArena, Artificial Analysis), recent, ZDR where possible. Reviewed 2026-11-13.

/** Image models offered first, in this order. */
const RECOMMENDED_IMAGE = [
  'google/gemini-3-pro-image', // Nano Banana Pro
  'openai/gpt-image-2.5-sunburst', // Arena #1 text-to-image and edit; no ZDR on OpenRouter (usable with privacy off)
  'google/gemini-nano-banana-2.1',
  'google/gemini-3.1-flash-image',
  'microsoft/mai-image-2.6', // strict ZDR (no resolution parameter)
  'bytedance-seed/seedream-5-0-pro',
  'bytedance-seed/seedream-5-5',
];

/** Speech models offered first, in this order (same criteria as the image models). */
const RECOMMENDED_SPEECH = [
  'elevenlabs/eleven-v4',
  'elevenlabs/eleven-v4-turbo',
  'google/gemini-3.8-flash-tts',
  'speechify/simba-3.5',
  'microsoft/mai-voice-2.1',
  'fish-audio/s2.1-pro',
  'fish-audio/drama-3',
  'bytedance-seed/seed-audio-1-0',
];

/** Whether a privacy mode lets a model run: "zdr" needs a ZDR endpoint, "zdr-strict" one without safety retention. */
export function privacyAllows(zdr: ZdrEndpoint[], mode: PrivacyMode): boolean {
  return mode === 'off' || zdr.some((e) => mode === 'zdr' || !e.safetyRetention);
}

/** Short ZDR status of a model: strict ZDR, ZDR only with safety retention, or none. */
export function zdrStatus(zdr: ZdrEndpoint[]): 'ZDR' | 'ZDR (safety retention)' | 'no ZDR' {
  if (zdr.some((e) => !e.safetyRetention)) return 'ZDR';
  return zdr.length ? 'ZDR (safety retention)' : 'no ZDR';
}

const RECOMMENDED: Record<ModelKind, string[]> = { image: RECOMMENDED_IMAGE, speech: RECOMMENDED_SPEECH, music: [] };

type Ranked = { name: string; created?: number } & ModelMarks;

/** 0 = favorite, 1 = recommended, 2 = the rest. */
const group = (m: Ranked) => (m.favorite ? 0 : m.recommended ? 1 : 2);

/** Newest first; models without a release date after those with one, alphabetical among themselves. */
function byRelease(a: Ranked, b: Ranked): number {
  if (a.created !== undefined && b.created !== undefined && a.created !== b.created) return b.created - a.created;
  if ((a.created === undefined) !== (b.created === undefined)) return a.created === undefined ? 1 : -1;
  return a.name.localeCompare(b.name);
}

function compareModels(a: Ranked, b: Ranked): number {
  const g = group(a) - group(b);
  if (g) return g;
  if (group(a) === 1) return (a.rank ?? 0) - (b.rank ?? 0);
  return byRelease(a, b);
}

/**
 * Mark favorites and recommended models and put them in list order: favorites first (newest first), then the
 * recommended ones in their curated order, then all others newest first, models without a date last by name.
 */
export function rankModels<T extends { id: string; name: string; created?: number }>(
  models: T[],
  kind: ModelKind,
  favorites: readonly string[],
): (T & ModelMarks)[] {
  const recommended = RECOMMENDED[kind];
  return models
    .map((m) => {
      const rank = recommended.indexOf(m.id);
      return { ...m, favorite: favorites.includes(m.id), recommended: rank >= 0, ...(rank >= 0 ? { rank } : {}) };
    })
    .sort(compareModels);
}

const DAY = 86_400;

/** Whether a model came out within the last 30 days (`created` and `now` in Unix seconds). */
export function isNewModel(created: number | undefined, now = Date.now() / 1000): boolean {
  return created !== undefined && now - created < 30 * DAY;
}

const MONTH = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Release month, e.g. "Oct 2026" (null without a date). */
export function releaseMonth(created: number | undefined): string | null {
  return created === undefined ? null : MONTH.format(created * 1000);
}

/** List price of an image model, e.g. "$0.04/image", "$0.03/MP", "$0.030/1k tokens". */
export function imagePriceLabel(price: ImagePrice | null): string | null {
  if (!price) return null;
  if (price.unit === 'image') return `$${price.cost}/image`;
  if (price.unit === 'megapixel') return `$${price.cost}/MP`;
  if (price.unit === 'token') return `$${(price.cost * 1000).toFixed(3)}/1k tokens`;
  return `$${price.cost}/${price.unit}`;
}

const MEGAPIXELS: Record<string, number> = { '512': 0.25, '768': 0.6, '1K': 1, '1.5K': 2.25, '2K': 4, '4K': 16 };
/** Output tokens per image of GPT Image models by quality (medium when not set). */
const GPT_IMAGE_TOKENS: Record<string, number> = { low: 272, medium: 1056, high: 4160 };

/** Gemini bills roughly 1100–1300 tokens per image up to 2K and about 2000 at 4K (empirical, ±20 %). */
function geminiTokens(id: string, tier: string): number {
  if (tier === '4K') return 2000;
  if (tier === '512') return 750;
  return id.includes('pro') ? 1120 : 1250;
}

/**
 * Estimated price of one image at the requested size and quality (null when it cannot be estimated).
 * The size is snapped to what the model supports with the same rule the generation uses.
 */
export function estimateImagePrice(
  model: ImageModel,
  price: ImagePrice | null,
  size = '',
  quality = '',
): number | null {
  if (!price) return null;
  const tier = (size && fitParams(model, { resolution: size }).params.resolution) || '1K';
  if (price.unit === 'image') return tier === '4K' ? (price.variants.high_resolution ?? price.cost) : price.cost;
  if (price.unit === 'megapixel') return price.cost * (MEGAPIXELS[tier] ?? 1);
  if (price.unit !== 'token') return null;
  if (model.id.startsWith('google/')) return price.cost * geminiTokens(model.id, tier);
  if (model.id.startsWith('openai/')) return price.cost * (GPT_IMAGE_TOKENS[quality] ?? GPT_IMAGE_TOKENS.medium);
  return null;
}

/** List price of a speech model: per 1,000 characters when known, otherwise per output unit. */
export function speechPriceLabel(model: SpeechModel): string | null {
  const perChar = Number(model.pricing.prompt || 0);
  if (perChar) return `$${(perChar * 1000).toFixed(3)}/1k chars`;
  const perUnit = Number(model.pricing.completion || 0);
  return perUnit ? `$${perUnit}/unit` : null;
}

/** Estimated price of speaking `text` (null without a per-character price). */
export function estimateSpeechPrice(model: SpeechModel, text: string): number | null {
  const perChar = Number(model.pricing.prompt || 0);
  return perChar ? perChar * text.length : null;
}

/** One model of a run: how many results it makes and the list price of one (null if unknown). */
export interface EstimateItem {
  model: string;
  count: number;
  listPrice: number | null;
}

/**
 * Estimated cost of a run: per model the user's own average cost (from 2 results on, it includes surcharges
 * the list price misses), otherwise the list price. `unknown` is set when a model has neither.
 */
export function estimateRunCost(items: EstimateItem[], costs: CostSummary): { total: number; unknown: boolean } {
  let total = 0;
  let unknown = false;
  for (const item of items) {
    const own = costs.byModel[item.model];
    const per = own && own.images >= 2 && own.cost ? own.cost / own.images : item.listPrice;
    if (per === null) unknown = true;
    else total += per * item.count;
  }
  return { total, unknown };
}
