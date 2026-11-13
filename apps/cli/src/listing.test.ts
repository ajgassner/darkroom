import { stripVTControlCharacters as plain } from 'node:util';
import { rankModels } from '@darkroom/core/catalog';
import type { SpeechModelInfo } from '@darkroom/core/contract';
import { describe, expect, it } from 'vitest';
import type { CatalogImageModel } from './choices.ts';
import { favoriteBlocks, imageModelBlocks, musicModelBlocks, speechModelBlocks, voiceBlocks } from './listing.ts';

const zdr = [{ tag: 'p/zdr', provider: 'P', safetyRetention: false }];
const image = (id: string, extra: Partial<CatalogImageModel> = {}): CatalogImageModel => ({
  id,
  name: `Name ${id}`,
  supported_parameters: {
    input_references: { type: 'range', min: 0, max: 8 },
    aspect_ratio: { type: 'enum', values: ['1:1', '3:4'] },
    seed: { type: 'boolean' },
  },
  zdr,
  price: { cost: 0.04, unit: 'image', variants: {} },
  favorite: false,
  recommended: false,
  ...extra,
});
const speech = (id: string, extra: Partial<SpeechModelInfo> = {}): SpeechModelInfo => ({
  id,
  name: `Name ${id}`,
  description: '',
  pricing: { prompt: '0.00002' },
  voices: [],
  cloning: false,
  multiRef: false,
  zdr,
  favorite: false,
  recommended: false,
  ...extra,
});
const text = (blocks: string[]) => blocks.map(plain);

describe('model listings', () => {
  it('lists image models with references, price, parameters and privacy status', () => {
    const models = rankModels(
      [
        image('z/model', { zdr: [{ tag: 't', provider: 'P', safetyRetention: true }] }),
        image('google/gemini-3-pro-image', { price: null }),
        image('no/refs', { supported_parameters: {} }),
      ],
      'image',
      [],
    );
    const blocks = text(imageModelBlocks(models, { privacy: 'zdr-strict' }));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('google/gemini-3-pro-image  ★ recommended');
    expect(blocks[0]).toContain('price n/a  refs 0–8  n –');
    expect(blocks[0]).toContain('aspect 1:1 3:4');
    expect(blocks[0]).toContain('ZDR p/zdr  usable with --privacy zdr-strict');
    expect(blocks[1]).toContain('ZDR t (safety retention)  blocked with --privacy zdr-strict');
    expect(text(imageModelBlocks(models, { privacy: 'off', all: true, search: 'REFS' }))).toHaveLength(1);
    expect(imageModelBlocks(models, { privacy: 'off', search: 'nothing' })).toEqual([]);
  });

  it('lists speech models with price, voices and cloning, and music models', () => {
    const blocks = text(
      speechModelBlocks([speech('x/clone', { cloning: true }), speech('x/voices', { voices: ['a', 'b'], zdr: [] })], {
        privacy: 'zdr',
      }),
    );
    expect(blocks[0]).toContain('price $0.020/1k chars  voices model default  cloning yes (voice:<name>)');
    expect(blocks[1]).toContain('voices 2  cloning no');
    expect(blocks[1]).toContain('no ZDR  blocked with --privacy zdr');
    const lyria = { id: 'g/lyria', name: 'Lyria', description: '', zdr: [], favorite: false, recommended: false };
    const music = text(musicModelBlocks([lyria], { privacy: 'off' }));
    expect(music[0]).toContain('usable with --privacy off');
    expect(musicModelBlocks([lyria], { privacy: 'off', search: 'x' })).toEqual([]);
  });

  it('marks favorites, the release month and new models', () => {
    const now = Date.now() / 1000;
    const models = rankModels(
      [
        speech('x/old', { created: Date.UTC(2025, 9, 15) / 1000 }),
        speech('x/fresh', { created: now - 3 * 86_400 }),
        speech('elevenlabs/eleven-v4'),
      ],
      'speech',
      ['x/old'],
    );
    const blocks = text(speechModelBlocks(models, { privacy: 'zdr' }));
    expect(blocks[0]).toMatch(/^x\/old {2}♥ favorite {2}Oct 2025 {2}Name x\/old/);
    expect(blocks[1]).toMatch(/^elevenlabs\/eleven-v4 {2}★ recommended {2}Name/);
    expect(blocks[2]).toMatch(/^x\/fresh {2}\w{3} \d{4} {2}new/);
    expect(text(favoriteBlocks({ image: ['a/b'], speech: [], music: [] }, ['image', 'speech']))).toEqual([
      'image favorites (1)\na/b',
      'speech favorites (0)\nnone',
    ]);
  });

  it('lists a model’s voices by language together with the own voices', () => {
    const own = [{ name: 'me', label: 'Me', transcript: '', transcripts: {}, samples: [] }];
    expect(text(voiceBlocks(speech('x', { voices: ['en-US-Ben', 'de-DE-Anna', 'en-GB-Amy'] }), own))).toEqual([
      'German (1)\nde-DE-Anna',
      'English (2)\nen-US-Ben, en-GB-Amy',
      'Own voices (voice:me) need a model that clones.',
    ]);
    expect(text(voiceBlocks(speech('x', { cloning: true }), own))).toEqual([
      'own voices (1)\nvoice:me Me',
      'No preset voices: the model speaks with its default voice.',
    ]);
  });
});
