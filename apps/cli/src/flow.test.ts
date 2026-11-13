import type { MusicModelInfo, SpeechModelInfo, VoiceInfo } from '@darkroom/core/contract';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogImageModel } from './choices.ts';
import {
  askImage,
  askMusic,
  askSpeech,
  BACK,
  type ImageAsk,
  type MusicAsk,
  mainMenu,
  type Prompter,
  type SpeechAsk,
  session,
} from './flow.ts';

type Call = { kind: string; message: string; initial?: unknown; options?: unknown[] };
/** An answer: a value, BACK, or a function of the prompt (e.g. to take its initial value). */
type Answer = unknown | ((o: { initialValue?: unknown; initialValues?: unknown }) => unknown);
const KEEP = (o: { initialValue?: unknown; initialValues?: unknown }) => o.initialValue ?? o.initialValues;

/** A prompter that answers from a script and records what it was asked. */
function scripted(answers: Answer[]) {
  const calls: Call[] = [];
  const notes: string[][] = [];
  const infos: string[] = [];
  const next = (kind: string) => async (o: Record<string, unknown> & { message: string }) => {
    calls.push({
      kind,
      message: o.message,
      initial: o.initialValue ?? o.initialValues,
      options: (o.options as { value: unknown }[] | undefined)?.map((c) => c.value),
    });
    if (!answers.length) throw new Error(`No answer left for ${kind} "${o.message}"`);
    const a = answers.shift();
    return typeof a === 'function' ? a(o) : a;
  };
  const ui = {
    select: next('select'),
    search: next('search'),
    searchMany: next('searchMany'),
    text: next('text'),
    confirm: next('confirm'),
    note: (lines: string[]) => notes.push(lines),
    info: (m: string) => infos.push(m),
  } as unknown as Prompter;
  return { ui, calls, notes, infos, left: answers };
}

const zdr = [{ tag: 'p/zdr', provider: 'P', safetyRetention: false }];
const marks = { favorite: false, recommended: false };
const image = (id: string, extra: Partial<CatalogImageModel> = {}): CatalogImageModel => ({
  id,
  name: id,
  supported_parameters: {
    input_references: { type: 'range', min: 0, max: 4 },
    aspect_ratio: { type: 'enum', values: ['1:1', '3:4'] },
    resolution: { type: 'enum', values: ['1K', '2K'] },
  },
  zdr,
  price: { cost: 0.04, unit: 'image', variants: {} },
  ...marks,
  ...extra,
});

function imageAsk(over: Partial<ImageAsk> = {}): ImageAsk {
  return {
    fixed: {},
    initial: {},
    privacy: 'zdr',
    defaultModel: 'a/one',
    models: async () => [image('a/one'), image('b/two'), image('c/open', { zdr: [] })],
    elements: [],
    estimate: (r) => `${r.count * r.models.length} images`,
    ...over,
  };
}

describe('question steps', () => {
  it('returns false when the user goes back from the first question', async () => {
    const { ui } = scripted([BACK]);
    expect(await askMusic(ui, musicAsk())).toBe(BACK);
  });
});

function musicAsk(over: Partial<MusicAsk> = {}): MusicAsk {
  const models: MusicModelInfo[] = [
    { id: 'g/lyria', name: 'Lyria', description: '', zdr: [], ...marks },
    { id: 'g/lyria-pro', name: 'Lyria Pro', description: '', zdr: [], ...marks },
  ];
  return {
    fixed: {},
    initial: {},
    privacy: 'off',
    defaultModel: 'g/lyria',
    models: async () => models,
    estimate: () => 'unknown',
    ...over,
  };
}

