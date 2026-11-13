import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeOpenRouter, json, sse } from '../test/fake-openrouter.ts';
import { listMusicModels, listSpeechModels } from './audio-models.ts';
import { OUT_DIR, VOICES_DIR } from './config.ts';
import type { RunEvent } from './contract.ts';
import { readEntries } from './manifest.ts';
import { runMusic } from './music.ts';
import { findDemo, runSpeech, speechDemo } from './speech.ts';
import { transcribeSample } from './transcribe.ts';
import { addSample, combinedSample, deleteSample, getVoice, listVoices, samplePath, saveVoice } from './voices.ts';

/** Mono 16-bit PCM WAV of the given length. */
function wav(seconds: number, rate = 8000, extraChunk = false): Buffer {
  const data = Buffer.alloc(Math.round(seconds * rate) * 2, 1);
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0);
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(rate, 12);
  fmt.writeUInt32LE(rate * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const list = extraChunk ? Buffer.concat([Buffer.from('LIST\x04\0\0\0INFO')]) : Buffer.alloc(0);
  const dataHead = Buffer.alloc(8);
  dataHead.write('data', 0);
  dataHead.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([fmt, list, dataHead, data]);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0);
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WAVE', 8);
  return Buffer.concat([head, body]);
}

const MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x64, 9, 9, 9, 9]);

describe('audio model catalogs', () => {
  it('lists speech models with voices, cloning flag and ZDR status', async () => {
    fakeOpenRouter();
    const models = await listSpeechModels(true);
    expect(models.map((m) => m.id)).toEqual([
      'test/clone',
      'google/test-tts',
      'test/tts',
      'test/tts-safety',
      'test/tts-open',
    ]);
    expect(models.find((m) => m.id === 'test/clone')).toMatchObject({ cloning: true, zdr: [expect.any(Object)] });
    expect(models.find((m) => m.id === 'test/tts')).toMatchObject({ voices: ['alloy', 'echo'], cloning: false });
  });

  it('lists only music models (no chat audio models)', async () => {
    fakeOpenRouter();
    expect((await listMusicModels(true)).map((m) => m.id)).toEqual(['test/lyria', 'test/lyria-zdr']);
  });
});

