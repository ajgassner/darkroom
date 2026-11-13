// Transcription of voice samples: locally with Whisper (worker process) or via the API with ZDR.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { audioEntry } from './audio-run.ts';
import { DEFAULT_PRIVACY, type PrivacyMode, TRANSCRIBE_MODEL } from './config.ts';
import { AppError } from './errors.ts';
import { appendEntry } from './manifest.ts';
import { modelRestriction, privacyBlocked, providerField } from './privacy.ts';
import { callSignal, ensureOk, postJson } from './upstream.ts';
import { samplePath, saveVoice } from './voices.ts';
import { runWorker } from './worker.ts';

export type TranscribeEngine = 'local' | 'api';

interface Transcript {
  text: string;
  model: string;
  cost: number | null;
}

const LANG_WHISPER: Record<string, string> = {
  de: 'german',
  en: 'english',
  fr: 'french',
  es: 'spanish',
  it: 'italian',
  nl: 'dutch',
  pt: 'portuguese',
};

async function transcribeLocal(file: string, language: string, abort?: AbortSignal): Promise<Transcript> {
  const args = LANG_WHISPER[language] ? [file, LANG_WHISPER[language]] : [file];
  const stdout = await runWorker('transcribe-worker.ts', args, {
    timeout: 600_000,
    signal: abort,
    notInstalled: () =>
      new AppError(
        'transcribe_not_installed',
        'Local transcription is not installed: pnpm --filter @darkroom/core add @huggingface/transformers (or choose "API")',
      ),
    failed: (message) => new AppError('transcribe_failed', `Local transcription failed: ${message}`, { message }),
  });
  // The worker prints its result as the last JSON line
  const line =
    stdout
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .pop() ?? '{}';
  const r = JSON.parse(line) as { text?: string; model?: string };
  return { text: r.text ?? '', model: r.model ?? 'whisper (local)', cost: null };
}

async function transcribeApi(
  file: string,
  language: string,
  privacy: PrivacyMode,
  label: string,
  abort?: AbortSignal,
): Promise<Transcript> {
  const model = TRANSCRIBE_MODEL;
  // Voice samples are personal data: only ZDR endpoints allowed by the mode, no fallback to other providers
  const restriction = await modelRestriction(model, privacy);
  if (restriction && !restriction.length) {
    const blocked = privacyBlocked(privacy);
    throw new AppError(blocked.errorCode, blocked.error);
  }
  const audio = await fs.readFile(file);
  const res = await postJson(
    '/audio/transcriptions',
    {
      model,
      input_audio: { data: audio.toString('base64'), format: file.toLowerCase().endsWith('.wav') ? 'wav' : 'mp3' },
      ...(language && language !== 'auto' ? { language } : {}),
      ...providerField(restriction),
    },
    callSignal(abort),
  ).then(ensureOk);
  const body = (await res.json().catch(() => ({}))) as { text?: string; usage?: { cost?: number } };
  const cost = typeof body.usage?.cost === 'number' ? body.usage.cost : null;
  // Count the cost, but do not show the transcription in the gallery
  await appendEntry(
    audioEntry({
      runId: crypto.randomUUID(),
      model,
      prompt: `Transcription ${label}`,
      privacy,
      providerRestriction: restriction,
      ok: true,
      demo: true,
      tool: 'transcribe',
      cost,
      callCost: cost,
      generationId: res.headers.get('x-generation-id'),
    }),
  );
  return { text: body.text ?? '', model, cost };
}

/** Transcribe a sample and save the text in voice.json (not after a cancel: `abort` kills the local worker). */
export async function transcribeSample(
  name: string,
  file: string,
  engine: TranscribeEngine,
  language: string,
  privacy: PrivacyMode = DEFAULT_PRIVACY,
  abort?: AbortSignal,
): Promise<{ text: string; engine: TranscribeEngine; model: string; cost: number | null }> {
  const p = samplePath(name, file);
  const r =
    engine === 'local'
      ? await transcribeLocal(p, language, abort)
      : await transcribeApi(p, language, privacy, `${name}/${file}`, abort);
  if (abort?.aborted) throw new AppError('aborted', 'Aborted');
  const text = r.text.trim();
  await saveVoice(name, { transcripts: { [file]: text } });
  return { text, engine, model: r.model, cost: r.cost };
}
