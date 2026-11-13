// In-process fake of the OpenRouter endpoints darkroom uses (replaces global fetch for one test).
import sharp from 'sharp';
import { vi } from 'vitest';
import type { ImageModel } from '../src/contract.ts';

const BASE = 'http://openrouter.test/api/v1';

/** Catalog used by the tests: one model per privacy situation. */
export const MODELS: ImageModel[] = [
  {
    id: 'test/zdr',
    name: 'Test: ZDR',
    supported_parameters: {
      aspect_ratio: { type: 'enum', values: ['1:1', '3:4', '16:9'] },
      resolution: { type: 'enum', values: ['1K', '2K'] },
      output_format: { type: 'enum', values: ['png', 'jpeg'] },
      input_references: { type: 'range', min: 0, max: 3 },
      n: { type: 'range', min: 1, max: 1 },
      seed: { type: 'boolean' },
    },
  },
  {
    id: 'test/safety',
    name: 'Test: ZDR with safety retention',
    supported_parameters: { input_references: { type: 'range', min: 0, max: 8 }, n: { type: 'range', min: 1, max: 4 } },
  },
  { id: 'test/open', name: 'Test: no ZDR', supported_parameters: {} },
];

const ZDR = [
  { model_id: 'test/zdr', tag: 'zdr-provider', provider_name: 'ZdrCo', safety_retention: false },
  { model_id: 'test/safety', tag: 'safety-provider', provider_name: 'SafeCo', safety_retention: true },
  { model_id: 'test/tts', tag: 'tts-provider', provider_name: 'VoiceCo', safety_retention: false },
  { model_id: 'test/clone', tag: 'clone-provider', provider_name: 'CloneCo', safety_retention: false },
  { model_id: 'test/tts-safety', tag: 'tts-safety-provider', provider_name: 'SafeVoice', safety_retention: true },
  { model_id: 'test/lyria-zdr', tag: 'lyria-provider', provider_name: 'Google', safety_retention: false },
  // Default transcription model (TRANSCRIBE_MODEL): only an endpoint with safety retention
  {
    model_id: 'openai/whisper-large-v3-turbo',
    tag: 'whisper-provider',
    provider_name: 'WhisperCo',
    safety_retention: true,
  },
];

/** Speech and music models (OpenRouter /models with output modalities). */
const SPEECH_MODELS = [
  { id: 'test/tts', name: 'Test TTS', description: 'Speaks many languages', supported_voices: ['alloy', 'echo'] },
  { id: 'test/clone', name: 'Test Clone', description: 'Voice cloning', supported_voices: [] },
  { id: 'google/test-tts', name: 'Test PCM TTS', supported_voices: ['Kore'] },
  { id: 'test/tts-open', name: 'Test TTS without ZDR', supported_voices: ['x'] },
  { id: 'test/tts-safety', name: 'Test TTS with safety retention', supported_voices: ['y'] },
];
const MUSIC_MODELS = [
  { id: 'test/lyria', name: 'Test Lyria', description: 'Music generation' },
  { id: 'test/lyria-zdr', name: 'Test Lyria with ZDR', description: 'Music generation' },
  { id: 'openai/gpt-audio', name: 'GPT Audio', description: 'music and chat' },
];