describe('own voices', () => {
  it('stores samples and transcripts, adopts the legacy transcript format', async () => {
    await expect(getVoice('nobody')).rejects.toMatchObject({ code: 'voice_not_found' });
    await saveVoice('me', { label: 'Me' });
    const a = await addSample('me', 'first take.wav', wav(1));
    const b = await addSample('me', 'second.mp3', MP3);
    expect(a).toMatch(/_first_take\.wav$/);
    expect(b).toMatch(/_second\.mp3$/);

    await saveVoice('me', { transcripts: { [a]: 'Hello', [b]: 'world' } });
    expect(await getVoice('me')).toMatchObject({ label: 'Me', samples: [a, b], transcript: 'Hello world' });

    await deleteSample('me', b);
    expect(await getVoice('me')).toMatchObject({ samples: [a], transcripts: { [a]: 'Hello' } });

    await fs.mkdir(path.join(VOICES_DIR, 'old'), { recursive: true });
    await fs.writeFile(path.join(VOICES_DIR, 'old', 'one.wav'), wav(0.1));
    await fs.writeFile(path.join(VOICES_DIR, 'old', 'voice.json'), '{"transcript":"legacy text"}');
    expect(await getVoice('old')).toMatchObject({ transcripts: { 'one.wav': 'legacy text' } });
    expect((await listVoices()).map((v) => v.name)).toEqual(['me', 'old']);
  });

  it.each(['../x.wav', 'a/b.wav', '.x.wav', 'notes.txt'])('rejects sample path %j', (file) => {
    expect(() => samplePath('me', file)).toThrow();
  });

  it('combines WAV samples into one clip of max. 60 s', async () => {
    await saveVoice('combo', {});
    await addSample('combo', 'a.wav', wav(2));
    await new Promise((r) => setTimeout(r, 2));
    await addSample('combo', 'b.wav', wav(1));
    const clip = await combinedSample(await getVoice('combo'));
    expect(clip).toMatchObject({ format: 'wav', used: 2 });
    // 2 s + 0.4 s pause + 1 s at 8 kHz, 16 bit, plus 44 byte header
    expect(clip.buf.length).toBe(44 + (2 + 0.4 + 1) * 8000 * 2);

    await saveVoice('long', {});
    await addSample('long', 'long.wav', wav(70));
    const long = await combinedSample(await getVoice('long'));
    expect(long.buf.length).toBe(44 + 60 * 8000 * 2);
  });

  it('sends an MP3 sample as it is', async () => {
    await saveVoice('mp3', {});
    await addSample('mp3', 'a.mp3', MP3);
    expect(await combinedSample(await getVoice('mp3'))).toEqual({ buf: MP3, format: 'mp3', used: 1 });
  });

  it('transcribes via the API with ZDR and counts the cost', async () => {
    await saveVoice('tr', {});
    const file = await addSample('tr', 'a.wav', wav(0.5));
    const api = fakeOpenRouter();
    const r = await transcribeSample('tr', file, 'api', 'de', 'zdr');
    expect(r).toMatchObject({ text: 'Hello world.', engine: 'api', cost: 0.001 });
    expect(api.callsTo('/audio/transcriptions')[0].body).toMatchObject({
      language: 'de',
      input_audio: { format: 'wav' },
      provider: { only: ['whisper-provider'], allow_fallbacks: false },
    });
    expect((await getVoice('tr')).transcripts[file]).toBe('Hello world.');
    expect((await readEntries()).at(-1)).toMatchObject({
      tool: 'transcribe',
      demo: true,
      cost: 0.001,
      providerRestriction: ['whisper-provider'],
    });

    fakeOpenRouter({ transcription: () => json({ error: { message: 'bad audio' } }, { status: 400 }) });
    await expect(transcribeSample('tr', file, 'api', 'auto', 'off')).rejects.toThrow('HTTP 400: bad audio');
  });

  it('sends no provider restriction for API transcription without privacy', async () => {
    await saveVoice('tr-off', {});
    const file = await addSample('tr-off', 'a.wav', wav(0.5));
    const api = fakeOpenRouter();
    await transcribeSample('tr-off', file, 'api', 'auto', 'off');
    expect(api.callsTo('/audio/transcriptions')[0].body).not.toHaveProperty('provider');
    expect((await readEntries()).at(-1)).toMatchObject({ tool: 'transcribe', providerRestriction: null });
  });

  it('blocks API transcription when the privacy mode allows no endpoint', async () => {
    await saveVoice('tr-strict', {});
    const file = await addSample('tr-strict', 'a.wav', wav(0.5));
    const api = fakeOpenRouter();
    // The transcription model only has a ZDR endpoint with safety retention
    await expect(transcribeSample('tr-strict', file, 'api', 'de', 'zdr-strict')).rejects.toMatchObject({
      code: 'privacy_blocked_strict',
    });
    expect(api.callsTo('/audio/transcriptions')).toHaveLength(0);
    expect((await getVoice('tr-strict')).transcripts[file]).toBeUndefined();
  });
});

