import { describe, expect, it } from 'vitest';
import {
  allowedByPrivacy,
  maxRefs,
  nearestAspect,
  nearestSize,
  preferredModel,
  shortName,
  sortByRecommendation,
  toolModels,
  zdrState,
} from './models';
import type { ImageModel, ZdrEndpoint } from './types';

const strict: ZdrEndpoint = { tag: 'a', provider: 'A', safetyRetention: false };
const safety: ZdrEndpoint = { tag: 'b', provider: 'B', safetyRetention: true };

describe('privacy', () => {
  it('classifies the ZDR state', () => {
    expect(zdrState([safety, strict])).toBe('strict');
    expect(zdrState([safety])).toBe('sr');
    expect(zdrState([])).toBe('none');
  });

  it.each([
    ['off', [], true],
    ['zdr', [], false],
    ['zdr', [safety], true],
    ['zdr-strict', [safety], false],
    ['zdr-strict', [safety, strict], true],
  ] as const)('%s with %j → %s', (mode, zdr, ok) => {
    expect(allowedByPrivacy([...zdr], mode)).toBe(ok);
  });
});

describe('parameter matching', () => {
  it('finds the nearest aspect ratio and size', () => {
    expect(nearestAspect(['1:1', '3:4', '16:9'], '4:5')).toBe('3:4');
    expect(nearestAspect(['1:1', '16:9'], '21:9')).toBe('16:9');
    expect(nearestSize(['1K', '2K'], '4K')).toBe('2K');
    expect(nearestSize(['1K', '2K'], '512')).toBe('1K');
    expect(nearestSize(['auto'], '1K')).toBeUndefined();
  });

  it('reads the reference limit and shortens names', () => {
    const m: ImageModel = {
      id: 'x',
      name: 'x',
      supported_parameters: { input_references: { type: 'range', min: 0, max: 14 } },
      zdr: [],
      price: null,
    };
    expect(maxRefs(m)).toBe(14);
    expect(maxRefs(undefined)).toBe(0);
    expect(shortName('Google: Nano Banana 2')).toBe('Nano Banana 2');
  });
});

describe('model lists', () => {
  const m = (
    id: string,
    name: string,
    params: ImageModel['supported_parameters'] = {},
    zdr: ZdrEndpoint[] = [strict],
  ): ImageModel => ({ id, name, supported_parameters: params, zdr, price: null });
  const refs: ImageModel['supported_parameters'] = { input_references: { type: 'range', min: 0, max: 4 } };
  const hiRes: ImageModel['supported_parameters'] = { ...refs, resolution: { type: 'enum', values: ['1K', '4K'] } };

  it('sorts recommended models first, then by name', () => {
    const list = [m('z/b', 'B'), m('x/rec2', 'Rec 2'), m('z/a', 'A'), m('x/rec1', 'Rec 1')];
    expect(sortByRecommendation(list, ['x/rec1', 'x/rec2']).map((x) => x.id)).toEqual([
      'x/rec1',
      'x/rec2',
      'z/a',
      'z/b',
    ]);
  });

  it('offers tools only models with references, allowed by privacy, and 2K/4K for upscaling', () => {
    const list = [m('a/refs', 'A', refs), m('b/hires', 'B', hiRes), m('c/none', 'C'), m('d/open', 'D', refs, [])];
    expect(toolModels(list, 'relight', 'zdr').map((x) => x.id)).toEqual(['a/refs', 'b/hires']);
    expect(toolModels(list, 'upscale', 'zdr').map((x) => x.id)).toEqual(['b/hires']);
    expect(toolModels(list, 'relight', 'off').map((x) => x.id)).toEqual(['a/refs', 'b/hires', 'd/open']);
  });

  it('picks the first preferred model that is available', () => {
    const list = [m('a', 'A'), m('b', 'B')];
    expect(preferredModel(list, [undefined, 'gone', 'b'])?.id).toBe('b');
    expect(preferredModel(list, [])?.id).toBe('a');
    expect(preferredModel([], ['a'])).toBeUndefined();
  });
});
