#!/usr/bin/env node
// darkroom CLI: generate images, speech and music from the terminal (same core as the web UI).
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import * as p from '@clack/prompts';
import { withLateCosts } from '@darkroom/core/audio-run';
import {
  APP_VERSION,
  DEFAULT_MODEL,
  DEFAULT_PRIVACY,
  OUT_DIR,
  type PrivacyMode,
  parsePrivacy,
} from '@darkroom/core/config';
import type { ManifestEntry, RunEvent } from '@darkroom/core/contract';
import { runGeneration } from '@darkroom/core/generate';
import { costSummary, readEntries } from '@darkroom/core/manifest';
import { runMusic } from '@darkroom/core/music';
import { listImageModels, zdrEndpoints } from '@darkroom/core/openrouter';
import { maxRefs } from '@darkroom/core/params';
import { listElements } from '@darkroom/core/refs';
import { runSpeech } from '@darkroom/core/speech';
import { listVoices } from '@darkroom/core/voices';
import { Command, InvalidArgumentError, Option } from 'commander';
import pc from 'picocolors';
import { collect, hasMention, parseModels, resolveRefs } from './args.ts';

const usd = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : `$${v.toFixed(4)}`);
const interactive = process.stdout.isTTY && process.stdin.isTTY;

function privacyOption() {
  return new Option('--privacy <mode>', 'zdr | zdr-strict | off')
    .default(DEFAULT_PRIVACY)
    .argParser((v): PrivacyMode => {
      const mode = parsePrivacy(v);
      if (!mode) throw new InvalidArgumentError('must be zdr, zdr-strict or off');
      return mode;
    });
}

function intArg(min: number, max: number) {
  return (v: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new InvalidArgumentError(`must be an integer from ${min} to ${max}`);
    return n;
  };
}

/** Ask for a missing value in interactive terminals; fail with a hint otherwise. */
async function ask(message: string, placeholder: string): Promise<string> {
  if (!interactive) throw new Error(`${message} (missing argument)`);
  const v = await p.text({ message, placeholder, validate: (s) => (s?.trim() ? undefined : 'Required') });
  if (p.isCancel(v)) {
    p.cancel('Cancelled');
    process.exit(1);
  }
  return v.trim();
}

type Spinner = ReturnType<typeof p.spinner>;
/** The spinner that is running (its timer keeps the process alive until it is stopped). */
let activeSpinner: Spinner | null = null;

/** A command failed: stop its spinner with an error mark. */
function failSpinner() {
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

/** Ctrl+C (or SIGTERM): the first one calls `first`, a second one quits right away. */
function onInterrupt(first: () => void) {
  let count = 0;
  const handler = () => (count++ ? process.exit(130) : first());
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}

/** Ctrl+C aborts the running API calls (not delivered results are not billed according to OpenRouter). */
function abortOnInterrupt(): AbortSignal {
  const ac = new AbortController();
  onInterrupt(() => ac.abort());
  return ac.signal;
}

/** Resolves with `value` once `signal` is aborted. */
function onAbort<T>(signal: AbortSignal, value: T): Promise<T> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve(value);
    else signal.addEventListener('abort', () => resolve(value), { once: true });
  });
}

function report(entries: ManifestEntry[]) {
  for (const e of entries) {
    if (e.ok)
      p.log.success(
        `${pc.bold(`out/${e.file}`)}  ${pc.dim(`${usd(e.cost)} · ${(e.durationMs / 1000).toFixed(1)} s · ${e.model}`)}`,
      );
    else p.log.error(`${e.model}: ${e.error}`);
    for (const w of e.warnings) p.log.warn(pc.yellow(w));
  }
}

/** Spinner with progress while a run streams its results; Ctrl+C aborts the run (aborted entries, exit code 130). */
function progress(total: number) {
  const spin = spinner();
  const signal = abortOnInterrupt();
  let done = 0;
  return {
    signal,
    start: (label: string) => spin.start(label),
    onEvent: (ev: RunEvent) => {
      if (ev.type !== 'image' && ev.type !== 'error') return;
      done++;
      spin.message(`${done}/${total} done`);
    },
    /** Wait for costs that are looked up later (speech), then list the results. */
    stop: async (results: ManifestEntry[]) => {
      const late = withLateCosts(results, () => spin.message('Fetching cost'));
      const entries = await Promise.race([late, onAbort(signal, results)]);
      const ok = entries.filter((e) => e.ok);
      const cost = entries.reduce((s, e) => s + (e.cost ?? 0), 0); // failed calls can be charged too
      spin.stop(`${ok.length} result(s), ${entries.length - ok.length} error(s), ${usd(cost)}`);
      report(entries);
      // Unfinished cost lookups are retried by the server at its next start
      if (signal.aborted) process.exit(130);
      if (entries.length && !ok.length) process.exitCode = 1;
    },
  };
}

