import { stripVTControlCharacters as plain } from 'node:util';
import type { SpeechModel } from '@darkroom/core/contract';
import { describe, expect, it } from 'vitest';
import type { CatalogImageModel } from './choices.ts';
import { imageModelBlocks, musicModelBlocks, speechModelBlocks, voiceBlocks } from './listing.ts';

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
  ...extra,
});
const speech = (id: string, extra: Partial<SpeechModel> = {}): SpeechModel => ({
  id,
  name: `Name ${id}`,
  description: '',
  pricing: { prompt: '0.00002' },
  voices: [],
  cloning: false,
  multiRef: false,
  zdr,
  ...extra,
});
const text = (blocks: string[]) => blocks.map(plain);

describe('model listings', () => {
  it('lists image models with references, price, parameters and privacy status', () => {
    const models = [
      image('z/model', { zdr: [{ tag: 't', provider: 'P', safetyRetention: true }] }),
      image('openai/gpt-image-2', { price: null }),
      image('no/refs', { supported_parameters: {} }),
    ];
    const blocks = text(imageModelBlocks(models, { privacy: 'zdr-strict' }));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('openai/gpt-image-2  ★ recommended');
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
    const music = text(
      musicModelBlocks([{ id: 'g/lyria', name: 'Lyria', description: '', zdr: [] }], { privacy: 'off' }),
    );
    expect(music[0]).toContain('usable with --privacy off');
    expect(
      musicModelBlocks([{ id: 'g/lyria', name: 'Lyria', description: '', zdr: [] }], { privacy: 'off', search: 'x' }),
    ).toEqual([]);
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
