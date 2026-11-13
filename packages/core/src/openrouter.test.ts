import { describe, expect, it } from 'vitest';
import { fakeOpenRouter, json } from '../test/fake-openrouter.ts';
import { readDebug } from './debug.ts';
import { cheapestPrice, generateImages, imagePrices, listImageModels, zdrEndpoints } from './openrouter.ts';
import { allowedProviders } from './privacy.ts';

describe('allowedProviders', () => {
  const zdr = new Map([
    [
      'm',
      [
        { tag: 'strict', provider: 'A', safetyRetention: false },
        { tag: 'sr', provider: 'B', safetyRetention: true },
      ],
    ],
  ]);

  it('restricts per privacy mode', () => {
    expect(allowedProviders('m', 'off', zdr)).toBeNull();
    expect(allowedProviders('m', 'zdr', zdr)).toEqual(['strict', 'sr']);
    expect(allowedProviders('m', 'zdr-strict', zdr)).toEqual(['strict']);
    expect(allowedProviders('unknown', 'zdr', zdr)).toEqual([]);
  });
});

describe('catalog', () => {
  it('loads models and groups ZDR endpoints by model', async () => {
    fakeOpenRouter();
    expect((await listImageModels(true)).map((m) => m.id)).toContain('test/zdr');
    const zdr = await zdrEndpoints(true);
    expect(zdr.get('test/safety')).toEqual([{ tag: 'safety-provider', provider: 'SafeCo', safetyRetention: true }]);
    expect(zdr.has('test/open')).toBe(false);
  });
});

describe('generateImages', () => {
  const req = { model: 'test/zdr', prompt: 'a cat' };

  it('returns images, cost, generation id and a debug record', async () => {
    const api = fakeOpenRouter();
    const res = await generateImages(req);
    expect(res).toMatchObject({ cost: 0.04, generationId: 'gen-123', provider: 'ZdrCo' });
    expect(res.images).toHaveLength(1);
    expect(api.imageCalls()[0].body).toEqual(req);

    const debug = await readDebug(res.debugId as string);
    expect(debug).toMatchObject({ status: 200, method: 'POST', endpoint: expect.stringMatching(/\/images$/) });
  });

  it('turns upstream errors into an error with the upstream message', async () => {
    fakeOpenRouter({ images: () => json({ error: { message: 'Provider overloaded' } }, { status: 503 }) });
    await expect(generateImages(req)).rejects.toThrow('HTTP 503: Provider overloaded');
  });

  it('flags responses without image data', async () => {
    fakeOpenRouter({ images: () => json({ data: [{ url: 'x' }] }) });
    await expect(generateImages(req)).rejects.toMatchObject({ code: 'no_image_data' });
  });

  it('distinguishes network errors from aborts', async () => {
    fakeOpenRouter({
      images: () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(generateImages(req)).rejects.toMatchObject({ code: 'network_error' });

    const ac = new AbortController();
    fakeOpenRouter({
      images: () => {
        ac.abort();
        throw new DOMException('aborted', 'AbortError');
      },
    });
    await expect(generateImages(req, ac.signal)).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('prices', () => {
  it('picks the cheapest endpoint with its variants and input price', () => {
    expect(
      cheapestPrice([
        { pricing: [{ billable: 'output_image', unit: 'image', cost_usd: 0.05 }] },
        {
          pricing: [
            { billable: 'output_image', unit: 'image', cost_usd: 0.04 },
            { billable: 'output_image', unit: 'image', cost_usd: 0.08, variant: 'high_resolution' },
            { billable: 'input_image', unit: 'image', cost_usd: 0.001 },
          ],
        },
        { pricing: [{ billable: 'input_image', unit: 'image', cost_usd: 0 }] },
      ]),
    ).toEqual({
      cost: 0.04,
      unit: 'image',
      variants: { high_resolution: 0.08 },
      inputImage: { cost: 0.001, unit: 'image' },
    });
    expect(cheapestPrice([])).toBeNull();
  });

  it('loads prices per model and skips models without price', async () => {
    fakeOpenRouter();
    expect((await imagePrices(true)).size).toBe(0);
  });
});
