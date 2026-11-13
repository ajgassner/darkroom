// Music clips (Google Lyria) via the streaming chat completions API with audio output.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { apiKey, DEFAULT_PRIVACY, OUT_DIR, type PrivacyMode, REQUEST_TIMEOUT_MS } from '../config.ts';
import type { RunEvent } from '../contract.ts';
import { AppError, addWarning, errorFields, unknownModel, type WarningList } from '../errors.ts';
import { listMusicModels } from '../openrouter/audio-models.ts';
import { modelRestriction, providerField } from '../openrouter/privacy.ts';
import { CallLog, callSignal, ensureOk, HttpStatusError, jsonOrText, postJson } from '../openrouter/upstream.ts';
import { runStamp, slug } from '../storage/files.ts';
import type { ManifestEntry } from '../storage/manifest.ts';
import { audioEntry, finish } from './audio-run.ts';
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

async function saveMusic(s: MusicStream, model: string, runId: string) {
  if (!s.audio) {
    throw new AppError('no_audio_data', `No audio data received${s.text ? `: ${s.text.slice(0, 200)}` : ''}`);
  }
  const buf = Buffer.from(s.audio, 'base64');
  const { ext, mediaType } = audioType(buf);
  const file = `${runStamp(runId)}_music_${slug(model)}.${ext}`;
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, file), buf, { flag: 'wx' });
  return { file, mediaType, kb: (buf.length / 1024).toFixed(0) };
}

/**
 * Music contains no personal data, so it never fails for privacy reasons: the call is pinned to the ZDR endpoints
 * the mode allows. In zdr-strict mode a model whose ZDR endpoints all have safety retention still uses those (with a
 * notice) rather than none at all; only without any ZDR endpoint does it run unrestricted, with a notice.
 */
async function musicPrivacy(model: string, privacy: PrivacyMode) {
  const notes: WarningList = { warnings: [], notices: [] };
  if (privacy === 'off') return { notes, restriction: null };
  const allowed = (await modelRestriction(model, privacy)) ?? [];
  if (allowed.length) return { notes, restriction: allowed };
  const zdr = privacy === 'zdr-strict' ? ((await modelRestriction(model, 'zdr')) ?? []) : [];
  if (zdr.length) {
    addWarning(
      notes,
      'music_safety_retention',
      'No ZDR endpoint without safety retention: the music prompt was sent to a ZDR endpoint with safety retention',
    );
    return { notes, restriction: zdr };
  }
  addWarning(
    notes,
    'music_no_zdr',
    'No ZDR endpoint: the music prompt was sent to the provider without Zero Data Retention',
  );
  return { notes, restriction: null };
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
  if (!(await listMusicModels()).some((m) => m.id === o.model)) throw unknownModel(o.model);
  const runId = crypto.randomUUID();
  onEvent({ type: 'start', runId, plan: [{ model: o.model, count: 1 }] });
  const { notes, restriction } = await musicPrivacy(o.model, privacy);
  const base = {
    runId,
    model: o.model,
    prompt,
    privacy,
    params: { mode: 'music' },
    providerRestriction: restriction,
    ...notes,
  };

  const request = {
    model: o.model,
    modalities: ['audio', 'text'],
    stream: true,
    messages: [{ role: 'user', content: prompt }],
    ...providerField(restriction),
  };
  const log = new CallLog('/chat/completions', request);
  const stream: MusicStream = { audio: '', text: '', cost: null, generationId: null, provider: null, last: null };
  try {
    // Songs can take several minutes
    const res = await postJson('/chat/completions', request, callSignal(abort, Math.max(REQUEST_TIMEOUT_MS, 600_000)));
    log.received(res);
    await ensureOk(res);
    if (res.body) for await (const chunk of sseEvents(res.body)) addChunk(stream, chunk);
    const { file, mediaType, kb } = await saveMusic(stream, o.model, runId);
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
    // A stream that broke off (or saving that failed) can still have been charged
    const billing = {
      generationId: stream.generationId,
      provider: stream.provider,
      cost: stream.cost,
      callCost: stream.cost,
    };
    return finish(audioEntry({ ...base, ...fields, ...billing, debugId, durationMs: log.elapsed() }), onEvent);
  }
}
