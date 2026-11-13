// Terminal glue: clack prompts (Escape goes back, Ctrl+C quits with 130), spinners, run progress and results.
import path from 'node:path';
import * as p from '@clack/prompts';
import { withLateCosts } from '@darkroom/core/audio-run';
import { OUT_DIR } from '@darkroom/core/config';
import type { ManifestEntry, RunEvent } from '@darkroom/core/contract';
import pc from 'picocolors';
import { displayPath } from './args.ts';
import { type Choice, plural, usd } from './choices.ts';
import { BACK, type Back, type Prompter } from './flow.ts';

/** Prompts are only shown when both ends are a terminal; scripts and agents never get one. */
export const interactive = Boolean(process.stdout.isTTY && process.stdin.isTTY);

/** Leave with exit code 130, as after Ctrl+C in a shell. */
export function cancelled(): never {
  p.cancel('Cancelled');
  process.exit(130);
}

// clack cancels a prompt on Escape and on Ctrl+C alike; the last key tells them apart
let ctrlC = false;
if (interactive) {
  process.stdin.on('keypress', (_s: string, key?: { ctrl?: boolean; name?: string }) => {
    ctrlC = Boolean(key?.ctrl && key.name === 'c');
  });
}

/** A prompt's answer: Escape → BACK, Ctrl+C → quit with 130. */
function answer<T>(v: unknown): T | Back {
  if (!p.isCancel(v)) return v as T;
  if (ctrlC) cancelled();
  return BACK;
}

/** Label with its details, for lists that show hints only on the focused entry. */
const withHint = (c: Choice<string>) => ({ value: c.value, label: c.hint ? `${c.label}  ${pc.dim(c.hint)}` : c.label });

export const clackPrompter: Prompter = {
  async select<T>(o: { message: string; options: Choice<T>[]; initialValue?: T }) {
    return answer<T>(await p.select({ ...o, options: o.options as p.Option<T>[] }));
  },
  async search(o) {
    const options = o.options.map(withHint);
    return answer<string>(await p.autocomplete({ ...o, options, placeholder: 'type to search', maxItems: 12 }));
  },
  async searchMany(o) {
    const options = o.options.map(withHint);
    const many = { ...o, options, placeholder: 'type to search', required: true, maxItems: 12 };
    return answer<string[]>(await p.autocompleteMultiselect(many));
  },
  async text({ optional, ...o }) {
    const v = answer<string | undefined>(
      await p.text({ ...o, validate: (s) => (optional || s?.trim() ? undefined : 'Required') }),
    );
    return v === BACK ? v : (v ?? '').trim();
  },
  async confirm(o) {
    return answer<boolean>(await p.confirm(o));
  },
  note: (lines, title) => p.note(lines.join('\n'), title),
  info: (message) => p.log.info(message),
};

type Spinner = ReturnType<typeof p.spinner>;
/** The spinner that is running (its timer keeps the process alive until it is stopped). */
let activeSpinner: Spinner | null = null;

/** A command failed: stop its spinner with an error mark. */
export function failSpinner() {
  activeSpinner?.error('Failed');
  activeSpinner = null;
}

/**
 * clack's spinner switches a terminal to raw mode, where Ctrl+C is a key press that quits with exit code 0 at once.
 * Back in normal mode Ctrl+C is a SIGINT again, which aborts the running work cleanly (see onInterrupt).
 */
function spinner() {
  const spin = p.spinner({ cancelMessage: 'Cancelled' });
  return {
    start(label: string) {
      spin.start(label);
      activeSpinner = spin;
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    },
    message: (label: string) => spin.message(label),
    stop(label: string) {
      spin.stop(label);
      activeSpinner = null;
    },
  };
}

/** Ctrl+C (or SIGTERM): the first one calls `first`, a second one quits right away. Returns the removal. */
function onInterrupt(first: () => void): () => void {
  let count = 0;
  const handler = () => (count++ ? process.exit(130) : first());
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
  return () => {
    process.off('SIGINT', handler);
    process.off('SIGTERM', handler);
  };
}

/** Run `work` behind a spinner; Ctrl+C quits with 130. */
export async function loading<T>(label: string, done: (v: T) => string, work: () => Promise<T>): Promise<T> {
  const spin = spinner();
  const dispose = onInterrupt(() => process.exit(130));
  spin.start(label);
  try {
    const v = await work();
    spin.stop(done(v));
    return v;
  } finally {
    dispose();
  }
}

/** Resolves with `value` once `signal` is aborted. */
function onAbort<T>(signal: AbortSignal, value: T): Promise<T> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve(value);
    else signal.addEventListener('abort', () => resolve(value), { once: true });
  });
}

/** Absolute paths of the result files. */
export function resultFiles(entries: ManifestEntry[]): string[] {
  return entries.flatMap((e) => (e.ok && e.file ? [path.join(OUT_DIR, e.file)] : []));
}

function report(entries: ManifestEntry[]) {
  for (const e of entries) {
    if (e.ok && e.file) {
      const file = displayPath(path.join(OUT_DIR, e.file), process.cwd());
      p.log.success(
        `${pc.bold(file)}  ${pc.dim(`${usd(e.cost)} · ${(e.durationMs / 1000).toFixed(1)} s · ${e.model}`)}`,
      );
    } else p.log.error(`${e.model}: ${e.error}`);
    for (const w of e.warnings) p.log.warn(pc.yellow(w));
  }
}

/**
 * Run with a spinner that counts the results; Ctrl+C aborts the run (aborted entries, exit code 130).
 * Waits for costs that are looked up later (speech), then lists the results.
 */
export async function withProgress(
  label: string,
  total: number,
  work: (onEvent: (ev: RunEvent) => void, signal: AbortSignal) => Promise<ManifestEntry[]>,
): Promise<ManifestEntry[]> {
  const spin = spinner();
  const ac = new AbortController();
  const dispose = onInterrupt(() => ac.abort());
  let done = 0;
  spin.start(label);
  try {
    const results = await work((ev) => {
      if (ev.type !== 'image' && ev.type !== 'error') return;
      done++;
      spin.message(`${done}/${total} done`);
    }, ac.signal);
    const late = withLateCosts(results, () => spin.message('Fetching cost'));
    const entries = await Promise.race([late, onAbort(ac.signal, results)]);
    const ok = entries.filter((e) => e.ok).length;
    const cost = entries.reduce((s, e) => s + (e.cost ?? 0), 0); // failed calls can be charged too
    spin.stop(`${plural(ok, 'result')}, ${plural(entries.length - ok, 'error')}, ${usd(cost)}`);
    report(entries);
    // Unfinished cost lookups are retried by the server at its next start
    if (ac.signal.aborted) process.exit(130);
    return entries;
  } finally {
    dispose();
  }
}
