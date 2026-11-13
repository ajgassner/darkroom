import { describe, expect, it } from 'vitest';
import {
  allowedByPrivacy,
  isNewModel,
  maxRefs,
  nearestAspect,
  nearestSize,
  preferredModel,
  releaseMonth,
  shortList,
  shortName,
  sortModels,
  toolModels,
  withFavorite,
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
      favorite: false,
      recommended: false,
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
    marks: Partial<ImageModel> = {},
  ): ImageModel => ({
    id,
    name,
    supported_parameters: params,
    zdr,
    price: null,
    favorite: false,
    recommended: false,
    ...marks,
  });
  const refs: ImageModel['supported_parameters'] = { input_references: { type: 'range', min: 0, max: 4 } };
  const hiRes: ImageModel['supported_parameters'] = { ...refs, resolution: { type: 'enum', values: ['1K', '4K'] } };

  it('sorts favorites (newest first), recommended in curated order, then newest first, undated last', () => {
    const list = [
      m('undated/b', 'B'),
      m('old', 'Old', {}, [], { created: 100 }),
      m('rec/2', 'Rec 2', {}, [], { recommended: true, rank: 1, created: 900 }),
      m('undated/a', 'A'),
      m('fav/old', 'Fav old', {}, [], { favorite: true, created: 10 }),
      m('new', 'New', {}, [], { created: 500 }),
      m('rec/1', 'Rec 1', {}, [], { recommended: true, rank: 0 }),
      m('fav/new', 'Fav new', {}, [], { favorite: true, recommended: true, rank: 3, created: 20 }),
    ];
    expect(sortModels(list).map((x) => x.id)).toEqual([
      'fav/new',
      'fav/old',
      'rec/1',
      'rec/2',
      'new',
      'old',
      'undated/a',
      'undated/b',
    ]);
    expect(list[0].id).toBe('undated/b'); // the input stays as it was
  });

  it('keeps favorites, recommended and selected models in the short list', () => {
    const list = [
      m('fav', 'F', {}, [], { favorite: true }),
      m('rec', 'R', {}, [], { recommended: true }),
      m('a', 'A'),
      m('b', 'B'),
    ];
    expect(shortList(list, ['b']).map((x) => x.id)).toEqual(['fav', 'rec', 'b']);
  });

  it('changes a favorite mark and re-sorts the list (optimistic update and its rollback)', () => {
    const list = [m('a', 'A', {}, [], { created: 2 }), m('b', 'B', {}, [], { created: 1 })];
    const marked = withFavorite(list, 'b', true);
    expect(marked.map((x) => [x.id, x.favorite])).toEqual([
      ['b', true],
      ['a', false],
    ]);
    expect(withFavorite(marked, 'b', false).map((x) => x.id)).toEqual(['a', 'b']);
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

describe('release dates', () => {
  const oct2026 = Date.UTC(2026, 9, 15) / 1000;

  it('shows the release month in the UI language', () => {
    expect(releaseMonth(oct2026, 'en')).toBe('Oct 2026');
    expect(releaseMonth(oct2026, 'de')).toBe('Okt. 2026');
    expect(releaseMonth(undefined, 'en')).toBeNull();
  });

  it('marks models released in the last 30 days as new', () => {
    const now = Date.UTC(2026, 10, 13);
    expect(isNewModel(now / 1000 - 29 * 86_400, now)).toBe(true);
    expect(isNewModel(now / 1000 - 31 * 86_400, now)).toBe(false);
    expect(isNewModel(undefined, now)).toBe(false);
  });
});