/** Ask for an element in interactive terminals when the prompt has no @mentions. */
async function chooseElement(prompt: string): Promise<string | null> {
  if (!interactive || hasMention(prompt)) return null;
  const els = await listElements();
  if (!els.length) return null;
  const pick = await p.select({
    message: 'Element',
    options: [
      { value: '', label: 'none' },
      ...els.map((e) => ({ value: e.name, label: `@${e.name}`, hint: `${e.type}, ${e.photos.length} images` })),
    ],
  });
  if (p.isCancel(pick)) {
    p.cancel('Cancelled');
    process.exit(1);
  }
  return pick || null;
}

const program = new Command()
  .name('darkroom')
  .description('Local, private images and audio with your own references via OpenRouter')
  .version(APP_VERSION)
  .showHelpAfterError();

// The installed darkroom command handles "darkroom update" and "darkroom uninstall [--yes]" itself (they replace
// or remove the app the CLI runs from). They reach the CLI only with other arguments (like --help) or in a git
// checkout.
const checkoutHint = (what: string, installed: string, checkout: string) => () =>
  p.log.info(`To ${what} an installed darkroom, run: ${installed}\nIn a git checkout: ${checkout}`);
program
  .command('update')
  .description('Update to the latest release (keeps your data)')
  .addHelpText(
    'after',
    '\nRuns the installer again: downloads the latest release and its Node.js, and keeps the previous version if\n' +
      'anything fails. Restart a running darkroom afterwards. Your data folder is not touched.',
  )
  .action(checkoutHint('update', 'darkroom update', 'git pull && pnpm install && pnpm build'));
program
  .command('uninstall')
  .description('Remove darkroom (keeps your data)')
  .option('-y, --yes', 'do not ask for confirmation')
  .addHelpText(
    'after',
    '\nRemoves what the installer created in the install folder (the app, its Node.js and caches) and the PATH\n' +
      'entry. Asks for confirmation in a terminal. Your data folder (.env, refs, voices, out) stays.',
  )
  .action(checkoutHint('uninstall', 'darkroom uninstall', 'delete the checkout folder'));

program
  .command('gen')
  .alias('generate')
  .description('Generate images (several models run in parallel)')
  .argument('[prompt...]', 'prompt; use @name to include elements')
  .option('-e, --element <name>', 'element (reference set from refs/<name>/)')
  // Options take one value each (repeat them for more): a variadic option would swallow the prompt after it
  .option('-m, --model <ids>', `model; repeat or comma-separate for several (default: ${DEFAULT_MODEL})`, collect)
  .option('-a, --aspect <ratio>', 'aspect ratio, e.g. 1:1, 3:4, 4:5, 9:16, 16:9')
  .option('-s, --size <tier>', 'size: 512 | 1K | 2K | 4K')
  .option('-n, --count <n>', 'images per model (1–10)', intArg(1, 10), 1)
  .option('-f, --format <fmt>', 'file format: png | jpeg | webp (if supported)')
  .option('-q, --quality <q>', 'quality: low | medium | high (e.g. GPT Image)')
  .option('--seed <n>', 'seed (if supported)', intArg(0, 2 ** 31))
  .option('-r, --ref <file>', 'additional reference image (path or file from out/); repeat for several', collect)
  .option('--no-prefix', 'do not prepend the element instructions')
  .option('--max-side <px>', 'longest side of the references', intArg(256, 4096))
  .addOption(privacyOption())
  .action(async (words: string[], o) => {
    p.intro(pc.inverse(' darkroom · images '));
    const prompt =
      words.join(' ').trim() || (await ask('Prompt', 'Business portrait in a bright office, soft window light'));
    const element = o.element ?? (await chooseElement(prompt));
    const extraRefs = resolveRefs(o.ref, OUT_DIR);
    const models = parseModels(o.model ?? [DEFAULT_MODEL]);
    const run = progress(models.length * o.count);
    run.start(`Generating ${models.map((m) => `${o.count}× ${m}`).join(', ')}`);
    const entries = await runGeneration(
      {
        prompt,
        models,
        element,
        usePrefix: o.prefix,
        extraRefs,
        count: o.count,
        aspectRatio: o.aspect,
        resolution: o.size,
        outputFormat: o.format,
        quality: o.quality,
        seed: o.seed,
        maxSide: o.maxSide,
        privacy: o.privacy,
      },
      run.onEvent,
      run.signal,
    );
    await run.stop(entries);
    const all = costSummary(await readEntries());
    p.outro(pc.dim(`Total so far: ${usd(all.total)} for ${all.images} results`));
  });

program
  .command('speak')
  .description('Text to speech (model voice or own cloned voice)')
  .argument('[text...]', 'text to speak')
  .option('-m, --model <id>', 'speech model', 'elevenlabs/eleven-v4')
  .option('-v, --voice <voice>', 'model voice, or voice:<name> for an own voice')
  .option('-i, --instructions <text>', 'delivery instructions (Gemini, Fish Audio, OpenAI)')
  .option('--speed <x>', 'speed, e.g. 0.9 or 1.1', Number.parseFloat)
  .addOption(privacyOption())
  .action(async (words: string[], o) => {
    p.intro(pc.inverse(' darkroom · speech '));
    const text = words.join(' ').trim() || (await ask('Text', 'Hello! This is a short test.'));
    const run = progress(1);
    run.start(`Speaking with ${o.model}`);
    await run.stop(
      await runSpeech(
        { text, model: o.model, voice: o.voice, instructions: o.instructions, speed: o.speed, privacy: o.privacy },
        run.onEvent,
        run.signal,
      ),
    );
    p.outro(pc.dim('Done'));
  });

