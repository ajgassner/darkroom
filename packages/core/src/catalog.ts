// Choosing models in a client (CLI): recommended order, privacy filter, price labels and cost estimates.
// Pure functions on catalog data; the web UI has its own copy of these rules (it may only import core's types).
import type { CostSummary, ImageModel, ImagePrice, PrivacyMode, SpeechModel, ZdrEndpoint } from './contract.ts';
import { fitParams } from './params.ts';

/** Image models offered first, in this order. */
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

/** Speech models offered first, in this order. */
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

/** Whether a privacy mode lets a model run: "zdr" needs a ZDR endpoint, "zdr-strict" one without safety retention. */
export function privacyAllows(zdr: ZdrEndpoint[], mode: PrivacyMode): boolean {
  return mode === 'off' || zdr.some((e) => mode === 'zdr' || !e.safetyRetention);
}

/** Short ZDR status of a model: strict ZDR, ZDR only with safety retention, or none. */
export function zdrStatus(zdr: ZdrEndpoint[]): 'ZDR' | 'ZDR (safety retention)' | 'no ZDR' {
  if (zdr.some((e) => !e.safetyRetention)) return 'ZDR';
  return zdr.length ? 'ZDR (safety retention)' : 'no ZDR';
}

/** Recommended models first (in the given order), then the others by name. */
export function byRecommendation<T extends { id: string; name: string }>(models: T[], recommended: string[]): T[] {
  const rank = (id: string) => {
    const i = recommended.indexOf(id);
    return i === -1 ? recommended.length : i;
  };
  return models.toSorted((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
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