describe('image questions', () => {
  it('asks everything in order and returns the run', async () => {
    const { ui, calls, notes } = scripted([KEEP, ['b/two'], '3:4', '', 2, 'a cat', true]);
    const run = await askImage(ui, imageAsk());
    expect(run).toEqual({
      privacy: 'zdr',
      models: ['b/two'],
      element: null,
      aspect: '3:4',
      size: undefined,
      count: 2,
      prompt: 'a cat',
    });
    expect(calls.map((c) => c.message)).toEqual([
      'Privacy',
      'Models',
      'Aspect ratio',
      'Size',
      'Images per model',
      'Prompt (@name includes an element)',
      'Generate now?',
    ]);
    // Only models allowed by the privacy mode are offered, the default model is preselected
    expect(calls[1].options).toEqual(['a/one', 'b/two']);
    expect(calls[1].initial).toEqual(['a/one']);
    expect(notes[0].join('\n')).toContain('2 images');
  });

  it('does not ask what the command line gave', async () => {
    const { ui, calls } = scripted(['a dog', true]);
    const run = await askImage(
      ui,
      imageAsk({ fixed: { privacy: 'off', models: ['c/open'], aspect: '1:1', size: '2K', count: 3, seed: 7 } }),
    );
    expect(calls.map((c) => c.message)).toEqual(['Prompt (@name includes an element)', 'Generate now?']);
    expect(run).toMatchObject({ privacy: 'off', models: ['c/open'], aspect: '1:1', size: '2K', count: 3, seed: 7 });
  });

  it('goes back one question on Escape and when the summary is declined', async () => {
    const { ui, calls } = scripted([KEEP, KEEP, BACK, KEEP, KEEP, KEEP, KEEP, 'x', false, 'y', true]);
    const run = await askImage(ui, imageAsk());
    expect(calls.map((c) => c.message.split(' ')[0])).toEqual([
      'Privacy',
      'Models',
      'Aspect',
      'Models',
      'Aspect',
      'Size',
      'Images',
      'Prompt',
      'Generate',
      'Prompt',
      'Generate',
    ]);
    expect(run).toMatchObject({ prompt: 'y' });
  });

  it('pre-fills previous answers and offers elements unless the prompt mentions one', async () => {
    const elements = [{ name: 'me', label: 'Me', type: 'person' as const, instructions: '', photos: ['a.jpg'] }];
    const { ui, calls } = scripted([KEEP, KEEP, 'me', KEEP, KEEP, KEEP, KEEP, true]);
    const run = await askImage(
      ui,
      imageAsk({ elements, initial: { models: ['b/two', 'gone/model'], size: '2K', count: 4, prompt: 'again' } }),
    );
    expect(calls[1].initial).toEqual(['b/two']);
    expect(run).toMatchObject({ element: 'me', size: '2K', count: 4, prompt: 'again' });

    const second = scripted([KEEP, KEEP, KEEP, KEEP, KEEP, true]);
    await askImage(second.ui, imageAsk({ elements, fixed: { prompt: 'photo of @me' } }));
    expect(second.calls.map((c) => c.message)).not.toContain('Element (or use @name in the prompt)');
  });

  it('sends the user back to the privacy mode when it allows no model', async () => {
    const { ui, calls, infos } = scripted(['zdr-strict', 'off', ['c/open'], KEEP, KEEP, KEEP, 'p', true]);
    const models = async () => [
      image('a/one', { zdr: [{ tag: 't', provider: 'P', safetyRetention: true }] }),
      image('c/open', { zdr: [] }),
    ];
    const run = await askImage(ui, imageAsk({ models, privacy: 'zdr' }));
    expect(infos[0]).toContain('zdr-strict');
    expect(calls.slice(0, 2).map((c) => c.message)).toEqual(['Privacy', 'Privacy']);
    expect(run).toMatchObject({ privacy: 'off', models: ['c/open'] });
  });
});

const speechModels: SpeechModelInfo[] = [
  {
    id: 'google/tts',
    name: 'Gemini TTS',
    description: '',
    pricing: { prompt: '0.00001' },
    voices: ['Kore', 'de-DE-Anna', 'en-US-Ben'],
    cloning: false,
    multiRef: false,
    zdr,
    ...marks,
  },
  {
    id: 'x/clone',
    name: 'Clone',
    description: '',
    pricing: {},
    voices: [],
    cloning: true,
    multiRef: false,
    zdr,
    ...marks,
  },
  {
    id: 'x/plain',
    name: 'Plain',
    description: '',
    pricing: {},
    voices: [],
    cloning: false,
    multiRef: false,
    zdr,
    ...marks,
  },
];
const ownVoices: VoiceInfo[] = [{ name: 'me', label: 'Me', transcript: '', transcripts: {}, samples: ['a.wav'] }];

function speechAsk(over: Partial<SpeechAsk> = {}): SpeechAsk {
  return {
    fixed: {},
    initial: {},
    privacy: 'zdr',
    defaultModel: 'google/tts',
    models: async () => speechModels,
    ownVoices,
    estimate: () => '≈ $0.0001',
    ...over,
  };
}

describe('speech questions', () => {
  it('asks voice, instructions and speed where the model supports them', async () => {
    const { ui, calls } = scripted([KEEP, KEEP, 'en-US-Ben', 'Hello', 'calm', 1.1, true]);
    const run = await askSpeech(ui, speechAsk());
    expect(calls.map((c) => c.message)).toEqual([
      'Privacy',
      'Speech model',
      'Voice',
      'Text',
      'Delivery instructions (optional)',
      'Speed',
      'Speak now?',
    ]);
    // German first, then multilingual, then English (as in the web UI)
    expect(calls[2].options).toEqual(['de-DE-Anna', 'Kore', 'en-US-Ben']);
    expect(run).toEqual({
      privacy: 'zdr',
      model: 'google/tts',
      voice: 'en-US-Ben',
      text: 'Hello',
      instructions: 'calm',
      speed: 1.1,
    });
  });

  it('offers own voices for cloning models and keeps the pre-filled answers', async () => {
    const { ui, calls } = scripted([KEEP, 'x/clone', 'voice:me', KEEP, KEEP, true]);
    const run = await askSpeech(ui, speechAsk({ initial: { text: 'Hi', speed: 0.9 } }));
    expect(calls[2].options).toEqual(['', 'voice:me']);
    const again = scripted([KEEP, KEEP, KEEP, KEEP, KEEP, KEEP, true]);
    await askSpeech(again.ui, speechAsk({ initial: { voice: 'en-US-Ben', text: 'Hi' } }));
    expect(again.calls[2].initial).toBe('en-US-Ben');
    expect(calls[4].initial).toBe(0.9);
    expect(run).toMatchObject({ model: 'x/clone', voice: 'voice:me', text: 'Hi', speed: 0.9 });
  });

  it('skips the voice when there is nothing to choose and what the command line gave', async () => {
    const { ui, calls } = scripted(['Hi', 1, true]);
    const run = await askSpeech(
      ui,
      speechAsk({ fixed: { model: 'x/plain', privacy: 'off' }, initial: { voice: 'old' } }),
    );
    expect(calls.map((c) => c.message)).toEqual(['Text', 'Speed', 'Speak now?']);
    expect(run).toMatchObject({ model: 'x/plain', voice: undefined, speed: undefined });
  });

  it('goes back when the privacy mode allows no speech model', async () => {
    const { ui, infos } = scripted([BACK]);
    const run = await askSpeech(
      ui,
      speechAsk({ fixed: { privacy: 'zdr' }, models: async () => [{ ...speechModels[2], zdr: [] }] }),
    );
    expect(run).toBe(BACK);
    expect(infos[0]).toContain('No speech model');
  });
});

