// Text to speech with a model voice or an own cloned voice.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { listSpeechModels } from './audio-models.ts';
import { audioEntry, finish, lookupCostLater } from './audio-run.ts';
import { apiKey, DEFAULT_PRIVACY, OUT_DIR, type PrivacyMode } from './config.ts';
import type { RunEvent, SpeechModel, VoiceInfo } from './contract.ts';
import { AppError, addWarning, errorFields, type WarningList } from './errors.ts';
import { runStamp, slug } from './files.ts';
import type { ManifestEntry } from './manifest.ts';
import { modelRestriction, privacyBlocked, providerField } from './privacy.ts';
import { CallLog, callSignal, HttpStatusError, jsonOrText, postJson } from './upstream.ts';
import { combinedSample, getVoice } from './voices.ts';
import { audioType, pcmToWav } from './wav.ts';

export interface SpeechOptions {
  text: string;
  model: string;
  /** Model voice (supported_voices) or "voice:<name>" for an own voice. */
  voice?: string;
  instructions?: string;
  speed?: number;
  privacy?: PrivacyMode;
  /** Voice preview: cached under out/demos/ and not shown in the gallery. */
  demo?: boolean;
}

type SpeechFormat = 'mp3' | 'pcm';

/** Providers that only deliver raw PCM. */
const PCM_ONLY = /^(google\/|heygen\/)/;

function demoBase(model: string, voice: string): string {
  return `${slug(model)}__${slug(voice || 'standard')}`;
}

/** Existing voice preview (relative to out/) or null. */
export async function findDemo(model: string, voice: string): Promise<string | null> {
  const base = demoBase(model, voice);
  const files = await fs.readdir(path.join(OUT_DIR, 'demos')).catch(() => [] as string[]);
  const hit = files.find((f) => f.startsWith(`${base}.`));
  return hit ? `demos/${hit}` : null;
}

/** The voice part of the request: a model voice, or one reference clip (+ transcript) of an own voice. */
interface VoicePart {
  fields: Record<string, unknown>;
  label: string;
  refCount: number;
}

/**
 * Own voice: always exactly ONE clip. With several clips some models (Seed Audio) require placeholders
 * like @Audio1 in the text, so several WAV samples are combined into one clip.
 */
async function cloneVoice(v: VoiceInfo, model: SpeechModel | undefined, notes: WarningList): Promise<VoicePart> {
  if (model && !model.cloning) {
    addWarning(notes, 'clone_not_flagged', 'Model is not flagged as capable of voice cloning, trying anyway');
  }
  const clip = await combinedSample(v);
  const mime = clip.format === 'wav' ? 'audio/wav' : 'audio/mpeg';
  const refs: unknown[] = [
    {
      type: 'input_audio',
      input_audio: { data: `data:${mime};base64,${clip.buf.toString('base64')}`, format: clip.format },
    },
  ];
  if (v.transcript.trim()) refs.push({ type: 'text', text: v.transcript.trim() });
  if (clip.used < v.samples.length) {
    addWarning(
      notes,
      'samples_partial',
      `Only ${clip.used} of ${v.samples.length} samples used (different formats or 60 s limit)`,
      { used: clip.used, total: v.samples.length },
    );
  }
  return { fields: { input_references: refs }, label: `voice:${v.name}`, refCount: clip.used };
}

/** Request fields for instructions and speed (also stored as params in the manifest). */
function deliveryParams(o: SpeechOptions): Record<string, unknown> {
  const instructions = o.instructions?.trim();
  return {
    ...(instructions ? { instructions } : {}),
    ...(o.speed && o.speed !== 1 ? { speed: o.speed } : {}),
  };
}

/** Call the speech API; if the provider rejects the format, try the other one once. */
async function fetchSpeech(
  body: Record<string, unknown>,
  log: CallLog,
  abort?: AbortSignal,
): Promise<{ res: Response; format: SpeechFormat }> {
  let format: SpeechFormat = PCM_ONLY.test(String(body.model)) ? 'pcm' : 'mp3';
  for (let attempt = 0; ; attempt++) {
    log.request = { ...body, response_format: format };
    const res = await postJson('/audio/speech', log.request, callSignal(abort));
    log.received(res);
    if (res.ok) return { res, format };
    const text = await res.text();
    if (attempt > 0 || res.status !== 400 || !/pcm|mp3|response_format|format/i.test(text)) {
      throw new HttpStatusError(res.status, text);
    }
    format = format === 'mp3' ? 'pcm' : 'mp3';
  }
}

/** Audio as file content: raw PCM is wrapped in a WAV header. */
async function audioBytes(res: Response, format: SpeechFormat): Promise<Buffer> {
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('pcm') && format !== 'pcm') return buf;
  const rate = Number(/rate=(\d+)/.exec(ct)?.[1] ?? 24000);
  const channels = Number(/channels=(\d+)/.exec(ct)?.[1] ?? 1);
  return pcmToWav(buf, rate, channels);
}

type Base = Pick<ManifestEntry, 'runId' | 'model' | 'prompt' | 'privacy'> & Partial<ManifestEntry>;

