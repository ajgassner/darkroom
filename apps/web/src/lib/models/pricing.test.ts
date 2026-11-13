import { describe, expect, it } from 'vitest';
import type { CostSummary, ImageModel, ImagePrice } from '../types';
import { estimateImagePrice, estimateRun, priceExtras, unitPrice } from './pricing';

function model(id: string, price: ImagePrice | null, resolutions?: string[]): ImageModel {
  return {
    id,
    name: id,
    supported_parameters: resolutions ? { resolution: { type: 'enum', values: resolutions } } : {},
    zdr: [],
    price,
    favorite: false,
    recommended: false,
  };
}

describe('estimateImagePrice', () => {
  it('per image, with a 4K surcharge', () => {
    const m = model('x/flat', { cost: 0.04, unit: 'image', variants: { high_resolution: 0.08 } }, ['1K', '2K', '4K']);
    expect(estimateImagePrice(m, '2K', '')).toBe(0.04);
    expect(estimateImagePrice(m, '4K', '')).toBe(0.08);
  });

  it('per megapixel, by size tier', () => {
    const m = model('x/mp', { cost: 0.01, unit: 'megapixel', variants: {} }, ['1K', '2K']);
    expect(estimateImagePrice(m, '2K', '')).toBeCloseTo(0.04);
    // unsupported tier falls back to 2K
    expect(estimateImagePrice(m, '4K', '')).toBeCloseTo(0.04);
    // "auto" size and models without size choice count as 1K
    expect(estimateImagePrice(m, '', '')).toBeCloseTo(0.01);
    expect(estimateImagePrice(model('x/mp', m.price), '4K', '')).toBeCloseTo(0.01);
    // without 2K the model's first size is used
    expect(estimateImagePrice(model('x/mp', m.price, ['512', '1K']), '4K', '')).toBeCloseTo(0.0025);
  });

  it('unknown price units are not estimable', () => {
    expect(estimateImagePrice(model('x/sec', { cost: 0.1, unit: 'second', variants: {} }), '1K', '')).toBeNull();
  });

  it('per token for Gemini and GPT Image, unknown otherwise', () => {
    const tok = { cost: 0.00003, unit: 'token', variants: {} };
    expect(estimateImagePrice(model('google/gemini-3-pro-image', tok), '1K', '')).toBeCloseTo(0.0336);
    expect(estimateImagePrice(model('google/gemini-flash-image', tok), '1K', '')).toBeCloseTo(0.0375);
    expect(estimateImagePrice(model('google/gemini-3-pro-image', tok, ['1K', '4K']), '4K', '')).toBeCloseTo(0.06);
    expect(estimateImagePrice(model('google/gemini-3-pro-image', tok, ['512', '1K']), '512', '')).toBeCloseTo(0.0225);
    expect(estimateImagePrice(model('openai/gpt-image-2.5-sunburst', tok), '1K', 'high')).toBeCloseTo(0.1248);
    expect(estimateImagePrice(model('other/x', tok), '1K', '')).toBeNull();
    expect(estimateImagePrice(model('x/none', null), '1K', '')).toBeNull();
  });
});

describe('estimateRun', () => {
  const flat = model('x/flat', { cost: 0.04, unit: 'image', variants: {} });
  const unknown = model('x/none', null);

  it('prefers the own average from two results on', () => {
    const costs: CostSummary = { total: 0.3, images: 3, byModel: { 'x/flat': { cost: 0.3, images: 3 } } };
    expect(estimateRun([flat], 2, '1K', '', costs)).toEqual({ total: expect.closeTo(0.2), unknown: false });
    expect(estimateRun([flat, unknown], 1, '1K', '', undefined)).toEqual({ total: 0.04, unknown: true });
  });
});

describe('unitPrice', () => {
  it('formats list prices per unit', () => {
    expect(unitPrice({ cost: 0.00003, unit: 'token', variants: {} })).toEqual({ unit: 'token', value: '$30.00' });
    expect(unitPrice({ cost: 0.04, unit: 'image', variants: {} })).toEqual({ unit: 'image', value: '$0.04' });
    expect(unitPrice({ cost: 0.0125, unit: 'megapixel', variants: {} })).toEqual({
      unit: 'megapixel',
      value: '$0.0125',
    });
    expect(unitPrice({ cost: 0.5, unit: 'second', variants: {} })).toEqual({ unit: 'other', value: '$0.50/second' });
    expect(unitPrice(null)).toBeNull();
  });
});

describe('priceExtras', () => {
  it('lists surcharge variants and the input image price as list prices', () => {
    expect(
      priceExtras({
        cost: 0.02,
        unit: 'image',
        variants: { high_resolution: 0.035 },
        inputImage: { cost: 0.008, unit: 'image' },
      }),
    ).toEqual([
      { label: 'high resolution', value: '$0.035' },
      { label: 'input image', value: '$0.008/image' },
    ]);
    expect(priceExtras(null)).toEqual([]);
  });
});
