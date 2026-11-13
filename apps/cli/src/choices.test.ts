import { rankModels } from '@darkroom/core/catalog';
import type { ImageModel, SpeechModelInfo } from '@darkroom/core/contract';
import { describe, expect, it } from 'vitest';
import {
  aspectChoices,
  type CatalogImageModel,
  estimateText,
  imageModelChoices,
  imageSummary,
  initialValue,
  initialValues,
  musicModelChoices,
  musicSummary,
  plural,
  sizeChoices,
  speechModelChoices,
  speechSummary,
  takesInstructions,
  usd,
  voiceChoices,
} from './choices.ts';

const zdr = [{ tag: 'p', provider: 'P', safetyRetention: false }];
const withRetention = [{ tag: 'p', provider: 'P', safetyRetention: true }];

const image = (id: string, extra: Partial<CatalogImageModel> = {}): CatalogImageModel => ({
  id,
  name: id,
  supported_parameters: { input_references: { type: 'range', min: 0, max: 4 } },
  zdr,
  price: null,
  favorite: false,
  recommended: false,
  ...extra,
});

const params = (id: string, aspect?: string[], resolution?: string[]): ImageModel => ({
  id,
  name: id,
  supported_parameters: {
    ...(aspect ? { aspect_ratio: { type: 'enum', values: aspect } } : {}),
    ...(resolution ? { resolution: { type: 'enum', values: resolution } } : {}),
  },
});

const speech = (id: string, extra: Partial<SpeechModelInfo> = {}): SpeechModelInfo => ({
  id,
  name: id,
  description: '',
  pricing: {},
  voices: [],
  cloning: false,
  multiRef: false,
  zdr,
  favorite: false,
  recommended: false,
  ...extra,
});

describe('model choices', () => {
  it('offers image models with references allowed by the privacy mode, favorites and recommended first', () => {
    const models = rankModels(
      [
        image('z/last', { price: { cost: 0.04, unit: 'image', variants: {} } }),
        image('google/gemini-3-pro-image'),
        image('no/refs', { supported_parameters: {} }),
        image('sr/model', { zdr: withRetention, created: Date.UTC(2026, 9, 2) / 1000 }),
        image('open/model', { zdr: [] }),
        image('fav/model'),
      ],
      'image',
      ['fav/model'],
    );
    expect(imageModelChoices(models, 'zdr')).toEqual([
      { value: 'fav/model', label: 'fav/model', hint: '♥ favorite · ZDR' },
      { value: 'google/gemini-3-pro-image', label: 'google/gemini-3-pro-image', hint: '★ recommended · ZDR' },
      { value: 'sr/model', label: 'sr/model', hint: 'Oct 2026 · ZDR (safety retention)' },
      { value: 'z/last', label: 'z/last', hint: '$0.04/image · ZDR' },
    ]);
    expect(imageModelChoices(models, 'zdr-strict').map((c) => c.value)).not.toContain('sr/model');
    // A favorite that is also recommended shows both marks
    const both = rankModels([image('google/gemini-3-pro-image')], 'image', ['google/gemini-3-pro-image']);
    expect(imageModelChoices(both, 'zdr')[0].hint).toBe('♥ favorite · ★ recommended · ZDR');
    expect(imageModelChoices(models, 'off').map((c) => c.value)).toContain('open/model');
  });

  it('offers speech models with price, cloning and voices', () => {
    const models = rankModels(
      [
        speech('x/clone', { cloning: true, pricing: { prompt: '0.00003' } }),
        speech('elevenlabs/eleven-v4', { voices: ['a', 'b'] }),
        speech('x/one', { voices: ['a'] }),
        speech('x/open', { zdr: [] }),
      ],
      'speech',
      [],
    );
    expect(speechModelChoices(models, 'zdr')).toEqual([
      { value: 'elevenlabs/eleven-v4', label: 'elevenlabs/eleven-v4', hint: '★ recommended · ZDR · 2 voices' },
      { value: 'x/clone', label: 'x/clone', hint: '$0.030/1k chars · ZDR · clones voices' },
      { value: 'x/one', label: 'x/one', hint: 'ZDR · 1 voice' },
    ]);
  });

  it('offers voices by language, and all music models with how they run in the privacy mode', () => {
    const own = [{ name: 'me', label: 'Me', transcript: '', transcripts: {}, samples: [] }];
    expect(voiceChoices(speech('x', { voices: ['en-US-Ben', 'de-DE-Anna'] }), own)).toEqual([
      { value: 'de-DE-Anna', label: 'de-DE-Anna (DE)', hint: 'German' },
      { value: 'en-US-Ben', label: 'en-US-Ben (US)', hint: 'English' },
    ]);
    expect(voiceChoices(speech('x', { cloning: true }), own)).toEqual([
      { value: '', label: 'model default' },
      { value: 'voice:me', label: 'Me', hint: 'own voices' },
    ]);
    const music = [
      { id: 'g/lyria', name: 'Lyria', description: '', zdr: [], favorite: false, recommended: false },
      { id: 'g/zdr', name: 'Z', description: '', zdr, favorite: false, recommended: false },
      { id: 'g/sr', name: 'S', description: '', zdr: withRetention, favorite: false, recommended: false },
    ];
    // Core runs music without a matching ZDR endpoint (with a notice) instead of blocking it
    expect(musicModelChoices(music, 'zdr-strict')).toEqual([
      { value: 'g/lyria', label: 'g/lyria', hint: 'Lyria · no ZDR · runs without ZDR' },
      { value: 'g/zdr', label: 'g/zdr', hint: 'Z · ZDR' },
      { value: 'g/sr', label: 'g/sr', hint: 'S · ZDR (safety retention) · runs with safety retention' },
    ]);
    expect(musicModelChoices(music, 'off').map((c) => c.hint)).toEqual([
      'Lyria · no ZDR',
      'Z · ZDR',
      'S · ZDR (safety retention)',
    ]);
    expect(takesInstructions('google/gemini-tts')).toBe(true);
    expect(takesInstructions('elevenlabs/eleven-v4')).toBe(false);
  });
});

