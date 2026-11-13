// Local stand-in for the OpenRouter endpoints darkroom uses: for trying out and testing the UI without an API key
// and without costs. Results are solid-color images, a short beep as speech and a few bytes as music.
//
//   node scripts/mock-openrouter.ts            (port 5299, or MOCK_PORT)
//   OPENROUTER_BASE=http://127.0.0.1:5299 OPENROUTER_API_KEY=test DARKROOM_HOME=$(mktemp -d) pnpm start
import http from 'node:http';
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
const MODELS = [
  {
    id: 'mock/image',
    name: 'Mock: Image',
    supported_parameters: {
      aspect_ratio: { type: 'enum', values: ['1:1', '3:4', '4:3', '16:9', '9:16'] },
      resolution: { type: 'enum', values: ['1K', '2K'] },
      input_references: refs,
      n: { type: 'range', min: 1, max: 4 },
    },
  },
  { id: 'mock/image-slow', name: 'Mock: Slow image (5 s)', supported_parameters: { input_references: refs } },
  { id: 'mock/image-error', name: 'Mock: Always fails', supported_parameters: { input_references: refs } },
];
const ZDR = ['mock/image', 'mock/image-slow', 'mock/image-error', 'mock/tts', 'mock/clone'].map((id) => ({
  model_id: id,
  tag: `${id}-zdr`,
  provider_name: 'Mock',
  safety_retention: false,
}));
const SPEECH = [
  {
    id: 'mock/tts',
    name: 'Mock TTS',
    description: 'Speaks many languages',
    supported_voices: ['de-DE-Mock', 'en-US-Mock'],
    pricing: { prompt: '0.000015' },
  },
  {
    id: 'mock/clone',
    name: 'Mock Voice Clone',
    description: 'Voice cloning',
    supported_voices: [],
    pricing: { prompt: '0.00003' },
  },
];
const MUSIC = [{ id: 'mock/lyria', name: 'Mock Lyria', description: 'Music generation' }];

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

http
  .createServer((req, res) => void handle(req, res))
  .listen(PORT, '127.0.0.1', () => console.log(`Mock OpenRouter at http://127.0.0.1:${PORT}${BASE}`));
