import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import {
  composerSummary,
  debugRows,
  deleteTexts,
  entryElements,
  entryInfoRows,
  modelName,
  runMetaParts,
  type SummaryInput,
  transcribeApiLabel,
  transcribeBlockedText,
  voiceLabel,
} from './labels';
import type { DebugRecord, ImageModel, ManifestEntry } from './types';

/** Returns the key, followed by the param values: "composer.images:2". */
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join('/')}` : key) as unknown as TFunction;

const entry = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({
  runId: 'r1',
  ts: '2026-01-01T00:00:00Z',
  ok: true,
  file: 'a.png',
  prompt: 'portrait',
  fullPrompt: '',
  model: 'x/a',
  element: null,
  usePrefix: true,
  extraRefs: [],
  refCount: 0,
  params: {},
  privacy: 'zdr',
  providerRestriction: null,
  warnings: [],
  generationId: null,
  provider: null,
  cost: 0.04,
  callCost: 0.04,
  durationMs: 12_340,
  mediaType: 'image/png',
  ...over,
});

describe('entry helpers', () => {
  it('lists the elements of new and old entries', () => {
    expect(entryElements({ element: 'anna', elements: ['anna', 'logo'] })).toEqual(['anna', 'logo']);
    expect(entryElements({ element: 'anna' })).toEqual(['anna']);
    expect(entryElements({ element: null, elements: [] })).toEqual([]);
  });

  it('labels voices', () => {
    const voices = [{ name: 'me', label: 'Me', transcript: '', transcripts: {}, samples: [] }];
    expect(voiceLabel(t, voices, undefined)).toBe('gallery.defaultVoice');
    expect(voiceLabel(t, voices, 'voice:me')).toBe('gallery.ownVoiceLabel:Me');
    expect(voiceLabel(t, voices, 'voice:gone')).toBe('gallery.ownVoiceLabel:gone');
    expect(voiceLabel(t, voices, 'en-US-Ava:MAI-Voice-1')).toBe('en-US-Ava');
  });
});

describe('deleteTexts', () => {
  it('names images, audio and failed entries', () => {
    expect(deleteTexts(t, { ok: true, kind: 'image' })).toEqual({
      label: 'gallery.deleteImage',
      confirm: 'gallery.confirmImage',
    });
    expect(deleteTexts(t, { ok: true })).toMatchObject({ label: 'gallery.deleteImage' });
    expect(deleteTexts(t, { ok: true, kind: 'audio' })).toEqual({
      label: 'gallery.deleteAudio',
      confirm: 'gallery.confirmAudio',
    });
    expect(deleteTexts(t, { ok: false, kind: 'audio' })).toEqual({ label: 'gallery.removeError', confirm: null });
  });
});

describe('runMetaParts', () => {
  const voice = (v?: string) => `voice ${v}`;

  it('describes audio runs', () => {
    expect(runMetaParts(t, { kind: 'audio', params: { mode: 'music' } }, voice)).toEqual(['gallery.music', undefined]);
    expect(runMetaParts(t, { kind: 'audio', voice: 'Rachel', params: { instructions: 'calm' } }, voice)).toEqual([
      'gallery.speechMeta:voice Rachel',
      'calm',
    ]);
  });

  it('describes tool runs', () => {
    expect(runMetaParts(t, { tool: 'import' }, voice)).toEqual(['gallery.ownImage', null]);
    expect(runMetaParts(t, { tool: 'crop', source: 'a.png', element: 'anna' }, voice)).toEqual([
      'gallery.toolOn:a.png',
      'gallery.element:anna',
    ]);
    expect(runMetaParts(t, { tool: 'crop' }, voice)).toEqual(['gallery.tool', null]);
  });

  it('describes image runs', () => {
    const first = {
      elements: ['anna', 'logo'],
      params: { aspect_ratio: '3:4', resolution: '2K' },
      extraRefs: ['b.png'],
    };
    expect(runMetaParts(t, first, voice)).toEqual(['gallery.elements:@anna, @logo', '3:4', '2K', undefined, '+1 Ref']);
    expect(runMetaParts(t, { element: 'anna' }, voice)[0]).toBe('gallery.element:anna');
    expect(runMetaParts(t, {}, voice)[0]).toBe('gallery.noElement');
  });
});

describe('composerSummary', () => {
  const priced: ImageModel = {
    id: 'x/a',
    name: 'A',
    supported_parameters: {},
    zdr: [],
    price: { cost: 0.04, unit: 'image', variants: {} },
  };
  const unpriced: ImageModel = { ...priced, id: 'x/b', price: null };
  const input = (over: Partial<SummaryInput> = {}, settings: Partial<SummaryInput['settings']> = {}) =>
    composerSummary(t, {
      settings: {
        mode: 'image',
        models: ['x/a'],
        privacy: 'off',
        count: 2,
        size: '',
        quality: '',
        audioKind: 'speech',
        ...settings,
      },
      models: [priced, unpriced],
      costs: undefined,
      promptLength: 12,
      running: 0,
      ...over,
    });

  it('summarizes image runs with their estimated cost', () => {
    expect(input()).toBe('composer.images:2 · composer.models:1 · composer.estimate:$0.0800');
    expect(input({ running: 1 }, { models: ['x/a', 'x/b'] })).toBe(
      'composer.images:4 · composer.models:2 · composer.estimate:$0.0800composer.estimateUnknown · composer.running:1',
    );
    expect(input({}, { models: ['x/b'] })).toBe('composer.images:2 · composer.models:1 · composer.costUnknown');
    // models blocked by the privacy mode don't count
    expect(input({}, { privacy: 'zdr' })).toBe('');
  });

  it('summarizes audio runs', () => {
    expect(input({}, { mode: 'audio' })).toBe('composer.chars:12');
    expect(input({ running: 2 }, { mode: 'audio', audioKind: 'music' })).toBe(
      'composer.musicClip · composer.running:2',
    );
  });
});

describe('detail rows', () => {
  it('lists the details of a result', () => {
    const e = entry({
      elements: ['anna'],
      cost: 0.02,
      providerRestriction: ['A', 'B'],
      params: { aspect_ratio: '3:4' },
    });
    expect(Object.fromEntries(entryInfoRows(t, e, (id) => `Model ${id}`))).toEqual({
      'lightbox.model': 'Model x/a',
      'lightbox.provider': 'common.none',
      'lightbox.cost': '$0.0200 lightbox.callCost:$0.0400',
      'lightbox.duration': 'lightbox.seconds:12.3',
      'lightbox.elements': '@anna',
      'lightbox.references': '0',
      'lightbox.params': 'aspect_ratio=3:4',
      'lightbox.privacy': 'zdr → A, B',
      'lightbox.file': 'a.png',
      'lightbox.generationId': 'common.none',
    });
    expect(Object.fromEntries(entryInfoRows(t, entry(), String))['lightbox.cost']).toBe('$0.0400');
  });

  it('lists a recorded API call, with provider and generation id from the headers', () => {
    const d: DebugRecord = {
      id: 'd1',
      ts: '',
      endpoint: '/chat/completions',
      method: 'POST',
      status: null,
      durationMs: 1500,
      request: {},
      response: null,
      responseHeaders: { 'x-openrouter-provider': 'Google', 'x-generation-id': 'gen-1' },
      sentFiles: [],
    };
    expect(Object.fromEntries(debugRows(t, entry(), d))).toEqual({
      'debug.endpoint': 'POST /chat/completions',
      'debug.status': 'debug.noResponse',
      'debug.duration': 'lightbox.seconds:1.5',
      'debug.model': 'x/a',
      'debug.provider': 'Google',
      'debug.generationId': 'gen-1',
      'debug.cost': '$0.0400',
      'debug.elements': 'common.none',
      'debug.refsSent': '0',
    });
  });
});

describe('transcription texts', () => {
  it('names the API engine with the current privacy mode', () => {
    expect(transcribeApiLabel(t, 'openai/whisper-1', 'zdr')).toBe('voices.engineApi:whisper-1/topbar.privacyZdrShort');
    expect(transcribeApiLabel(t, undefined, 'zdr-strict')).toBe('voices.engineApi:Whisper/topbar.privacyStrictShort');
    expect(transcribeApiLabel(t, 'x/w', 'off')).toBe('voices.engineApi:w/zdr.none');
  });

  it('suggests the local engine when the privacy mode blocks the API transcription', () => {
    const blocked = { code: 'privacy_blocked_strict' };
    expect(transcribeBlockedText(t, blocked, 'api', 'zdr-strict')).toBe(
      'voices.privacyBlocked:topbar.privacyStrictShort',
    );
    expect(transcribeBlockedText(t, { code: 'privacy_blocked' }, 'api', 'zdr')).toBe(
      'voices.privacyBlocked:topbar.privacyZdrShort',
    );
    expect(transcribeBlockedText(t, blocked, 'local', 'zdr-strict')).toBeNull();
    expect(transcribeBlockedText(t, new Error('x'), 'api', 'zdr')).toBeNull();
    expect(transcribeBlockedText(t, null, 'api', 'zdr')).toBeNull();
  });
});

describe('modelName', () => {
  it('names local tools, catalog models (without provider prefix) and unknown IDs', () => {
    const catalogs = [[{ id: 'google/x', name: 'Google: Nano Banana' }], [{ id: 'eleven/v4', name: 'ElevenLabs v4' }]];
    expect(modelName(t, 'local/sharp', catalogs)).toBe('gallery.local');
    expect(modelName(t, 'google/x', catalogs)).toBe('Nano Banana');
    expect(modelName(t, 'eleven/v4', catalogs)).toBe('ElevenLabs v4');
    expect(modelName(t, 'gone/model', catalogs)).toBe('gone/model');
  });
});