/** Server-sent events as streamed by /chat/completions. */
export function sse(events: unknown[]): Response {
  const text = `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(text, { headers: { 'content-type': 'text/event-stream' } });
}

interface Call {
  path: string;
  method: string;
  body: unknown;
  signal?: AbortSignal | null;
}

type Handler = (body: Record<string, unknown>, init: RequestInit | undefined) => Response | Promise<Response>;

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

/** Small solid-color test image. */
export function testImage(
  opts: { width?: number; height?: number; alpha?: boolean; format?: 'png' | 'jpeg' } = {},
): Promise<Buffer> {
  const { width = 16, height = 16, alpha = false, format = 'png' } = opts;
  const img = sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 200, g: 30, b: 30, alpha: 0.5 } : { r: 200, g: 30, b: 30 },
    },
  });
  return (format === 'png' ? img.png() : img.jpeg()).toBuffer();
}

/** Default /images handler: one PNG per requested image, $0.04 per call. */
const imageOk: Handler = async (body) => {
  const b64 = (await testImage()).toString('base64');
  const n = typeof body.n === 'number' ? body.n : 1;
  return json(
    {
      data: Array.from({ length: n }, () => ({ b64_json: b64, media_type: 'image/png' })),
      usage: { cost: 0.04 },
      provider: 'ZdrCo',
    },
    { headers: { 'x-generation-id': 'gen-123' } },
  );
};

/** Default /audio/speech handler: a few bytes of "MP3". */
const speechOk: Handler = () =>
  new Response(Buffer.from([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4]), {
    headers: { 'content-type': 'audio/mpeg', 'x-generation-id': 'gen-tts' },
  });

/** Default /chat/completions handler: a music stream in two audio chunks with cost. */
const musicOk: Handler = () =>
  sse([
    {
      id: 'gen-music',
      provider: 'Google',
      choices: [{ delta: { audio: { data: Buffer.from('ID3-part1').toString('base64') } } }],
    },
    { choices: [{ delta: { content: 'Verse 1' } }] },
    {
      choices: [{ delta: { audio: { data: Buffer.from('-part2').toString('base64') } }, finish_reason: 'stop' }],
      usage: { cost: 0.04 },
    },
  ]);

interface FakeOptions {
  images?: Handler;
  speech?: Handler;
  music?: Handler;
  transcription?: Handler;
  /** GET /key: checks the API key */
  key?: Response;
  models?: ImageModel[];
}

const transcriptionOk: Handler = () => json({ text: ' Hello world. ', usage: { cost: 0.001 } });

/** Routes of the fake: exact paths or patterns, with a fixed response or a handler. */
function routes(opts: FakeOptions): [string | RegExp, () => Handler | Response][] {
  return [
    ['/key', () => opts.key ?? json({ data: { label: 'test' } })],
    ['/images/models', () => json({ data: opts.models ?? MODELS })],
    ['/endpoints/zdr', () => json({ data: ZDR })],
    [/^\/images\/models\/.+\/endpoints$/, () => json({ endpoints: [] })],
    ['/models?output_modalities=speech', () => json({ data: SPEECH_MODELS })],
    ['/models?output_modalities=audio', () => json({ data: MUSIC_MODELS })],
    [/^\/models\/.+clone.*\/endpoints$/, () => json({ data: { endpoints: [{ supports_voice_cloning: true }] } })],
    [/^\/models\/.+\/endpoints$/, () => json({ data: { endpoints: [{ supports_voice_cloning: false }] } })],
    [/^\/generation\?/, () => json({ data: { total_cost: 0.002, provider_name: 'VoiceCo' } })],
    ['/images', () => opts.images ?? imageOk],
    ['/audio/speech', () => opts.speech ?? speechOk],
    ['/chat/completions', () => opts.music ?? musicOk],
    ['/audio/transcriptions', () => opts.transcription ?? transcriptionOk],
  ];
}

function route(path: string, opts: FakeOptions): Handler | Response {
  const hit = routes(opts).find(([p]) => (typeof p === 'string' ? p === path : p.test(path)));
  return hit ? hit[1]() : json({ error: { message: 'not found' } }, { status: 404 });
}

/** Replace global fetch with the fake. Requests to any other host fail the test. */
export function fakeOpenRouter(opts: FakeOptions = {}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(BASE)) throw new Error(`Unexpected request to ${url}`);
    const path = url.slice(BASE.length);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method: init?.method ?? 'GET', body, signal: init?.signal });
    const r = route(path, opts);
    return r instanceof Response ? r : r(body ?? {}, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    /** Calls to the image endpoint only. */
    imageCalls: () => calls.filter((c) => c.path === '/images'),
    /** Calls to one endpoint. */
    callsTo: (path: string) => calls.filter((c) => c.path === path),
  };
}
