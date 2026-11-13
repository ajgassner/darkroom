import { enumVals } from './models';
import type { CostSummary, ImageModel, ImagePrice } from './types';

const MP_BY_SIZE: Record<string, number> = { '512': 0.25, '768': 0.6, '1K': 1, '1.5K': 2.25, '2K': 4, '4K': 16 };
const GPT_TOKENS: Record<string, number> = { low: 272, medium: 1056, high: 4160, '': 1056 };

/** Size tier the model will actually render: the selected size if supported, else 2K (or its first size). */
function sizeTier(m: ImageModel, size: string): string {
  const res = enumVals(m, 'resolution');
  if (!res) return '1K';
  if (res.includes(size)) return size;
  if (!size) return '1K';
  return res.find((r) => r === '2K') ?? res[0];
}

/** Gemini: roughly 1100–1300 image tokens up to 2K, about 2000 at 4K (empirical, ±20 %). */
function geminiImageTokens(id: string, tier: string): number {
  if (tier === '4K') return 2000;
  if (tier === '512') return 750;
  return /pro/.test(id) ? 1120 : 1250;
}

function tokenPrice(id: string, costPerToken: number, tier: string, quality: string): number | null {
  if (id.startsWith('google/')) return costPerToken * geminiImageTokens(id, tier);
  if (id.startsWith('openai/')) return costPerToken * (GPT_TOKENS[quality] ?? 1056);
  return null;
}

/** Estimated price per image for the selected size/quality (null if not estimable). */
export function estimateImagePrice(m: ImageModel, size: string, quality: string): number | null {
  const p = m.price;
  if (!p) return null;
  const tier = sizeTier(m, size);
  switch (p.unit) {
    case 'image':
      return tier === '4K' && p.variants?.high_resolution ? p.variants.high_resolution : p.cost;
    case 'megapixel':
      return p.cost * (MP_BY_SIZE[tier] ?? 1);
    case 'token':
      return tokenPrice(m.id, p.cost, tier, quality);
    default:
      return null;
  }
}

/** Average real cost per image from the user's own manifest. */
export function historyAvg(costs: CostSummary | undefined, id: string): { avg: number; n: number } | null {
  const b = costs?.byModel?.[id];
  return b?.images && b.cost ? { avg: b.cost / b.images, n: b.images } : null;
}

/** Estimate for a whole run: own average (from 2 images on) or list-price estimate. */
export function estimateRun(
  models: ImageModel[],
  count: number,
  size: string,
  quality: string,
  costs: CostSummary | undefined,
): { total: number; unknown: boolean } {
  let total = 0;
  let unknown = false;
  for (const m of models) {
    const hist = historyAvg(costs, m.id);
    const per = hist && hist.n >= 2 ? hist.avg : estimateImagePrice(m, size, quality);
    if (per === null) unknown = true;
    else total += per * count;
  }
  return { total, unknown };
}

export type UnitPrice = { unit: 'image' | 'megapixel' | 'token' | 'other'; value: string };

export function unitPrice(p: ImagePrice | null): UnitPrice | null {
  if (!p) return null;
  if (p.unit === 'image') return { unit: 'image', value: `$${p.cost}` };
  if (p.unit === 'megapixel') return { unit: 'megapixel', value: `$${p.cost}` };
  if (p.unit === 'token') return { unit: 'token', value: `$${(p.cost * 1000).toFixed(3)}` };
  return { unit: 'other', value: `$${p.cost}/${p.unit}` };
}

export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'n/a';
  return `$${v.toFixed(v < 0.1 ? 4 : 3)}`;
}

export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}
