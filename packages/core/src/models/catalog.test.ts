import { describe, expect, it } from 'vitest';
import type { ImageModel, ImagePrice, SpeechModel } from '../contract.ts';
import {
  estimateImagePrice,
  estimateRunCost,
  estimateSpeechPrice,
  imagePriceLabel,
  isNewModel,
  privacyAllows,
  rankModels,
  releaseMonth,
  speechPriceLabel,
  zdrStatus,
} from './catalog.ts';

const strict = { tag: 'a', provider: 'A', safetyRetention: false };
const retention = { tag: 'b', provider: 'B', safetyRetention: true };

const model = (id: string, resolution?: string[]): ImageModel => ({
  id,
  name: id,
  supported_parameters: resolution ? { resolution: { type: 'enum', values: resolution } } : {},
});
const price = (cost: number, unit: string, variants: Record<string, number> = {}): ImagePrice => ({
  cost,
  unit,
  variants,
});
const speech = (pricing: Record<string, string>): SpeechModel => ({
  id: 's',
  name: 's',
  description: '',
  pricing,
  voices: [],
  cloning: false,
  multiRef: false,
  zdr: [],
});

describe('model catalog rules', () => {
  it('lets privacy modes allow models by their ZDR endpoints', () => {
    expect(privacyAllows([], 'off')).toBe(true);
    expect(privacyAllows([], 'zdr')).toBe(false);
    expect(privacyAllows([retention], 'zdr')).toBe(true);
    expect(privacyAllows([retention], 'zdr-strict')).toBe(false);
    expect(privacyAllows([retention, strict], 'zdr-strict')).toBe(true);
  });

  it('describes the ZDR status', () => {
    expect(zdrStatus([retention, strict])).toBe('ZDR');
    expect(zdrStatus([retention])).toBe('ZDR (safety retention)');
    expect(zdrStatus([])).toBe('no ZDR');
  });

  it('orders favorites (newest first), recommended in curated order, then newest first, undated last by name', () => {
    const models = [
      { id: 'undated/z', name: 'Zeta' },
      { id: 'old', name: 'Old', created: 100 },
      { id: 'google/gemini-3.1-flash-image', name: 'Flash', created: 900 },
      { id: 'undated/a', name: 'Alpha' },
      { id: 'fav/old', name: 'Fav old', created: 10 },
      { id: 'new', name: 'New', created: 500 },
      { id: 'google/gemini-3-pro-image', name: 'Pro' },
      { id: 'bytedance-seed/seedream-5-5', name: 'Seedream', created: 20 },
    ];
    const ranked = rankModels(models, 'image', ['fav/old', 'bytedance-seed/seedream-5-5', 'gone/model']);
    expect(ranked.map((m) => m.id)).toEqual([
      'bytedance-seed/seedream-5-5',
      'fav/old',
      'google/gemini-3-pro-image',
      'google/gemini-3.1-flash-image',
      'new',
      'old',
      'undated/a',
      'undated/z',
    ]);
    expect(ranked[0]).toMatchObject({ favorite: true, recommended: true, rank: 6 });
    expect(ranked[2]).toMatchObject({ favorite: false, recommended: true, rank: 0 });
    expect(ranked[4]).toEqual({ id: 'new', name: 'New', created: 500, favorite: false, recommended: false });
    // Music has no curated list: only favorites and release dates count
    expect(
      rankModels(models, 'music', [])
        .map((m) => m.id)
        .slice(0, 2),
    ).toEqual(['google/gemini-3.1-flash-image', 'new']);
  });

  it('formats the release month and marks models of the last 30 days as new', () => {
    const oct2026 = Date.UTC(2026, 9, 31, 23) / 1000;
    expect(releaseMonth(oct2026)).toBe('Oct 2026');
    expect(releaseMonth(undefined)).toBeNull();
    const now = Date.UTC(2026, 10, 13) / 1000;
    expect(isNewModel(now - 29 * 86_400, now)).toBe(true);
    expect(isNewModel(now - 31 * 86_400, now)).toBe(false);
    expect(isNewModel(undefined, now)).toBe(false);
  });

  it('labels list prices', () => {
    expect(imagePriceLabel(null)).toBeNull();
    expect(imagePriceLabel(price(0.04, 'image'))).toBe('$0.04/image');
    expect(imagePriceLabel(price(0.03, 'megapixel'))).toBe('$0.03/MP');
    expect(imagePriceLabel(price(0.00003, 'token'))).toBe('$0.030/1k tokens');
    expect(imagePriceLabel(price(1, 'second'))).toBe('$1/second');
    expect(speechPriceLabel(speech({ prompt: '0.000015' }))).toBe('$0.015/1k chars');
    expect(speechPriceLabel(speech({ completion: '0.02' }))).toBe('$0.02/unit');
    expect(speechPriceLabel(speech({}))).toBeNull();
  });
});

describe('price estimates', () => {
  it('estimates per image, per megapixel and per token at the size the model will render', () => {
    const flux = model('bfl/flux', ['1K', '2K', '4K']);
    expect(estimateImagePrice(flux, null)).toBeNull();
    expect(estimateImagePrice(flux, price(0.04, 'image'), '2K')).toBe(0.04);
    expect(estimateImagePrice(flux, price(0.04, 'image', { high_resolution: 0.12 }), '4K')).toBe(0.12);
    expect(estimateImagePrice(flux, price(0.03, 'megapixel'), '2K')).toBeCloseTo(0.12);
    // 4K is not offered by this model: snapped to 2K like the generation does
    expect(estimateImagePrice(model('x/y', ['1K', '2K']), price(0.03, 'megapixel'), '4K')).toBeCloseTo(0.12);
    expect(estimateImagePrice(flux, price(0.03, 'megapixel'))).toBeCloseTo(0.03);
    expect(estimateImagePrice(model('google/gemini-pro'), price(0.00003, 'token'))).toBeCloseTo(0.0336);
    expect(estimateImagePrice(model('google/gemini-flash', ['512', '4K']), price(0.00003, 'token'), '4K')).toBeCloseTo(
      0.06,
    );
    expect(estimateImagePrice(model('google/gemini-flash', ['512', '4K']), price(0.00003, 'token'), '512')).toBeCloseTo(
      0.0225,
    );
    expect(estimateImagePrice(model('openai/gpt-image'), price(0.00004, 'token'), '', 'high')).toBeCloseTo(0.1664);
    expect(estimateImagePrice(model('openai/gpt-image'), price(0.00004, 'token'))).toBeCloseTo(0.04224);
    expect(estimateImagePrice(model('other/x'), price(0.00004, 'token'))).toBeNull();
    expect(estimateImagePrice(model('other/x'), price(1, 'second'))).toBeNull();
  });

  it('estimates speech by characters', () => {
    expect(estimateSpeechPrice(speech({ prompt: '0.00001' }), 'Hello')).toBeCloseTo(0.00005);
    expect(estimateSpeechPrice(speech({}), 'Hello')).toBeNull();
  });

  it('prefers the own average cost from two results on', () => {
    const costs = {
      total: 1,
      images: 3,
      byModel: { a: { cost: 0.3, images: 2 }, b: { cost: 0.1, images: 1 } },
    };
    expect(
      estimateRunCost(
        [
          { model: 'a', count: 2, listPrice: 0.01 },
          { model: 'b', count: 1, listPrice: 0.02 },
        ],
        costs,
      ),
    ).toEqual({ total: 0.32, unknown: false });
    expect(estimateRunCost([{ model: 'c', count: 1, listPrice: null }], costs)).toEqual({ total: 0, unknown: true });
  });
});
