// Local stand-in for the OpenRouter endpoints darkroom uses: for trying out and testing the UI without an API key
// and without costs. Results are solid-color images, a short beep as speech and a few bytes as music.
//
//   node scripts/mock-openrouter.ts            (port 5299, or MOCK_PORT; 0 picks a free port, printed at start)
//   OPENROUTER_BASE=http://127.0.0.1:5299 OPENROUTER_API_KEY=test DARKROOM_HOME=$(mktemp -d) pnpm start
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';

const PORT = Number(process.env.MOCK_PORT ?? 5299);
const BASE = '/api/v1';

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0);
  return Buffer.concat([head, data, crc]);
}

/** Solid-color RGB PNG. */
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 bit, RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3).fill(Buffer.from(rgb))]);
  const pixels = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}

/** One second of a 440 Hz beep as 16-bit mono WAV. */
function beep(): Buffer {
  const rate = 16000;
  const pcm = Buffer.alloc(rate * 2);
  for (let i = 0; i < rate; i++) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const COLORS: [number, number, number][] = [
  [124, 108, 255],
  [61, 214, 140],
  [240, 180, 41],
  [240, 94, 94],
];
let counter = 0;

const refs = { type: 'range', min: 0, max: 8 };
/** Release dates (Unix seconds) as OpenRouter lists them; the newest is always 9 days old, so it counts as new. */
const date = (iso: string) => Date.parse(iso) / 1000;
const RECENT = Math.floor(Date.now() / 1000) - 9 * 86_400;
const MODELS = [
  {
    // A recommended model id, so the curated order shows up in the UI
    id: 'google/gemini-3.1-flash-image',
    name: 'Mock: Gemini 3.1 Flash Image',
    created: date('2026-02-26'),
    supported_parameters: {
      aspect_ratio: { type: 'enum', values: ['1:1', '3:4', '4:3', '16:9', '9:16'] },
      resolution: { type: 'enum', values: ['1K', '2K', '4K'] },
      input_references: refs,
    },
  },
  {
    id: 'mock/image',
    name: 'Mock: Image',
    created: RECENT,
    supported_parameters: {
      aspect_ratio: { type: 'enum', values: ['1:1', '3:4', '4:3', '16:9', '9:16'] },
      resolution: { type: 'enum', values: ['1K', '2K'] },
      input_references: refs,
      n: { type: 'range', min: 1, max: 4 },
    },
  },
  {
    id: 'mock/image-slow',
    name: 'Mock: Slow image (5 s)',
    created: date('2025-08-14'),
    supported_parameters: { input_references: refs },
  },
  // No release date: listed last
  { id: 'mock/image-error', name: 'Mock: Always fails', supported_parameters: { input_references: refs } },
];
const ZDR = [
  'google/gemini-3.1-flash-image',
  'mock/image',
  'mock/image-slow',
  'mock/image-error',
  'elevenlabs/eleven-v4',
  'mock/tts',
  'mock/clone',
].map((id) => ({
  model_id: id,
  tag: `${id}-zdr`,
  provider_name: 'Mock',
  safety_retention: false,
}));
const SPEECH = [
  {
    // A recommended model id (and the CLI's default speech model)
    id: 'elevenlabs/eleven-v4',
    name: 'Mock: Eleven v4',
    description: 'Speaks many languages',
    created: date('2026-05-20'),
    supported_voices: ['de-DE-Mock', 'en-US-Mock'],
    pricing: { prompt: '0.00003' },
  },
  {
    id: 'mock/tts',
    name: 'Mock TTS',
    description: 'Speaks many languages',
    created: date('2025-11-03'),
    supported_voices: ['de-DE-Mock', 'en-US-Mock'],
    pricing: { prompt: '0.000015' },
  },
  {
    id: 'mock/clone',
    name: 'Mock Voice Clone',
    description: 'Voice cloning',
    created: RECENT,
    supported_voices: [],
    pricing: { prompt: '0.00003' },
  },
];
const MUSIC = [
  { id: 'mock/lyria', name: 'Mock Lyria', description: 'Music generation', created: date('2026-03-12') },
  { id: 'mock/song', name: 'Mock Song', description: 'Music generation, $0.04 per song', created: RECENT },
];

type Reply = { status?: number; type?: string; headers?: Record<string, string>; body: string | Buffer };

const json = (body: unknown, status = 200): Reply => ({ status, type: 'application/json', body: JSON.stringify(body) });

async function images(req: { model?: string; n?: number }): Promise<Reply> {
  if (req.model === 'mock/image-error') return json({ error: { message: 'Mock provider is overloaded' } }, 503);
  if (req.model === 'mock/image-slow') await new Promise((r) => setTimeout(r, 5000));
  const data = Array.from({ length: req.n ?? 1 }, () => ({
    b64_json: png(512, 512, COLORS[counter++ % COLORS.length]).toString('base64'),
    media_type: 'image/png',
  }));
  return {
    ...json({ data, usage: { cost: 0.01 * data.length }, provider: 'Mock' }),
    headers: { 'x-generation-id': `mock-${Date.now()}` },
  };
}

function music(): Reply {
  const events = [
    {
      id: 'mock-music',
      provider: 'Mock',
      choices: [{ delta: { audio: { data: beep().toString('base64') }, content: 'Mock song' } }],
    },
    { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { cost: 0.04 } },
  ];
  return {
    type: 'text/event-stream',
    body: `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')}data: [DONE]\n\n`,
  };
}

type Handler = (body: Record<string, unknown>) => Reply | Promise<Reply>;

const GET: [RegExp, Handler][] = [
  [/^\/key$/, () => json({ data: { label: 'mock' } })], // every key is valid
  [/^\/images\/models$/, () => json({ data: MODELS })],
  [/^\/endpoints\/zdr$/, () => json({ data: ZDR })],
  [
    /^\/images\/models\/.+\/endpoints$/,
    () => json({ endpoints: [{ pricing: [{ billable: 'output_image', unit: 'image', cost_usd: 0.01 }] }] }),
  ],
  [/^\/models\?output_modalities=speech$/, () => json({ data: SPEECH })],
  [/^\/models\?output_modalities=audio$/, () => json({ data: MUSIC })],
  [/^\/models\/.+clone.*\/endpoints$/, () => json({ data: { endpoints: [{ supports_voice_cloning: true }] } })],
  [/^\/models\/.+\/endpoints$/, () => json({ data: { endpoints: [{ supports_voice_cloning: false }] } })],
  [/^\/generation\?/, () => json({ data: { total_cost: 0.001, provider_name: 'Mock' } })],
];

const POST: Record<string, Handler> = {
  '/images': images,
  '/audio/speech': () => ({ type: 'audio/wav', headers: { 'x-generation-id': `mock-${Date.now()}` }, body: beep() }),
  '/audio/transcriptions': () => json({ text: 'This is a mock transcript.', usage: { cost: 0.001 } }),
  '/chat/completions': music,
};

function handlerFor(method: string, path: string): Handler | undefined {
  return method === 'POST' ? POST[path] : GET.find(([re]) => re.test(path))?.[1];
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  const text = Buffer.concat(parts).toString();
  return text ? JSON.parse(text) : {};
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '').replace(BASE, '');
  const handler = handlerFor(method, path);
  const reply = handler ? await handler(await readJson(req)) : json({ error: { message: 'not found' } }, 404);
  const status = reply.status ?? 200;
  res.writeHead(status, { 'content-type': reply.type ?? 'application/json', ...reply.headers });
  res.end(reply.body);
  console.log(`${method} ${path} → ${status}`);
}

const server = http.createServer((req, res) => void handle(req, res));
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock OpenRouter at http://127.0.0.1:${(server.address() as AddressInfo).port}${BASE}`);
});