describe('aspect ratio and size choices', () => {
  it('offers the values any chosen model supports and names the models that snap or ignore them', () => {
    const models = [params('a/wide', ['1:1', '16:9']), params('b/tall', ['1:1', '9:16'], ['1K', '4K'])];
    expect(aspectChoices(models)).toEqual([
      { value: '', label: 'model default' },
      { value: '1:1', label: '1:1' },
      { value: '9:16', label: '9:16', hint: 'a/wide: 1:1' },
      { value: '16:9', label: '16:9', hint: 'b/tall: 1:1' },
    ]);
    expect(sizeChoices(models)).toEqual([
      { value: '', label: 'model default' },
      { value: '1K', label: '1K', hint: 'a/wide: ignored' },
      { value: '4K', label: '4K', hint: 'a/wide: ignored' },
    ]);
    expect(sizeChoices([params('a/none')])).toEqual([]);
    expect(aspectChoices([params('x', ['7:3', '1:1'])]).map((c) => c.value)).toEqual(['', '1:1', '7:3']);
  });
});

describe('defaults and summaries', () => {
  const choices = [
    { value: 'a', label: 'a' },
    { value: 'b', label: 'b' },
  ];

  it('pre-selects the first available preferred value', () => {
    expect(initialValue(choices, undefined, 'gone', 'b')).toBe('b');
    expect(initialValue(choices, null)).toBe('a');
    expect(initialValue([], 'a')).toBeUndefined();
    expect(initialValues(choices, ['gone', 'b'])).toEqual(['b']);
    expect(initialValues(choices, undefined)).toEqual(['a']);
  });

  it('formats money, counts and estimates', () => {
    expect(usd(0.01)).toBe('$0.0100');
    expect(usd(null)).toBe('n/a');
    expect(plural(1, 'result')).toBe('1 result');
    expect(plural(0, 'result')).toBe('0 results');
    expect(estimateText({ total: 0.08, unknown: false })).toBe('≈ $0.0800');
    expect(estimateText({ total: 0.08, unknown: true })).toBe('≈ $0.0800 + models without a known price');
    expect(estimateText({ total: 0, unknown: true })).toBe('unknown');
  });

  it('summarizes runs without empty lines', () => {
    expect(
      imageSummary(
        { privacy: 'zdr', models: ['a', 'b'], element: null, count: 2, prompt: 'cat', size: '2K' },
        '≈ $0.1',
      ),
    ).toEqual([
      'Models       a, b',
      'Images       2 per model, 4 in total',
      'Privacy      zdr',
      'Size         2K',
      'Prompt       cat',
      'Cost         ≈ $0.1',
    ]);
    expect(speechSummary({ privacy: 'off', model: 'm', text: 'Hi', speed: 1.1 }, 'unknown')).toEqual([
      'Model        m',
      'Voice        model default',
      'Privacy      off',
      'Speed        1.1×',
      'Text         Hi',
      'Cost         unknown',
    ]);
    expect(musicSummary({ privacy: 'off', model: 'm', prompt: 'p' }, 'unknown')).toHaveLength(4);
  });
});
