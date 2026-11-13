import { describe, expect, it } from 'vitest';
import {
  byRecommendation,
  estimateImagePrice,
  estimateRunCost,
  estimateSpeechPrice,
  imagePriceLabel,
  privacyAllows,
  speechPriceLabel,
  zdrStatus,
} from './catalog.ts';
import type { ImageModel, ImagePrice, SpeechModel } from './contract.ts';

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

  it('sorts recommended models first, then by name', () => {
    const models = [
      { id: 'z', name: 'Alpha' },
      { id: 'r2', name: 'Zeta' },
      { id: 'y', name: 'Beta' },
      { id: 'r1', name: 'Omega' },
    ];
    expect(byRecommendation(models, ['r1', 'r2']).map((m) => m.id)).toEqual(['r1', 'r2', 'z', 'y']);
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