describe('runSpeech', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('speaks with a model voice and fetches the cost later', async () => {
    const api = fakeOpenRouter();
    const events: RunEvent['type'][] = [];
    const [entry] = await runSpeech(
      { text: ' Hello ', model: 'test/tts', voice: 'alloy', instructions: 'calm', speed: 1.1 },
      (e) => events.push(e.type),
    );
    expect(events).toEqual(['start', 'image', 'done']);
    expect(api.callsTo('/audio/speech')[0].body).toEqual({
      model: 'test/tts',
      input: 'Hello',
      voice: 'alloy',
      instructions: 'calm',
      speed: 1.1,
      provider: { only: ['tts-provider'], allow_fallbacks: false },
      response_format: 'mp3',
    });
    expect(entry).toMatchObject({
      ok: true,
      kind: 'audio',
      voice: 'alloy',
      mediaType: 'audio/mpeg',
      fullPrompt: '[calm] Hello',
      params: { instructions: 'calm', speed: 1.1, format: 'mp3' },
      generationId: 'gen-tts',
      providerRestriction: ['tts-provider'],
    });
    expect(entry.file).toMatch(/_tts_test_tts\.mp3$/);

    await vi.advanceTimersByTimeAsync(2600);
    await vi.waitFor(async () => {
      expect((await readEntries()).find((e) => e.id === entry.id)).toMatchObject({ cost: 0.002, provider: 'VoiceCo' });
    });
  });

  it('blocks models without ZDR', async () => {
    const api = fakeOpenRouter();
    const [entry] = await runSpeech({ text: 'Hi', model: 'test/tts-open', voice: 'x' });
    expect(entry).toMatchObject({ ok: false, errorCode: 'privacy_blocked' });
    expect(api.callsTo('/audio/speech')).toHaveLength(0);
  });

  it('restricts speech to the ZDR endpoints the privacy mode allows', async () => {
    const api = fakeOpenRouter();
    const [relaxed] = await runSpeech({ text: 'Hi', model: 'test/tts-safety', voice: 'y', privacy: 'zdr' });
    expect(relaxed).toMatchObject({ ok: true, providerRestriction: ['tts-safety-provider'] });
    expect(api.callsTo('/audio/speech')[0].body).toMatchObject({
      provider: { only: ['tts-safety-provider'], allow_fallbacks: false },
    });

    const [strict] = await runSpeech({ text: 'Hi', model: 'test/tts', voice: 'alloy', privacy: 'zdr-strict' });
    expect(strict).toMatchObject({ ok: true, providerRestriction: ['tts-provider'] });
    expect(api.callsTo('/audio/speech')[1].body).toMatchObject({
      provider: { only: ['tts-provider'], allow_fallbacks: false },
    });

    // Only an endpoint with safety retention: blocked in strict mode, no call
    const [blocked] = await runSpeech({ text: 'Hi', model: 'test/tts-safety', voice: 'y', privacy: 'zdr-strict' });
    expect(blocked).toMatchObject({ ok: false, errorCode: 'privacy_blocked_strict' });
    expect(api.callsTo('/audio/speech')).toHaveLength(2);

    const [off] = await runSpeech({ text: 'Hi', model: 'test/tts-open', voice: 'x', privacy: 'off' });
    expect(off).toMatchObject({ ok: true, providerRestriction: null });
    expect(api.callsTo('/audio/speech')[2].body).not.toHaveProperty('provider');
  });

  it('restricts voice cloning like model voices in strict mode', async () => {
    await saveVoice('strict-clone', {});
    await addSample('strict-clone', 'a.wav', wav(1));
    const api = fakeOpenRouter();
    const [entry] = await runSpeech({
      text: 'Hi',
      model: 'test/clone',
      voice: 'voice:strict-clone',
      privacy: 'zdr-strict',
    });
    expect(entry).toMatchObject({ ok: true, providerRestriction: ['clone-provider'] });
    expect(api.callsTo('/audio/speech')[0].body).toMatchObject({
      provider: { only: ['clone-provider'], allow_fallbacks: false },
    });
  });

  it('clones an own voice with one combined clip plus transcript', async () => {
    await saveVoice('clone-me', {});
    const file = await addSample('clone-me', 'a.wav', wav(1));
    await saveVoice('clone-me', { transcripts: { [file]: 'This is me.' } });
    const api = fakeOpenRouter();

    const [entry] = await runSpeech({ text: 'Hi', model: 'test/clone', voice: 'voice:clone-me' });
    const body = api.callsTo('/audio/speech')[0].body as { input_references: { type: string }[]; voice?: string };
    expect(body.voice).toBeUndefined();
    expect(body.input_references.map((r) => r.type)).toEqual(['input_audio', 'text']);
    expect(entry).toMatchObject({ ok: true, voice: 'voice:clone-me', refCount: 1, notices: [] });

    const [flagged] = await runSpeech({ text: 'Hi', model: 'test/tts', voice: 'voice:clone-me' });
    expect(flagged.notices).toEqual([{ code: 'clone_not_flagged' }]);

    await saveVoice('empty', {});
    const [empty] = await runSpeech({ text: 'Hi', model: 'test/clone', voice: 'voice:empty' });
    expect(empty).toMatchObject({ ok: false, errorCode: 'no_voice_sample' });
  });

  it('retries with the other format and wraps PCM in WAV', async () => {
    let n = 0;
    const api = fakeOpenRouter({
      speech: () =>
        ++n === 1
          ? json({ error: { message: 'response_format mp3 not supported' } }, { status: 400 })
          : new Response(Buffer.alloc(480), { headers: { 'content-type': 'audio/pcm;rate=24000' } }),
    });
    const [entry] = await runSpeech({ text: 'Hi', model: 'test/tts', voice: 'echo' });
    expect(api.callsTo('/audio/speech').map((c) => (c.body as { response_format: string }).response_format)).toEqual([
      'mp3',
      'pcm',
    ]);
    expect(entry).toMatchObject({ ok: true, mediaType: 'audio/wav', params: { format: 'pcm' } });
    const saved = await fs.readFile(path.join(OUT_DIR, entry.file as string));
    expect(saved.subarray(0, 4).toString()).toBe('RIFF');
    expect(saved.readUInt32LE(24)).toBe(24000);
  });

  it('asks PCM-only providers for PCM directly', async () => {
    const api = fakeOpenRouter({ speech: () => new Response(Buffer.alloc(100)) });
    await runSpeech({ text: 'Hi', model: 'google/test-tts', voice: 'Kore', privacy: 'off' });
    expect(api.callsTo('/audio/speech')[0].body).toMatchObject({ response_format: 'pcm' });
  });

  it('records upstream errors with a debug record', async () => {
    fakeOpenRouter({ speech: () => json({ error: { message: 'voice unknown' } }, { status: 422 }) });
    const [entry] = await runSpeech({ text: 'Hi', model: 'test/tts', voice: 'nope' });
    expect(entry).toMatchObject({ ok: false, error: 'HTTP 422: voice unknown', debugId: expect.any(String) });
  });

  it('caches voice previews under out/demos/', async () => {
    fakeOpenRouter();
    expect(await findDemo('test/tts', 'alloy')).toBeNull();
    const [entry] = await runSpeech({ text: 'Hi', model: 'test/tts', voice: 'alloy', demo: true });
    expect(entry).toMatchObject({ demo: true, file: 'demos/test_tts__alloy.mp3' });
    expect(await findDemo('test/tts', 'alloy')).toBe('demos/test_tts__alloy.mp3');
  });

  it('requires a text', async () => {
    await expect(runSpeech({ text: ' ', model: 'test/tts' })).rejects.toMatchObject({ code: 'text_missing' });
  });
});

