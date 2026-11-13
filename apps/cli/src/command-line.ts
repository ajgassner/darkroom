// The non-interactive command line for the choices of an interactive run (to reuse it or hand it to an agent).
import type { PrivacyMode } from '@darkroom/core/config';

/** Everything an image run needs, as `darkroom gen` options. */
export interface ImageRun {
  privacy: PrivacyMode;
  models: string[];
  element: string | null;
  aspect?: string;
  size?: string;
  count: number;
  prompt: string;
  format?: string;
  quality?: string;
  seed?: number;
  refs?: string[];
  /** false: --no-prefix */
  prefix?: boolean;
  maxSide?: number;
}

export interface SpeechRun {
  privacy: PrivacyMode;
  model: string;
  voice?: string;
  text: string;
  instructions?: string;
  speed?: number;
}

export interface MusicRun {
  privacy: PrivacyMode;
  model: string;
  prompt: string;
}

/** POSIX shell quoting: plain words stay as they are, everything else goes into single quotes. */
export function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

export function commandLine(argv: string[]): string {
  return argv.map(shellQuote).join(' ');
}

/** `flag value` when the value is set. */
function opt(flag: string, value: string | number | null | undefined): string[] {
  return value === undefined || value === null || value === '' ? [] : [flag, String(value)];
}

/** The text argument; `--` keeps a text that starts with a dash from being read as an option. */
function positional(text: string): string[] {
  return text.startsWith('-') ? ['--', text] : [text];
}

export function genArgs(r: ImageRun): string[] {
  return [
    'darkroom',
    'gen',
    ...r.models.flatMap((m) => ['-m', m]),
    ...opt('-e', r.element),
    ...opt('-a', r.aspect),
    ...opt('-s', r.size),
    ...(r.count === 1 ? [] : ['-n', String(r.count)]),
    ...opt('-f', r.format),
    ...opt('-q', r.quality),
    ...opt('--seed', r.seed),
    ...(r.refs ?? []).flatMap((ref) => ['-r', ref]),
    ...(r.prefix === false ? ['--no-prefix'] : []),
    ...opt('--max-side', r.maxSide),
    '--privacy',
    r.privacy,
    ...positional(r.prompt),
  ];
}

export function speakArgs(r: SpeechRun): string[] {
  return [
    'darkroom',
    'speak',
    '-m',
    r.model,
    ...opt('-v', r.voice),
    ...opt('-i', r.instructions),
    ...(r.speed === undefined || r.speed === 1 ? [] : ['--speed', String(r.speed)]),
    '--privacy',
    r.privacy,
    ...positional(r.text),
  ];
}

export function musicArgs(r: MusicRun): string[] {
  return ['darkroom', 'music', '-m', r.model, '--privacy', r.privacy, ...positional(r.prompt)];
}