async function saveAudio(buf: Buffer, o: SpeechOptions, base: Base) {
  const { ext, mediaType } = audioType(buf);
  const file = o.demo
    ? `demos/${demoBase(o.model, base.voice ?? '')}.${ext}`
    : `${runStamp(base.runId)}_tts_${slug(o.model)}.${ext}`;
  await fs.mkdir(path.dirname(path.join(OUT_DIR, file)), { recursive: true });
  // Demos are a cache per model and voice (replaced on purpose); results are never overwritten
  await fs.writeFile(path.join(OUT_DIR, file), buf, { flag: o.demo ? 'w' : 'wx' });
  return { file, mediaType };
}

async function speak(
  o: SpeechOptions,
  body: Record<string, unknown>,
  base: Base,
  onEvent: (e: RunEvent) => void,
  abort?: AbortSignal,
): Promise<ManifestEntry[]> {
  const log = new CallLog('/audio/speech', body);
  let generationId: string | null = null;
  try {
    const { res, format } = await fetchSpeech(body, log, abort);
    generationId = res.headers.get('x-generation-id');
    const buf = await audioBytes(res, format);
    const { file, mediaType } = await saveAudio(buf, o, base);
    const ct = res.headers.get('content-type') || 'audio';
    const debugId = await log.save(`<${ct} ${(buf.length / 1024).toFixed(0)} KB, saved as ${file}>`);
    const entry = audioEntry({
      ...base,
      ok: true,
      file,
      mediaType,
      debugId,
      generationId,
      params: { ...base.params, format },
      durationMs: log.elapsed(),
    });
    return await finishWithCost(entry, onEvent);
  } catch (err) {
    const fields = errorFields(err, abort);
    const debugId = await log.save(err instanceof HttpStatusError ? jsonOrText(err.text) : null, fields.error);
    // Answered calls are charged even if the audio could not be saved: look the cost up for the error entry too
    const entry = audioEntry({ ...base, ...fields, debugId, generationId, durationMs: log.elapsed() });
    return finishWithCost(entry, onEvent);
  }
}

/** Record the entry; its cost is looked up later via the generation ID. */
async function finishWithCost(entry: ManifestEntry, onEvent: (e: RunEvent) => void): Promise<ManifestEntry[]> {
  const out = await finish(entry, onEvent);
  if (entry.generationId && entry.id) lookupCostLater(entry.id, entry.generationId);
  return out;
}

export async function runSpeech(
  o: SpeechOptions,
  onEvent: (e: RunEvent) => void = () => {},
  abort?: AbortSignal,
): Promise<ManifestEntry[]> {
  const text = o.text?.trim();
  if (!text) throw new AppError('text_missing', 'Text is missing');
  apiKey();
  const privacy = o.privacy ?? DEFAULT_PRIVACY;
  const model = (await listSpeechModels()).find((m) => m.id === o.model);
  const runId = crypto.randomUUID();
  onEvent({ type: 'start', runId, plan: [{ model: o.model, count: 1 }] });

  const notes: WarningList = { warnings: [], notices: [] };
  const base: Base = {
    runId,
    model: o.model,
    prompt: text,
    privacy,
    voice: o.voice || '',
    ...(o.demo ? { demo: true } : {}),
    ...notes,
  };
  // Same rule as for images: only ZDR endpoints allowed by the mode, no fallback to other providers
  const restriction = await modelRestriction(o.model, privacy);
  if (restriction && !restriction.length) {
    return finish(audioEntry({ ...base, providerRestriction: restriction, ...privacyBlocked(privacy) }), onEvent);
  }

  let voice: VoicePart = { fields: o.voice ? { voice: o.voice } : {}, label: o.voice || '', refCount: 0 };
  if (o.voice?.startsWith('voice:')) {
    const v = await getVoice(o.voice.slice(6));
    if (!v.samples.length) {
      const error = {
        error: `Voice "${v.label}" has no sample.`,
        errorCode: 'no_voice_sample',
        errorParams: { label: v.label },
      };
      return finish(audioEntry({ ...base, ...error }), onEvent);
    }
    voice = await cloneVoice(v, model, notes);
  }

  const params = deliveryParams(o);
  const body = {
    model: o.model,
    input: text,
    ...voice.fields,
    ...params,
    ...providerField(restriction),
  };
  const instructions = typeof params.instructions === 'string' ? `[${params.instructions}] ` : '';
  return speak(
    o,
    body,
    {
      ...base,
      voice: voice.label,
      refCount: voice.refCount,
      params,
      fullPrompt: `${instructions}${text}`,
      providerRestriction: restriction,
    },
    onEvent,
    abort,
  );
}

/**
 * Voice preview: cached per model and voice (own voices are always generated fresh).
 * Throws when the preview fails, with the code of the failed entry; `abort` cancels the call (page closed).
 */
export async function speechDemo(
  o: { model: string; voice: string; text: string; privacy?: PrivacyMode; regenerate?: boolean },
  abort?: AbortSignal,
): Promise<{ file: string; cached: boolean }> {
  const cached = !o.voice.startsWith('voice:') && !o.regenerate ? await findDemo(o.model, o.voice) : null;
  if (cached) return { file: cached, cached: true };
  const [entry] = await runSpeech({ ...o, voice: o.voice || undefined, demo: true }, undefined, abort);
  if (!entry.ok || !entry.file) {
    throw new AppError(entry.errorCode ?? 'demo_failed', entry.error ?? 'Voice preview failed', entry.errorParams);
  }
  return { file: entry.file, cached: false };
}
