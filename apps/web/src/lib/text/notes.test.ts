import { describe, expect, it } from 'vitest';
import type { ElementInfo, ImageModel, MusicModel, SpeechModel, VoiceInfo, ZdrEndpoint } from '../types';
import { type AudioNotesInput, audioNotes, blockingNotes, type ImageNotesInput, imageNotes } from './notes';

const zdr: ZdrEndpoint[] = [{ tag: 'a', provider: 'A', safetyRetention: false }];

function imageModel(id: string, params: Record<string, string[]> = {}, maxRefs = 4): ImageModel {
  const enums = Object.fromEntries(Object.entries(params).map(([k, values]) => [k, { type: 'enum' as const, values }]));
  return {
    id,
    name: id,
    supported_parameters: { input_references: { type: 'range', min: 0, max: maxRefs }, ...enums },
    zdr,
    price: null,
    favorite: false,
    recommended: false,
  };
}

const element = (name: string, photos: string[] = ['1.jpg']): ElementInfo => ({
  name,
  photos,
  label: name,
  type: 'person',
  instructions: '',
});

function imageInput(over: Partial<ImageNotesInput> = {}, settings: Partial<ImageNotesInput['settings']> = {}) {
  return imageNotes({
    status: { hasKey: true },
    settings: { models: ['x/a'], element: 'anna', privacy: 'zdr', aspect: '', size: '', format: '', ...settings },
    models: [imageModel('x/a')],
    elements: [element('anna')],
    prompt: '',
    extraRefCount: 0,
    modelName: (id) => `Model ${id}`,
    ...over,
  });
}

describe('imageNotes', () => {
  it('has nothing to say about a complete setup', () => {
    expect(imageInput()).toEqual([]);
  });

  it('reports a missing key, model, element and photos, and unknown mentions', () => {
    expect(imageInput({ status: { hasKey: false }, prompt: 'with @bob' }, { models: [], element: '' })).toEqual([
      { tone: 'err', key: 'keyMissing' },
      { tone: 'err', key: 'noModel' },
      { tone: 'warn', key: 'noElement' },
      { tone: 'warn', key: 'unknownMention', params: { name: 'bob' } },
    ]);
    expect(imageInput({ elements: [element('anna', [])] })).toEqual([
      { tone: 'err', key: 'elementNoPhotos', params: { name: 'anna' } },
    ]);
  });

  it('only reports the privacy block for a blocked model', () => {
    const blocked = { ...imageModel('x/a', {}, 0), zdr: [] };
    expect(imageInput({ models: [blocked], extraRefCount: 3 }, { size: '4K' })).toEqual([
      { tone: 'err', key: 'blocked', params: { model: 'Model x/a' } },
    ]);
  });

  it('reports settings the model adjusts or ignores', () => {
    const m = imageModel('x/a', { aspect_ratio: ['1:1', '16:9'], resolution: ['1K', '2K'], output_format: ['png'] }, 2);
    const notes = imageInput({ models: [m], extraRefCount: 2 }, { aspect: '21:9', size: '4K', format: 'webp' });
    expect(notes).toEqual([
      { tone: 'warn', key: 'refsOver', params: { model: 'Model x/a', max: 2, count: 1 } },
      { tone: '', key: 'aspectAdjusted', params: { model: 'Model x/a', from: '21:9', to: '16:9' } },
      { tone: '', key: 'sizeAdjusted', params: { model: 'Model x/a', from: '4K', to: '2K' } },
      { tone: '', key: 'formatUnsupported', params: { model: 'Model x/a' } },
    ]);
    expect(imageInput({}, { size: '2K' })).toEqual([
      { tone: '', key: 'sizeUnsupported', params: { model: 'Model x/a' } },
    ]);
    // Without an aspect ratio parameter the model uses its own (the server ignores the value)
    expect(imageInput({}, { aspect: '16:9' })).toEqual([
      { tone: '', key: 'aspectUnsupported', params: { model: 'Model x/a' } },
    ]);
  });

  it('picks the blocking notes', () => {
    const blocked = { ...imageModel('x/a'), zdr: [] };
    const notes = imageInput({ models: [blocked], elements: [] }, { element: '' });
    expect(notes.map((n) => n.key)).toEqual(['noElement', 'blocked']);
    expect(blockingNotes(notes)).toEqual([{ tone: 'err', key: 'blocked', params: { model: 'Model x/a' } }]);
    expect(blockingNotes(imageInput())).toEqual([]);
  });
});

const speechModel = (id: string, over: Partial<SpeechModel> = {}): SpeechModel => ({
  id,
  name: id,
  description: '',
  pricing: {},
  voices: ['Rachel'],
  cloning: false,
  multiRef: false,
  zdr,
  favorite: false,
  recommended: false,
  ...over,
});

const voice = (over: Partial<VoiceInfo> = {}): VoiceInfo => ({
  name: 'me',
  label: 'Me',
  transcript: 'Hello',
  transcripts: {},
  samples: ['1.wav'],
  ...over,
});

const music: MusicModel = {
  id: 'google/lyria',
  name: 'Lyria',
  description: '',
  zdr: [],
  favorite: false,
  recommended: false,
};

function audioInput(over: Partial<AudioNotesInput> = {}, settings: Partial<AudioNotesInput['settings']> = {}) {
  return audioNotes({
    status: { hasKey: true },
    settings: {
      audioKind: 'speech',
      speechModel: 'openai/tts',
      musicModel: 'google/lyria',
      privacy: 'zdr',
      voice: 'Rachel',
      instructions: '',
      ...settings,
    },
    speechModels: [speechModel('openai/tts')],
    musicModels: [music],
    voices: [],
    ...over,
  });
}

describe('audioNotes', () => {
  it('has nothing to say about a complete setup', () => {
    expect(audioInput()).toEqual([]);
  });

  it('reports a missing key or speech model', () => {
    expect(audioInput({ status: { hasKey: false }, speechModels: [] })).toEqual([
      { tone: 'err', key: 'keyMissing' },
      { tone: 'err', key: 'speechModelMissing' },
    ]);
  });

  it('reports privacy, price, own voice problems, cloning and ignored instructions', () => {
    const m = speechModel('x/tts', { zdr: [], pricing: { prompt: '0.000015' } });
    const own = voice({ samples: [], transcript: ' ' });
    const notes = audioInput(
      { speechModels: [m], voices: [own] },
      { speechModel: 'x/tts', voice: 'voice:me', instructions: 'calm' },
    );
    expect(notes).toEqual([
      { tone: 'err', key: 'modelBlocked' },
      { tone: '', key: 'speechPrice', params: { price: '$0.015' } },
      { tone: 'err', key: 'voiceNoSample', params: { label: 'Me' } },
      { tone: 'warn', key: 'transcriptTip' },
      { tone: '', key: 'cloningOnly' },
      { tone: '', key: 'instructionsIgnored' },
    ]);
  });

  it('warns about music models without ZDR unless privacy is off', () => {
    expect(audioInput({}, { audioKind: 'music' })).toEqual([{ tone: 'warn', key: 'musicNoZdr' }]);
    expect(audioInput({}, { audioKind: 'music', privacy: 'off' })).toEqual([]);
    expect(audioInput({ musicModels: [] }, { audioKind: 'music' })).toEqual([{ tone: 'err', key: 'musicMissing' }]);
  });
});
