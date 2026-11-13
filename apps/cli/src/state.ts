// The last choices of the interactive mode, remembered for the next session in <data folder>/.cli-state.json
// (outside out/, so the server never serves it). Prompts and texts are not stored.
import path from 'node:path';
import { type PrivacyMode, parsePrivacy, ROOT } from '@darkroom/core/config';
import { readJsonObject, writeJsonAtomic } from '@darkroom/core/storage/json-file';
import type { ImageRun, MusicRun, SpeechRun } from './command-line.ts';

export interface CliState {
  image?: { privacy?: PrivacyMode; models?: string[]; aspect?: string; size?: string; count?: number };
  speech?: { privacy?: PrivacyMode; model?: string; voice?: string; speed?: number };
  music?: { privacy?: PrivacyMode; model?: string };
}

const STATE_FILE = path.join(ROOT, '.cli-state.json');

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);

/** Keep only fields of the expected types (the file may be old or edited by hand). */
export function sanitizeState(raw: unknown): CliState {
  const image = obj(obj(raw).image);
  const speech = obj(obj(raw).speech);
  const music = obj(obj(raw).music);
  return {
    image: {
      privacy: parsePrivacy(image.privacy),
      models: strs(image.models),
      aspect: str(image.aspect),
      size: str(image.size),
      count: num(image.count),
    },
    speech: {
      privacy: parsePrivacy(speech.privacy),
      model: str(speech.model),
      voice: str(speech.voice),
      speed: num(speech.speed),
    },
    music: { privacy: parsePrivacy(music.privacy), model: str(music.model) },
  };
}

export async function loadState(): Promise<CliState> {
  return sanitizeState(await readJsonObject(STATE_FILE));
}

/** Remember the choices of a run (failures to write are ignored: it is only a convenience). */
export async function rememberRun(
  kind: 'image' | 'speech' | 'music',
  run: ImageRun | SpeechRun | MusicRun,
): Promise<void> {
  const state = await loadState();
  try {
    await writeJsonAtomic(STATE_FILE, { ...state, [kind]: choicesOf(run) });
  } catch {
    // read-only data folder: nothing to remember
  }
}

/** The fields of a run worth remembering. */
export function choicesOf(run: ImageRun | SpeechRun | MusicRun): CliState[keyof CliState] {
  if ('models' in run) {
    return { privacy: run.privacy, models: run.models, aspect: run.aspect, size: run.size, count: run.count };
  }
  if ('text' in run) return { privacy: run.privacy, model: run.model, voice: run.voice, speed: run.speed };
  return { privacy: run.privacy, model: run.model };
}
