#!/usr/bin/env node
// darkroom CLI: generate images, speech and music from the terminal (same core as the web UI).
// Without the required input in a terminal it asks interactively (see studio.ts); scripts never get a prompt.
import * as p from '@clack/prompts';
import {
  APP_VERSION,
  DEFAULT_MODEL,
  DEFAULT_PRIVACY,
  OUT_DIR,
  PORT,
  type PrivacyMode,
  parsePrivacy,
} from '@darkroom/core/config';
import type { ManifestEntry } from '@darkroom/core/contract';
import { Argument, Command, InvalidArgumentError, Option } from 'commander';
import pc from 'picocolors';
import { collect, explicitOptions, floatArg, intArg, parseModels, resolveRefs } from './args.ts';
import type { ImageRun, MusicRun, SpeechRun } from './command-line.ts';
import { MODEL_KINDS } from './listing.ts';
import {
  interactiveMode,
  MUSIC_MODEL,
  runImage,
  runMusicRun,
  runSpeechRun,
  SPEECH_MODEL,
  showCosts,
  showElements,
  showModels,
  showVoices,
  startWeb,
  totalLine,
} from './studio.ts';
import { clackPrompter, failSpinner, interactive } from './term.ts';

function privacyOption(description = 'zdr | zdr-strict | off') {
  return new Option('--privacy <mode>', description).default(DEFAULT_PRIVACY).argParser((v): PrivacyMode => {
    const mode = parsePrivacy(v);
    if (!mode) throw new InvalidArgumentError('must be zdr, zdr-strict or off');
    return mode;
  });
}

/** A required text is missing outside a terminal: an error, as scripts and agents must never get a prompt. */
function missing(what: string): never {
  throw new Error(`${what} (missing argument)`);
}

/** Exit code 1 when a run delivered nothing but errors. */
function setExitCode(entries: ManifestEntry[]) {
  if (entries.length && !entries.some((e) => e.ok)) process.exitCode = 1;
}

/** Where a command's option values came from ('cli' when given on the command line). */
const sourceOf = (cmd: Command) => (key: string) => cmd.getOptionValueSource(key);

const program = new Command()
  .name('darkroom')
  .description(
    'Local, private images and audio with your own references via OpenRouter.\nWithout a command in a terminal: interactive menu.',
  )
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
  .description('Generate images (several models run in parallel); without a prompt in a terminal it asks')
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
  .action(async (words: string[], o, cmd: Command) => {
    p.intro(pc.inverse(' darkroom · images '));
    const run: ImageRun = {
      privacy: o.privacy,
      models: parseModels(o.model ?? [DEFAULT_MODEL]),
      element: o.element ?? null,
      aspect: o.aspect,
      size: o.size,
      count: o.count,
      prompt: words.join(' ').trim(),
      format: o.format,
      quality: o.quality,
      seed: o.seed,
      refs: o.ref,
      prefix: o.prefix,
      maxSide: o.maxSide,
    };
    resolveRefs(run.refs, OUT_DIR); // a missing reference fails before any question
    if (!run.prompt) {
      if (!interactive) missing('Prompt');
      const fixed = explicitOptions(run, sourceOf(cmd), {
        ...{ privacy: 'privacy', models: 'model', element: 'element', aspect: 'aspect', size: 'size', count: 'count' },
        ...{ format: 'format', quality: 'quality', seed: 'seed', refs: 'ref', prefix: 'prefix', maxSide: 'maxSide' },
      });
      await interactiveMode(clackPrompter, 'image', { image: fixed });
    }
    setExitCode(await runImage(run));
    p.outro(pc.dim(await totalLine()));
  });

program
  .command('speak')
  .description('Text to speech (model voice or own cloned voice); without text in a terminal it asks')
  .argument('[text...]', 'text to speak')
  .option('-m, --model <id>', 'speech model', SPEECH_MODEL)
  .option('-v, --voice <voice>', 'model voice, or voice:<name> for an own voice (list: darkroom voices <model>)')
  .option('-i, --instructions <text>', 'delivery instructions (Gemini, Fish Audio, OpenAI)')
  .option('--speed <x>', 'speed from 0.25 to 4, e.g. 0.9 or 1.1', floatArg(0.25, 4))
  .addOption(privacyOption())
  .action(async (words: string[], o, cmd: Command) => {
    p.intro(pc.inverse(' darkroom · speech '));
    const run: SpeechRun = {
      privacy: o.privacy,
      model: o.model,
      voice: o.voice,
      text: words.join(' ').trim(),
      instructions: o.instructions,
      speed: o.speed,
    };
    if (!run.text) {
      if (!interactive) missing('Text');
      const fixed = explicitOptions(run, sourceOf(cmd), {
        ...{ privacy: 'privacy', model: 'model', voice: 'voice', instructions: 'instructions', speed: 'speed' },
      });
      await interactiveMode(clackPrompter, 'speech', { speech: fixed });
    }
    setExitCode(await runSpeechRun(run));
    p.outro(pc.dim('Done'));
  });

program
  .command('music')
  .description('Generate a music clip (Google Lyria); without a prompt in a terminal it asks')
  .argument('[prompt...]', 'style, instruments, tempo, mood, lyrics')
  .option('-m, --model <id>', 'music model', MUSIC_MODEL)
  .addOption(privacyOption())
  .action(async (words: string[], o, cmd: Command) => {
    p.intro(pc.inverse(' darkroom · music '));
    const run: MusicRun = { privacy: o.privacy, model: o.model, prompt: words.join(' ').trim() };
    if (!run.prompt) {
      if (!interactive) missing('Describe the music');
      const fixed = explicitOptions(run, sourceOf(cmd), { privacy: 'privacy', model: 'model' });
      await interactiveMode(clackPrompter, 'music', { music: fixed });
    }
    setExitCode(await runMusicRun(run));
    p.outro(pc.dim('Done'));
  });

program
  .command('models')
  .description('Image, speech or music models with price, ZDR status and capabilities')
  .addArgument(new Argument('[kind]', 'which models').choices(MODEL_KINDS).default('image'))
  .option('--all', 'image models: include models without reference images')
  .option('--search <text>', 'filter by id or name')
  .addOption(privacyOption('privacy mode the models are checked against: zdr | zdr-strict | off'))
  .action((kind, o) => showModels(kind, o));

program
  .command('voices')
  .description('Own voices, or the voices of a speech model by language (with your own voices)')
  .argument('[model]', 'speech model, e.g. elevenlabs/eleven-v4')
  .action((model?: string) => showVoices(model));

program
  .command('elements')
  .description('Reference sets in refs/')
  .action(() => showElements());

program
  .command('costs')
  .description('Cost total per model from out/manifest.jsonl')
  .action(() => showCosts());

program
  .command('start')
  .description(`Start the web UI on http://localhost:${PORT} (Ctrl+C stops it)`)
  .action(() => startWeb());

try {
  // Plain `darkroom` in a terminal opens the main menu; elsewhere commander prints the help as before
  if (process.argv.length <= 2 && interactive) {
    p.intro(pc.inverse(' darkroom '));
    await interactiveMode(clackPrompter, 'menu');
  }
  await program.parseAsync();
} catch (err) {
  failSpinner();
  p.log.error((err as Error).message);
  // Exit right away: background work of the failed command (catalog requests, timers) must not keep it running
  process.exit(1);
}