describe('runMusic', () => {
  it('collects the streamed audio, model text and cost', async () => {
    const api = fakeOpenRouter();
    const [entry] = await runMusic({ prompt: 'calm guitar', model: 'test/lyria' });
    expect(api.callsTo('/chat/completions')[0].body).toMatchObject({ modalities: ['audio', 'text'], stream: true });
    expect(api.callsTo('/chat/completions')[0].body).not.toHaveProperty('provider');
    expect(entry).toMatchObject({
      ok: true,
      cost: 0.04,
      generationId: 'gen-music',
      provider: 'Google',
      mediaType: 'audio/mpeg',
      fullPrompt: 'calm guitar\n\n--- Model text ---\nVerse 1',
      notices: [{ code: 'music_no_zdr' }],
      providerRestriction: null,
    });
    const saved = await fs.readFile(path.join(OUT_DIR, entry.file as string), 'utf8');
    expect(saved).toBe('ID3-part1-part2');
  });

  it('restricts music to the ZDR endpoints when the model has one', async () => {
    const api = fakeOpenRouter();
    for (const privacy of ['zdr', 'zdr-strict'] as const) {
      const [entry] = await runMusic({ prompt: 'calm guitar', model: 'test/lyria-zdr', privacy });
      expect(entry).toMatchObject({ ok: true, notices: [], providerRestriction: ['lyria-provider'] });
    }
    for (const call of api.callsTo('/chat/completions')) {
      expect(call.body).toMatchObject({ provider: { only: ['lyria-provider'], allow_fallbacks: false } });
    }
  });

  it('reports stream errors, missing audio and HTTP errors', async () => {
    fakeOpenRouter({ music: () => sse([{ error: { message: 'quota exceeded' } }]) });
    expect((await runMusic({ prompt: 'x', model: 'test/lyria' }))[0]).toMatchObject({ error: 'quota exceeded' });

    fakeOpenRouter({ music: () => sse([{ choices: [{ delta: { content: 'I cannot do that' } }] }]) });
    expect((await runMusic({ prompt: 'x', model: 'test/lyria' }))[0]).toMatchObject({
      errorCode: 'no_audio_data',
      error: 'No audio data received: I cannot do that',
    });

    fakeOpenRouter({ music: () => json({ error: { message: 'model offline' } }, { status: 503 }) });
    expect((await runMusic({ prompt: 'x', model: 'test/lyria', privacy: 'off' }))[0]).toMatchObject({
      error: 'HTTP 503: model offline',
      notices: [],
    });
  });
});

describe('speechDemo', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('caches previews of model voices and reports failures with their code', async () => {
    const api = fakeOpenRouter();
    expect(await speechDemo({ model: 'test/tts', voice: 'echo', text: 'Hi' })).toEqual({
      file: 'demos/test_tts__echo.mp3',
      cached: false,
    });
    expect(await speechDemo({ model: 'test/tts', voice: 'echo', text: 'Hi' })).toMatchObject({ cached: true });
    expect(await speechDemo({ model: 'test/tts', voice: 'echo', text: 'Hi', regenerate: true })).toMatchObject({
      cached: false,
    });
    expect(api.callsTo('/audio/speech')).toHaveLength(2);

    await expect(speechDemo({ model: 'test/tts-open', voice: 'x', text: 'Hi' })).rejects.toMatchObject({
      code: 'privacy_blocked',
    });
  });
});
