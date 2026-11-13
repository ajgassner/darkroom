// Own voices: voices/<name>/ with recorded samples and their transcripts (voice.json).
import fs from 'node:fs/promises';
import path from 'node:path';
import { VOICES_DIR } from './config.ts';
import type { VoiceInfo } from './contract.ts';
import { AppError } from './errors.ts';
import { safeBaseName } from './files.ts';
import { readJsonObject, serialized, writeJsonAtomic } from './json-file.ts';
import { validName } from './refs.ts';
import { parseWav, pcmToWav, type WavInfo } from './wav.ts';

export type { VoiceInfo };

const AUDIO_EXT = /\.(wav|mp3)$/i;

interface VoiceConfig {
  label?: string;
  /** Legacy format: one transcript for everything. */
  transcript?: string;
  transcripts?: Record<string, string>;
}

function voiceDir(name: string): string {
  if (!validName(name)) throw new AppError('invalid_name', `Invalid voice name: ${name}`, { name });
  return path.join(VOICES_DIR, name);
}

const configFile = (name: string) => path.join(voiceDir(name), 'voice.json');

/**
 * voice.json of a voice ({} without one). Reading for display tolerates a damaged file; the write path
 * (`strict`) refuses it instead, so that the label and transcripts are not overwritten with nothing.
 */
function readConfig(name: string, strict = false): Promise<VoiceConfig> {
  return readJsonObject<VoiceConfig>(
    configFile(name),
    strict
      ? () =>
          new AppError(
            'voice_config_invalid',
            `voices/${name}/voice.json is damaged and was left unchanged. Fix or delete it.`,
            { name },
          )
      : undefined,
  );
}

const writeConfig = (name: string, cfg: VoiceConfig) => writeJsonAtomic(configFile(name), cfg);

/** Read-modify-write of voice.json, one at a time per voice (in this process). */
const updateConfig = <T>(name: string, fn: () => Promise<T>) => serialized(`voice:${name}`, fn);

export async function listVoices(): Promise<VoiceInfo[]> {
  await fs.mkdir(VOICES_DIR, { recursive: true });
  const dirs = await fs.readdir(VOICES_DIR, { withFileTypes: true });
  const out: VoiceInfo[] = [];
  for (const d of dirs) if (d.isDirectory() && validName(d.name)) out.push(await getVoice(d.name));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getVoice(name: string): Promise<VoiceInfo> {
  const files = await fs.readdir(voiceDir(name)).catch(() => {
    throw new AppError('voice_not_found', `Voice "${name}" not found (voices/${name}/)`, { name });
  });
  const cfg = await readConfig(name);
  const samples = files.filter((f) => AUDIO_EXT.test(f) && !f.startsWith('.')).sort();
  const transcripts: Record<string, string> = {};
  for (const f of samples) if (cfg.transcripts?.[f]) transcripts[f] = cfg.transcripts[f];
  // Adopt the legacy format: a single transcript belongs to the first sample
  if (!Object.keys(transcripts).length && cfg.transcript && samples[0]) transcripts[samples[0]] = cfg.transcript;
  return {
    name,
    label: cfg.label || name,
    transcript: samples
      .map((f) => transcripts[f]?.trim())
      .filter(Boolean)
      .join(' '),
    transcripts,
    samples,
  };
}

export async function saveVoice(
  name: string,
  cfg: { label?: string; transcripts?: Record<string, string> },
): Promise<VoiceInfo> {
  await fs.mkdir(voiceDir(name), { recursive: true });
  await updateConfig(name, async () => {
    const current = await readConfig(name, true);
    const existing = await getVoice(name);
    await writeConfig(name, {
      label: cfg.label ?? current.label,
      transcripts: { ...existing.transcripts, ...(cfg.transcripts ?? {}) },
    });
  });
  return getVoice(name);
}

export function samplePath(name: string, file: string): string {
  if (!AUDIO_EXT.test(file) || file.includes('/') || file.includes('\\') || file.startsWith('.')) {
    throw new AppError('invalid_filename', 'Invalid file name');
  }
  return path.join(voiceDir(name), file);
}

export async function addSample(name: string, originalName: string, buf: Buffer): Promise<string> {
  const dir = voiceDir(name);
  await fs.mkdir(dir, { recursive: true });
  const ext = buf.subarray(0, 4).toString() === 'RIFF' ? 'wav' : 'mp3';
  const file = `${Date.now()}_${safeBaseName(originalName, 'sample')}.${ext}`;
  await fs.writeFile(path.join(dir, file), buf);
  return file;
}

export async function deleteSample(name: string, file: string): Promise<void> {
  await fs.unlink(samplePath(name, file));
  await updateConfig(name, async () => {
    const cfg = await readConfig(name, true);
    if (cfg.transcripts?.[file] !== undefined) {
      delete cfg.transcripts[file];
      await writeConfig(name, cfg);
    }
  });
}

// ---------------------------------------------------------------- Clip for voice cloning

const MAX_CLONE_SEC = 60;
const GAP_SEC = 0.4;

const sameFormat = (a: WavInfo, b: WavInfo) => a.rate === b.rate && a.channels === b.channels && a.bits === b.bits;

/** Join the WAV samples that share the first sample's format: 0.4 s pause in between, max. 60 s in total. */
function joinWavs(wavs: (WavInfo | null)[], first: WavInfo): { pcm: Buffer; used: number } {
  const frame = first.channels * (first.bits / 8);
  const bytesPerSec = first.rate * frame;
  const floorFrame = (bytes: number) => bytes - (bytes % frame);
  const gap = Buffer.alloc(floorFrame(Math.round(bytesPerSec * GAP_SEC)));
  const parts: Buffer[] = [];
  let room = MAX_CLONE_SEC * bytesPerSec;
  let used = 0;
  for (const w of wavs) {
    if (!w || !sameFormat(w, first)) continue;
    if (parts.length) {
      if (room <= gap.length) break;
      parts.push(gap);
      room -= gap.length;
    }
    const chunk = w.data.subarray(0, Math.max(0, Math.min(w.data.length, floorFrame(room))));
    parts.push(chunk);
    room -= chunk.length;
    used++;
  }
  return { pcm: Buffer.concat(parts), used };
}

/**
 * All samples of a voice as one clip (some models need exactly one reference clip).
 * MP3 or non-16-bit samples cannot be joined: then the first sample is used as it is.
 */
export async function combinedSample(v: VoiceInfo): Promise<{ buf: Buffer; format: 'wav' | 'mp3'; used: number }> {
  const bufs = await Promise.all(v.samples.map((s) => fs.readFile(samplePath(v.name, s))));
  const wavs = bufs.map(parseWav);
  const first = wavs[0];
  if (!first) return { buf: bufs[0], format: 'mp3', used: 1 };
  if (first.bits !== 16) return { buf: bufs[0], format: 'wav', used: 1 };
  const { pcm, used } = joinWavs(wavs, first);
  return { buf: pcmToWav(pcm, first.rate, first.channels), format: 'wav', used };
}
