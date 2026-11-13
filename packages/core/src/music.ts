// Music clips (Google Lyria) via the streaming chat completions API with audio output.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { listMusicModels } from './audio-models.ts';
import { audioEntry, finish } from './audio-run.ts';
import { apiKey, DEFAULT_PRIVACY, OUT_DIR, type PrivacyMode, REQUEST_TIMEOUT_MS } from './config.ts';
import type { RunEvent } from './contract.ts';
import { AppError, addWarning, errorFields, type WarningList } from './errors.ts';
import { slug, timestamp } from './files.ts';
import type { ManifestEntry } from './manifest.ts';
import { CallLog, callSignal, ensureOk, HttpStatusError, jsonOrText, postJson } from './upstream.ts';
import { audioType } from './wav.ts';

export interface MusicOptions {
  prompt: string;
  model: string;
  privacy?: PrivacyMode;
}

interface StreamChunk {
  error?: { message?: string };
  usage?: { cost?: unknown };
  id?: string;
  provider?: string;
  choices?: { finish_reason?: string | null; delta?: { audio?: { data?: string }; content?: unknown } }[];
}

/** What the stream delivered so far; `last` is the chunk shown in the debug log. */
interface MusicStream {
  audio: string;
  text: string;
  cost: number | null;
  generationId: string | null;
  provider: string | null;
  last: unknown;
}

/** Parsed `data:` events of a server-sent event stream. */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk> {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try {
        yield JSON.parse(line.slice(6));
      } catch {
        // incomplete or foreign line
      }
    }
  }
}

type Delta = NonNullable<NonNullable<StreamChunk['choices']>[number]['delta']>;

/** Audio and text of one chunk. */
function addDelta(s: MusicStream, delta: Delta): void {
  if (delta.audio?.data) s.audio += delta.audio.data;
  if (typeof delta.content === 'string') s.text += delta.content;
}

/** Generation ID, provider and cost; the chunk with cost or finish reason is kept for the debug log. */
function addMeta(s: MusicStream, j: StreamChunk): void {
  if (j.usage || j.choices?.[0]?.finish_reason) s.last = j;
  s.generationId ??= j.id ?? null;
  s.provider ??= j.provider ?? null;
  if (typeof j.usage?.cost === 'number') s.cost = j.usage.cost;
}

function addChunk(s: MusicStream, j: StreamChunk): void {
  if (j.error) {
    s.last = j;
    throw new Error(j.error.message ?? 'Error in stream');
  }
  addMeta(s, j);
  addDelta(s, j.choices?.[0]?.delta ?? {});
}

async function saveMusic(s: MusicStream, model: string) {
  if (!s.audio) {
    throw new AppError('no_audio_data', `No audio data received${s.text ? `: ${s.text.slice(0, 200)}` : ''}`);
  }
  const buf = Buffer.from(s.audio, 'base64');
  const { ext, mediaType } = audioType(buf);
  const file = `${timestamp()}_music_${slug(model)}.${ext}`;
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, file), buf);
  return { file, mediaType, kb: (buf.length / 1024).toFixed(0) };
}

/** Music contains no personal data: it also runs without a ZDR endpoint, with a notice. */
async function privacyNotes(model: string, privacy: PrivacyMode): Promise<WarningList> {
  const notes: WarningList = { warnings: [], notices: [] };
  const m = (await listMusicModels()).find((x) => x.id === model);
  if (privacy !== 'off' && m && !m.zdr.length) {
    addWarning(
      notes,
      'music_no_zdr',
      'No ZDR endpoint: the music prompt was sent to the provider without Zero Data Retention',
    );
  }
  return notes;
}

export async function runMusic(
  o: MusicOptions,
  onEvent: (e: RunEvent) => void = () => {},
  abort?: AbortSignal,
): Promise<ManifestEntry[]> {
  const prompt = o.prompt?.trim();
  if (!prompt) throw new AppError('prompt_missing', 'Prompt is missing');
  apiKey();
  const privacy = o.privacy ?? DEFAULT_PRIVACY;
  const runId = crypto.randomUUID();
  onEvent({ type: 'start', runId, plan: [{ model: o.model, count: 1 }] });
  const base = {
    runId,
    model: o.model,
    prompt,
    privacy,
    params: { mode: 'music' },
    ...(await privacyNotes(o.model, privacy)),
  };

  const request = {
    model: o.model,
    modalities: ['audio', 'text'],
    stream: true,
    messages: [{ role: 'user', content: prompt }],
  };
  const log = new CallLog('/chat/completions', request);
  const stream: MusicStream = { audio: '', text: '', cost: null, generationId: null, provider: null, last: null };
  try {
    // Songs can take several minutes
    const res = await postJson('/chat/completions', request, callSignal(abort, Math.max(REQUEST_TIMEOUT_MS, 600_000)));
    log.received(res);
    await ensureOk(res);
    if (res.body) for await (const chunk of sseEvents(res.body)) addChunk(stream, chunk);
    const { file, mediaType, kb } = await saveMusic(stream, o.model);
    const debugId = await log.save({
      last_chunk: stream.last,
      audio: `<${kb} KB, saved as ${file}>`,
      text: stream.text || null,
    });
    const entry = audioEntry({
      ...base,
      ok: true,
      file,
      mediaType,
      debugId,
      fullPrompt: stream.text ? `${prompt}\n\n--- Model text ---\n${stream.text}` : prompt,
      generationId: stream.generationId,
      provider: stream.provider,
      cost: stream.cost,
      callCost: stream.cost,
      durationMs: log.elapsed(),
    });
    return finish(entry, onEvent);
  } catch (err) {
    const fields = errorFields(err, abort);
    const response = err instanceof HttpStatusError ? jsonOrText(err.text) : stream.last;
    const debugId = await log.save(response, fields.error);
    return finish(audioEntry({ ...base, ...fields, debugId, durationMs: log.elapsed() }), onEvent);
  }
}
