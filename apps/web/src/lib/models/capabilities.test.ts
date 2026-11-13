import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import type { ImageModel } from '../types';
import {
  chipState,
  fallbackOf,
  fallbackText,
  imageCapabilities,
  type ValueSupport,
  valueSupport,
} from './capabilities';

function imageModel(id: string, params: Record<string, string[]> = {}, maxRefs = 4): ImageModel {
  const enums = Object.fromEntries(Object.entries(params).map(([k, values]) => [k, { type: 'enum' as const, values }]));
  return {
    id,
    name: id,
    supported_parameters: { input_references: { type: 'range', min: 0, max: maxRefs }, ...enums },
    zdr: [],
    price: null,
    favorite: false,
    recommended: false,
  };
}

const flux = imageModel('bfl/flux', {
  aspect_ratio: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  resolution: ['1K', '2K'],
  output_format: ['png', 'jpeg'],
});
const mai = imageModel('ms/mai', { aspect_ratio: ['1:1', '21:9', '16:9'], quality: ['low', 'high'] });
const bare = imageModel('x/bare');
const name = (id: string) => ({ 'bfl/flux': 'FLUX.2 Pro', 'ms/mai': 'MAI-Image 2', 'x/bare': 'Bare' })[id] ?? id;

describe('fallbackOf', () => {
  it('takes supported and empty values as they are', () => {
    expect(fallbackOf(flux, 'aspect_ratio', '16:9')).toBeNull();
    expect(fallbackOf(flux, 'resolution', '')).toBeNull();
    expect(fallbackOf(bare, 'output_format', '')).toBeNull();
  });

  it('snaps aspect ratios and sizes to the nearest offered value', () => {
    expect(fallbackOf(flux, 'aspect_ratio', '21:9')).toEqual({ to: '16:9' });
    expect(fallbackOf(flux, 'aspect_ratio', '2:3')).toEqual({ to: '3:4' });
    expect(fallbackOf(flux, 'resolution', '4K')).toEqual({ to: '2K' });
    expect(fallbackOf(flux, 'resolution', '512')).toEqual({ to: '1K' });
  });

  it('falls back to the default for other values and missing parameters', () => {
    expect(fallbackOf(flux, 'output_format', 'webp')).toEqual({});
    expect(fallbackOf(mai, 'quality', 'medium')).toEqual({});
    expect(fallbackOf(bare, 'aspect_ratio', '1:1')).toEqual({});
    expect(fallbackOf(bare, 'resolution', '2K')).toEqual({});
    // An offered list without any usable value
    expect(fallbackOf(imageModel('x/odd', { resolution: ['huge'] }), 'resolution', '2K')).toEqual({});
  });
});

describe('valueSupport', () => {
  it('lists the models that cannot take a value, with what they do instead', () => {
    expect(valueSupport([flux, mai], 'aspect_ratio', '1:1', name)).toEqual({ state: 'all', fallbacks: [] });
    expect(valueSupport([flux, mai], 'aspect_ratio', '21:9', name)).toEqual({
      state: 'partial',
      fallbacks: [{ model: 'FLUX.2 Pro', to: '16:9' }],
    });
    expect(valueSupport([flux, mai, bare], 'resolution', '4K', name)).toEqual({
      state: 'none',
      fallbacks: [{ model: 'FLUX.2 Pro', to: '2K' }, { model: 'MAI-Image 2' }, { model: 'Bare' }],
    });
  });

  it('counts every value as supported without a selection', () => {
    expect(valueSupport([], 'output_format', 'webp', name)).toEqual({ state: 'all', fallbacks: [] });
  });
});

describe('chipState', () => {
  const sup = (state: ValueSupport['state']): ValueSupport => ({ state, fallbacks: [] });

  it('marks partly supported values and disables unsupported ones', () => {
    expect(chipState(sup('all'), false)).toEqual({ partial: false, disabled: false });
    expect(chipState(sup('partial'), false)).toEqual({ partial: true, disabled: false });
    expect(chipState(sup('none'), false)).toEqual({ partial: false, disabled: true });
  });

  it('keeps the current value and aspect ratios selectable, marked with ≈', () => {
    expect(chipState(sup('none'), true)).toEqual({ partial: true, disabled: false });
    expect(chipState(sup('none'), false, true)).toEqual({ partial: true, disabled: false });
  });
});

describe('fallbackText', () => {
  const t = ((key: string, p: Record<string, string>) =>
    key === 'params.uses' ? `${p.model} uses ${p.value}` : `${p.model} ${key}`) as unknown as TFunction;

  it('names each model and what it does', () => {
    const text = fallbackText(t, 'aspect_ratio', '21:9', [{ model: 'FLUX.2 Pro', to: '16:9' }, { model: 'Bare' }]);
    expect(text).toBe('21:9 — FLUX.2 Pro uses 16:9; Bare params.ignoresAspect');
    expect(fallbackText(t, 'resolution', '4K', [{ model: 'MAI' }])).toBe('4K — MAI params.ignoresSize');
    expect(fallbackText(t, 'quality', 'low', [{ model: 'A' }])).toBe('low — A params.ignoresQuality');
    expect(fallbackText(t, 'output_format', 'WEBP', [{ model: 'A' }])).toBe('WEBP — A params.ignoresFormat');
    expect(fallbackText(t, 'resolution', '1K', [])).toBe('');
  });
});

describe('imageCapabilities', () => {
  it('summarizes sizes, aspect ratios, references and formats', () => {
    const m = imageModel(
      'x/full',
      {
        resolution: ['4K', '1K', '2K', 'custom'],
        aspect_ratio: ['16:9', '1:1', '9:16', 'auto'],
        output_format: ['png', 'webp'],
      },
      8,
    );
    expect(imageCapabilities(m)).toEqual({
      sizes: '1K–4K',
      aspects: ['9:16', '1:1', '16:9'],
      refs: 8,
      formats: ['PNG', 'WEBP'],
    });
  });

  it('handles a single size and missing parameters', () => {
    expect(imageCapabilities(imageModel('x/one', { resolution: ['2K'] }))).toMatchObject({ sizes: '2K' });
    expect(imageCapabilities(bare)).toEqual({ sizes: null, aspects: [], refs: 4, formats: [] });
  });
});
