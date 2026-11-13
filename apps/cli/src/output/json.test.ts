import path from 'node:path';
import type { ManifestEntry, MusicModelInfo, SpeechModelInfo } from '@darkroom/core/contract';
import { AppError } from '@darkroom/core/errors';
import { CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';
import type { CatalogImageModel } from '../interactive/choices.ts';
import {
  costsDocument,
  elementsDocument,
  failureDocument,
  favoritesDocument,
  imageModelsDocument,
  modelVoicesDocument,
  musicModelsDocument,
  ownVoicesDocument,
  printJson,
  runDocument,
  speechModelsDocument,
} from './json.ts';

const OUT = path.resolve('/data/out');
const zdr = [{ tag: 'p/zdr', provider: 'P', safetyRetention: false }];
const marks = { favorite: false, recommended: false };

function entry(e: Partial<ManifestEntry>): ManifestEntry {
  return {
    ...{ runId: 'r', ts: '', ok: true, file: null, prompt: '', fullPrompt: '', model: 'a/b', element: null },
    ...{ usePrefix: true, extraRefs: [], refCount: 0, params: {}, privacy: 'zdr', providerRestriction: null },
    ...{ warnings: [], generationId: null, provider: null, cost: null, callCost: null, durationMs: 0, mediaType: null },
    ...e,
  };
}

describe('JSON output', () => {
  it('prints one document: indented for a terminal, one line for pipes', () => {
    const lines: string[] = [];
    printJson({ a: [1] }, { write: (s: string) => lines.push(s) });
    printJson({ a: [1] }, { write: (s: string) => lines.push(s), isTTY: true });
    expect(lines).toEqual(['{"a":[1]}\n', '{\n  "a": [\n    1\n  ]\n}\n']);
  });

  it('describes a run: results with absolute paths and coded warnings, errors, costs', () => {
    const doc = runDocument(
      'image',
      [
        entry({
          file: 'x_1.png',
          cost: 0.1 + 0.2,
          durationMs: 1500,
          warnings: ['Aspect ratio 5:4 not available, using 4:3', 'old warning without code'],
          notices: [{ code: 'aspect_adjusted', params: { from: '5:4', to: '4:3' } }],
        }),
        entry({ ok: false, model: 'c/d', error: 'No ZDR', errorCode: 'privacy_blocked', cost: 0.01 }),
        entry({ ok: false, model: 'e/f', error: 'HTTP 503' }),
        entry({ ok: false, model: 'g/h', errorCode: 'unknown_model', errorParams: { model: 'g/h' } }),
      ],
      { total: 1.1 + 2.2, images: 2, byModel: {} },
      OUT,
    );
    expect(doc).toEqual({
      ok: true,
      results: [
        {
          file: path.join(OUT, 'x_1.png'),
          kind: 'image',
          model: 'a/b',
          cost: 0.3,
          durationMs: 1500,
          warnings: [
            { code: 'aspect_adjusted', params: { from: '5:4', to: '4:3' }, message: expect.stringContaining('5:4') },
            { code: null, params: {}, message: 'old warning without code' },
          ],
        },
      ],
      errors: [
        { model: 'c/d', code: 'privacy_blocked', message: 'No ZDR', params: {} },
        { model: 'e/f', code: null, message: 'HTTP 503', params: {} },
        { model: 'g/h', code: 'unknown_model', message: 'Failed', params: { model: 'g/h' } },
      ],
      cost: { run: 0.31, totalSoFar: 3.3 },
    });
  });

  it('says ok: false when a run made nothing, and keeps the voice of speech results', () => {
    expect(runDocument('music', [entry({ ok: false })], { total: 0, images: 0, byModel: {} }, OUT).ok).toBe(false);
    const speech = runDocument(
      'speech',
      [entry({ file: 'a.wav', voice: 'voice:me' })],
      { total: 0, images: 1, byModel: {} },
      OUT,
    );
    expect(speech.results[0]).toMatchObject({ kind: 'speech', voice: 'voice:me', cost: null });
  });

  it('describes a failed command with its code', () => {
    expect(failureDocument(new AppError('unknown_model', 'Unknown model "x"', { model: 'x' }))).toEqual({
      ok: false,
      error: { code: 'unknown_model', message: 'Unknown model "x"', params: { model: 'x' } },
    });
    const commander = new CommanderError(1, 'commander.unknownOption', "error: unknown option '--x'");
    expect(failureDocument(commander).error).toEqual({
      code: 'commander.unknownOption',
      message: "unknown option '--x'",
      params: {},
    });
    expect(failureDocument(new Error('Network error')).error).toEqual({
      code: null,
      message: 'Network error',
      params: {},
    });
    expect(failureDocument('plain').error.message).toBe('plain');
  });
});

describe('JSON listings', () => {
  const image = (id: string, extra: Partial<CatalogImageModel> = {}): CatalogImageModel => ({
    id,
    name: `Name ${id}`,
    created: 1_767_225_600,
    supported_parameters: { input_references: { type: 'range', min: 0, max: 4 } },
    zdr,
    price: { cost: 0.04, unit: 'image', variants: {} },
    ...marks,
    ...extra,
  });

  it('lists image models like the text listing, with the parameters on --details', () => {
    const models = [
      image('a/one', { favorite: true, description: 'First.' }),
      image('b/strict', { zdr: [{ tag: 't', provider: 'Q', safetyRetention: true }], created: undefined }),
      image('c/norefs', { supported_parameters: {}, price: null }),
    ];
    const docs = imageModelsDocument(models, { privacy: 'zdr-strict' });
    expect(docs).toEqual([
      {
        ...{ id: 'a/one', name: 'Name a/one', released: '2026-01-01', new: false, favorite: true, recommended: false },
        ...{ zdr: 'ZDR', usable: true, price: '$0.04/image', maxRefs: 4 },
      },
      expect.objectContaining({ id: 'b/strict', released: null, zdr: 'ZDR (safety retention)', usable: false }),
    ]);
    const details = imageModelsDocument(models, { privacy: 'off', all: true, details: true, search: 'one' });
    expect(details).toEqual([
      expect.objectContaining({
        usable: true,
        parameters: { input_references: { type: 'range', min: 0, max: 4 } },
        zdrEndpoints: [{ provider: 'P', tag: 'p/zdr', safetyRetention: false }],
        description: 'First.',
      }),
    ]);
    expect(imageModelsDocument(models, { privacy: 'off', all: true })).toHaveLength(3);
  });

  it('lists speech models with voices, cloning and instructions', () => {
    const speech: SpeechModelInfo = {
      ...{
        id: 'google/tts',
        name: 'TTS',
        description: '',
        pricing: { prompt: '0.00002' },
        voices: ['de-DE-A', 'en-US-B'],
      },
      ...{ cloning: true, multiRef: false, zdr, ...marks },
    };
    const [short] = speechModelsDocument([speech], { privacy: 'zdr' });
    expect(short).toMatchObject({ id: 'google/tts', voiceCount: 2, cloning: true, usable: true });
    expect(short).not.toHaveProperty('voices');
    const [full] = speechModelsDocument([speech], { privacy: 'zdr', details: true });
    expect(full).toMatchObject({
      voices: [
        { voice: 'de-DE-A', language: 'German' },
        { voice: 'en-US-B', language: 'English' },
      ],
      multiRef: false,
      instructions: true,
    });
  });

  it('lists music models as always usable, with a privacy note when unmatched', () => {
    const music: MusicModelInfo = { id: 'g/lyria-clip', name: 'Lyria', description: 'Music', zdr: [], ...marks };
    expect(musicModelsDocument([music], { privacy: 'zdr', details: true })).toEqual([
      expect.objectContaining({ usable: true, privacyNote: 'runs without ZDR', length: 'clip (about 30 s)' }),
    ]);
    expect(musicModelsDocument([music], { privacy: 'off' })[0]).toMatchObject({ privacyNote: null });
  });

  it('lists voices, elements, favorites and costs', () => {
    const own = [{ name: 'me', label: 'Me', transcript: '', transcripts: {}, samples: ['a.wav', 'b.wav'] }];
    expect(ownVoicesDocument(own)).toEqual([{ voice: 'voice:me', name: 'me', label: 'Me', samples: 2 }]);
    const model = { id: 'f/clone', name: 'C', description: '', pricing: {}, voices: ['en-US-B'], cloning: true };
    expect(modelVoicesDocument({ ...model, multiRef: false, zdr }, own)).toEqual([
      { voice: 'voice:me', label: 'Me', language: null, own: true },
      { voice: 'en-US-B', label: 'en-US-B (US)', language: 'English', own: false },
    ]);
    const element = { name: 'me', label: 'Me', type: 'person' as const, instructions: '', photos: ['1.jpg'] };
    expect(elementsDocument([element])).toEqual([
      { name: 'me', mention: '@me', label: 'Me', type: 'person', instructions: '', images: 1 },
    ]);
    const favorites = { image: ['a/b'], speech: ['s/t'], music: [] };
    expect(favoritesDocument(favorites, ['image', 'speech', 'music'])).toEqual([
      { kind: 'image', model: 'a/b' },
      { kind: 'speech', model: 's/t' },
    ]);
    expect(favoritesDocument(favorites, ['music'])).toEqual([]);
    const byModel = { 'a/b': { cost: 0.01, images: 1 }, 'c/d': { cost: 0.1 + 0.2, images: 3 } };
    expect(costsDocument({ total: 0.31000000000000005, images: 4, byModel })).toEqual({
      total: 0.31,
      results: 4,
      models: [
        { model: 'c/d', cost: 0.3, results: 3 },
        { model: 'a/b', cost: 0.01, results: 1 },
      ],
    });
  });
});
