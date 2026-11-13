import { stripVTControlCharacters as plain } from 'node:util';
import type { SpeechModelInfo } from '@darkroom/core/contract';
import { rankModels } from '@darkroom/core/models/catalog';
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
    // Compact: title and one line
    expect(blocks[0]).toBe(
      'google/gemini-3-pro-image  ★ recommended\nprice n/a  refs up to 8  ZDR ZDR  usable with --privacy zdr-strict',
    );
    expect(blocks[1]).toContain('ZDR ZDR (safety retention)  blocked with --privacy zdr-strict');
    expect(text(imageModelBlocks(models, { privacy: 'off', all: true, search: 'REFS' }))).toHaveLength(1);
    expect(imageModelBlocks(models, { privacy: 'off', search: 'nothing' })).toEqual([]);
  });

  it('lists all parameters of image models with --details', () => {
    const m = image('x/full', {
      description: 'A model. It draws.',
      supported_parameters: {
        input_references: { type: 'range', min: 0, max: 14 },
        resolution: { type: 'enum', values: ['1K', '2K', '4K'] },
        aspect_ratio: { type: 'enum', values: ['1:1', '16:9'] },
        output_format: { type: 'enum', values: ['png', 'webp'] },
        n: { type: 'range', min: 1, max: 4 },
        seed: { type: 'boolean' },
        guidance: { type: 'range', min: 1, max: 20 },
      },
      zdr: [
        { tag: 'a/zdr', provider: 'A', safetyRetention: false },
        { tag: 'b/zdr', provider: 'B', safetyRetention: true },
      ],
    });
    expect(
      text(imageModelBlocks([m], { privacy: 'zdr', details: true }))[0]
        .split('\n')
        .slice(2),
    ).toEqual([
      'sizes         1K 2K 4K',
      'aspect        1:1 16:9',
      'formats       png webp',
      'quality       model default',
      'references    up to 14',
      'images        1–4 per request',
      'other         seed, guidance 1–20',
      'ZDR           a/zdr, b/zdr (safety retention)',
      'about         A model.',
    ]);
    const bare = image('x/bare', {
      zdr: [],
      supported_parameters: { input_references: { type: 'range', min: 0, max: 1 } },
    });
    const lines = text(imageModelBlocks([bare], { privacy: 'off', details: true }))[0];
    expect(lines).toContain('images        1 per request');
    expect(lines).toContain('ZDR           none');
    expect(lines).not.toContain('other');
  });

  it('lists speech models with price, voices and cloning, and music models', () => {
    const blocks = text(
      speechModelBlocks([speech('x/clone', { cloning: true }), speech('x/voices', { voices: ['a', 'b'], zdr: [] })], {
        privacy: 'zdr',
      }),
    );
    expect(blocks[0]).toContain('price $0.020/1k chars  voices model default  cloning yes (voice:<name>)  ZDR ZDR');
    expect(blocks[1]).toContain('voices 2  cloning no  ZDR no ZDR  blocked with --privacy zdr');
    const lyria = { id: 'g/lyria', name: 'Lyria', description: '', zdr: [], favorite: false, recommended: false };
    const music = text(musicModelBlocks([lyria], { privacy: 'off' }));
    expect(music[0]).toContain('usable with --privacy off');
    // Music runs without a ZDR endpoint (with a notice), it is never blocked
    expect(text(musicModelBlocks([lyria], { privacy: 'zdr' }))[0]).toContain(
      'no ZDR  runs without ZDR with --privacy zdr',
    );
    expect(musicModelBlocks([lyria], { privacy: 'off', search: 'x' })).toEqual([]);
  });

  it('lists voices, cloning, instructions and speed of speech models and the length of music with --details', () => {
    const tts = speech('google/tts', { voices: ['de-DE-Anna', 'en-US-Ben', 'en-GB-Amy'], description: 'Speaks.' });
    expect(
      text(speechModelBlocks([tts], { privacy: 'zdr', details: true }))[0]
        .split('\n')
        .slice(2),
    ).toEqual([
      'voices        3: German 1, English 2',
      'cloning       no',
      'instructions  yes (-i)',
      'speed         0.25–4× (--speed; sent to the provider, not every model follows it)',
      'ZDR           p/zdr',
      'about         Speaks.',
    ]);
    const clone = text(
      speechModelBlocks([speech('x/c', { cloning: true, multiRef: true })], { privacy: 'zdr', details: true }),
    );
    expect(clone[0]).toContain('voices        model default only');
    expect(clone[0]).toContain('cloning       yes, several reference clips');
    expect(clone[0]).toContain('instructions  no');
    const music = (id: string, description = '') => ({
      id,
      name: id,
      description,
      zdr,
      favorite: false,
      recommended: false,
    });
    const lengths = text(
      musicModelBlocks([music('g/lyria-3-clip'), music('g/lyria-3-pro'), music('x/m', 'Makes a song'), music('x/n')], {
        privacy: 'zdr',
        details: true,
      }),
    ).map((b) => b.split('\n').find((l) => l.startsWith('length')));
    expect(lengths).toEqual([
      'length        clip (about 30 s)',
      'length        full song',
      'length        full song',
      undefined,
    ]);
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