describe('music questions', () => {
  it('asks privacy, model and prompt', async () => {
    const { ui, calls } = scripted(['off', 'g/lyria-pro', 'jingle', true]);
    expect(await askMusic(ui, musicAsk())).toEqual({ privacy: 'off', model: 'g/lyria-pro', prompt: 'jingle' });
    expect(calls.map((c) => c.kind)).toEqual(['select', 'select', 'text', 'confirm']);
  });

  it('takes the only model without asking and explains a blocked privacy mode', async () => {
    const one = async () => [{ id: 'g/lyria', name: 'Lyria', description: '', zdr, ...marks }];
    const a = scripted([KEEP, 'song', true]);
    expect(await askMusic(a.ui, musicAsk({ models: one }))).toMatchObject({ model: 'g/lyria' });

    const b = scripted(['zdr', 'off', KEEP, 'song', true]);
    expect(await askMusic(b.ui, musicAsk())).toMatchObject({ privacy: 'off' });
    expect(b.infos[0]).toContain('Choose "off"');
  });
});

describe('session', () => {
  it('runs, opens, runs again, changes settings and returns to the menu', async () => {
    const ask = vi.fn(async (previous?: string) => (previous ? `${previous}+` : 'first'));
    const run = vi.fn(async (r: string) => [`/out/${r}.png`]);
    const open = vi.fn();
    const { ui, calls } = scripted(['open', 'again', 'change', 'menu']);
    expect(await session(ui, { ask, run }, open)).toBe('menu');
    expect(open).toHaveBeenCalledWith(['/out/first.png']);
    expect(run.mock.calls.map((c) => c[0])).toEqual(['first', 'first', 'first+']);
    expect(calls[0].options).toEqual(['open', 'again', 'change', 'menu', 'quit']);
  });

  it('keeps the run when changing settings is abandoned, and offers no opener without files', async () => {
    const ask = vi.fn(async (previous?: string) => (previous ? BACK : 'first'));
    const run = vi.fn(async () => []);
    const { ui, calls } = scripted(['change', 'quit']);
    expect(await session(ui, { ask, run }, vi.fn())).toBe('quit');
    expect(run).toHaveBeenCalledTimes(1);
    expect(calls[0].options).not.toContain('open');
  });

  it('adds the models of the run to the favorites when the mode offers it', async () => {
    const favorite = vi.fn(async (r: string) => `Added ${r}`);
    const { ui, calls, infos } = scripted(['favorite', 'quit']);
    expect(await session(ui, { ask: async () => 'first', run: async () => [], favorite })).toBe('quit');
    expect(calls[0].options).toEqual(['again', 'change', 'favorite', 'menu', 'quit']);
    expect(favorite).toHaveBeenCalledWith('first');
    expect(infos).toEqual(['Added first']);
  });

  it('returns BACK when the first question is left', async () => {
    const { ui } = scripted([]);
    expect(await session(ui, { ask: async () => BACK, run: async () => [] })).toBe(BACK);
  });
});

describe('main menu', () => {
  it('runs actions until quit and remembers the last item', async () => {
    const actions = {
      image: vi.fn(async () => 'menu' as const),
      speech: vi.fn(async () => undefined),
      music: vi.fn(async () => 'quit' as const),
      models: vi.fn(),
      library: vi.fn(),
      costs: vi.fn(),
      web: vi.fn(),
    };
    const { ui, calls } = scripted(['image', 'speech', 'music']);
    await mainMenu(ui, actions);
    expect(actions.image).toHaveBeenCalledOnce();
    expect(actions.music).toHaveBeenCalledOnce();
    expect(calls.map((c) => c.initial)).toEqual(['image', 'image', 'speech']);

    const quit = scripted([BACK]);
    await mainMenu(quit.ui, actions);
    const byItem = scripted(['quit']);
    await mainMenu(byItem.ui, actions);
    expect(byItem.left).toEqual([]);
  });
});