program
  .command('music')
  .description('Generate a music clip (Google Lyria)')
  .argument('[prompt...]', 'style, instruments, tempo, mood, lyrics')
  .option('-m, --model <id>', 'music model', 'google/lyria-3-clip-preview')
  .addOption(privacyOption())
  .action(async (words: string[], o) => {
    p.intro(pc.inverse(' darkroom · music '));
    const prompt = words.join(' ').trim() || (await ask('Describe the music', 'calm acoustic guitar jingle, 120 bpm'));
    const run = progress(1);
    run.start(`Composing with ${o.model}`);
    await run.stop(await runMusic({ prompt, model: o.model, privacy: o.privacy }, run.onEvent, run.signal));
    p.outro(pc.dim('Done'));
  });

program
  .command('models')
  .description('Image models with reference support, parameters and ZDR status')
  .option('--all', 'include models without reference images')
  .option('--search <text>', 'filter by id or name')
  .action(async (o) => {
    const spin = spinner();
    onInterrupt(() => process.exit(130));
    spin.start('Loading models');
    const [models, zdr] = await Promise.all([listImageModels(), zdrEndpoints()]);
    spin.stop(`${models.length} image models`);
    const needle = (o.search as string | undefined)?.toLowerCase();
    const rows = models
      .filter((m) => o.all || (maxRefs(m) ?? 0) > 0)
      .filter((m) => !needle || `${m.id} ${m.name}`.toLowerCase().includes(needle))
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const m of rows) {
      const sp = m.supported_parameters;
      const vals = (k: string) => {
        const s = sp[k];
        return s?.type === 'enum' ? s.values.join(' ') : s?.type === 'range' ? `${s.min}–${s.max}` : s ? 'yes' : '–';
      };
      const z = zdr.get(m.id) ?? [];
      const zdrText = z.length
        ? pc.green(z.map((e) => `${e.tag}${e.safetyRetention ? ' (safety retention)' : ''}`).join(', '))
        : pc.dim('no ZDR');
      p.log.message(
        [
          pc.bold(m.id),
          `${pc.dim('refs')} ${vals('input_references')}  ${pc.dim('n')} ${vals('n')}  ${pc.dim('size')} ${vals('resolution')}  ${pc.dim('format')} ${vals('output_format')}`,
          `${pc.dim('aspect')} ${vals('aspect_ratio')}`,
          `${pc.dim('ZDR')} ${zdrText}`,
        ].join('\n'),
      );
    }
  });

program
  .command('start')
  .description('Start the web UI on http://localhost (Ctrl+C stops it)')
  .action(() => {
    // The server is its own app: run it as a child process instead of importing it into the CLI
    const server = path.resolve(import.meta.dirname, '../../server/src/server.ts');
    const child = spawn(process.execPath, [server], { stdio: 'inherit' });
    // Pass signals on and wait for the server to shut down. Ctrl+C in a terminal also reaches the server directly
    // (same process group): it takes the forwarded copy right after as the same Ctrl+C. Windows has no signals:
    // kill() ends the server abruptly there, so Ctrl+C (which reaches it through the shared console) is not passed on.
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        if (signal === 'SIGTERM' || process.platform !== 'win32') child.kill(signal);
      });
    }
    child.on('exit', (code, signal) => process.exit(code ?? 128 + (signal ? os.constants.signals[signal] : 0)));
  });

program
  .command('elements')
  .description('Reference sets in refs/')
  .action(async () => {
    const els = await listElements();
    if (!els.length) return p.log.info('No elements yet. Create one in the web UI or add photos to refs/<name>/.');
    for (const e of els)
      p.log.message(`${pc.bold(`@${e.name}`)}  ${pc.dim(`${e.type} · ${e.label} · ${e.photos.length} image(s)`)}`);
  });

program
  .command('voices')
  .description('Own voices in voices/')
  .action(async () => {
    const vs = await listVoices();
    if (!vs.length) return p.log.info('No own voices yet. Record one in the web UI (Audio → Own voices).');
    for (const v of vs)
      p.log.message(`${pc.bold(`voice:${v.name}`)}  ${pc.dim(`${v.label} · ${v.samples.length} sample(s)`)}`);
  });

program
  .command('costs')
  .description('Cost total per model from out/manifest.jsonl')
  .action(async () => {
    const s = costSummary(await readEntries());
    const lines = Object.entries(s.byModel)
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([m, v]) => `${usd(v.cost).padStart(10)}  ${String(v.images).padStart(4)}  ${m}`);
    p.note(
      [...lines, pc.bold(`${usd(s.total).padStart(10)}  ${String(s.images).padStart(4)}  total`)].join('\n'),
      'Costs',
    );
  });

try {
  await program.parseAsync();
} catch (err) {
  failSpinner();
  p.log.error((err as Error).message);
  // Exit right away: background work of the failed command (catalog requests, timers) must not keep it running
  process.exit(1);
}
