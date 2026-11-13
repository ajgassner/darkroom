#!/usr/bin/env node
// darkroom CLI: generate images, speech and music from the terminal (same core as the web UI).
// Without the required input in a terminal it asks interactively (see studio.ts); scripts never get a prompt.
// --json prints one JSON document instead (json.ts), and `darkroom skill` prints the guide for AI agents (skill.ts).
import './no-color.ts';
import {
  APP_VERSION,
  DEFAULT_MODEL,
  DEFAULT_PRIVACY,
  OUT_DIR,
  PORT,
  type PrivacyMode,
  parsePrivacy,
} from '@darkroom/core/config';
import type { ManifestEntry, ModelKind } from '@darkroom/core/contract';
import { AppError } from '@darkroom/core/errors';
import { MODEL_KINDS } from '@darkroom/core/models/favorites';
import { costSummary, readEntries } from '@darkroom/core/storage/manifest';
import { Argument, Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import pc from 'picocolors';
import { collect, explicitOptions, floatArg, intArg, parseModels, resolveRefs, sizeArg } from './args.ts';
import type { ImageRun, MusicRun, SpeechRun } from './command-line.ts';
import { failureDocument, printJson, type RunKind, runDocument } from './json.ts';
import { EXIT, jsonMode } from './mode.ts';
import { out } from './out.ts';
import { skillGuide } from './skill.ts';
import {
  addFavorite,
  interactiveMode,
  MUSIC_MODEL,
  previewVoice,
  removeFavorite,
  runImage,
  runMusicRun,
  runSpeechRun,
  SPEECH_MODEL,
  showCosts,
  showElements,
  showFavorites,
  showModels,
  showVoices,
  startWeb,
  totalLine,
} from './studio.ts';
import { cancelled, clackPrompter, failSpinner, interactive } from './term.ts';

function privacyOption(description = 'zdr | zdr-strict | off') {
  return new Option('--privacy <mode>', description).default(DEFAULT_PRIVACY).argParser((v): PrivacyMode => {
    const mode = parsePrivacy(v);
    if (!mode) throw new InvalidArgumentError('must be zdr, zdr-strict or off');
    return mode;
  });
}

/** --json on the commands that print data or results. */
const jsonOption = () =>
  new Option('--json', 'print one JSON document on stdout, never ask (for scripts and AI agents; see darkroom skill)');

/** A required text is missing outside a terminal: an error, as scripts and agents must never get a prompt. */
function missing(what: string): never {
  throw new AppError('missing_argument', `${what} (missing argument)`, { argument: what });
}

/** After a run: exit code 1 when it delivered nothing but errors; the JSON document or the closing line. */
async function finish(kind: RunKind, entries: ManifestEntry[], outro: () => Promise<string> | string) {
  if (entries.length && !entries.some((e) => e.ok)) process.exitCode = EXIT.failed;
  if (jsonMode) return printJson(runDocument(kind, entries, costSummary(await readEntries()), OUT_DIR));
  out.outro(pc.dim(await outro()));
}

/** Where a command's option values came from ('cli' when given on the command line). */
const sourceOf = (cmd: Command) => (key: string) => cmd.getOptionValueSource(key);

export const program = new Command()
  .name('darkroom')
  .description(
    'Local, private images and audio with your own references via OpenRouter.\nWithout a command in a terminal: interactive menu.',
  )
  .version(APP_VERSION)
  .showHelpAfterError();
// --json: invalid arguments become the JSON error document (see the catch below) instead of commander's text
if (jsonMode) program.exitOverride().configureOutput({ writeErr: () => {} });

// The installed darkroom command handles "darkroom update" and "darkroom uninstall [--yes]" itself (they replace
// or remove the app the CLI runs from). They reach the CLI only with other arguments (like --help) or in a git
// checkout.
const checkoutHint = (what: string, installed: string, checkout: string) => () =>
  out.info(`To ${what} an installed darkroom, run: ${installed}\nIn a git checkout: ${checkout}`);
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
  .option('-s, --size <tier>', 'size: 512 | 768 | 1K | 1.5K | 2K | 4K (models support some of them)', sizeArg)
  .option('-n, --count <n>', 'images per model (1–10)', intArg(1, 10), 1)
  .option('-f, --format <fmt>', 'file format: png | jpeg | webp (if supported)')
  .option('-q, --quality <q>', 'quality: low | medium | high (e.g. GPT Image)')
  .option('--seed <n>', 'seed (if supported)', intArg(0, 2 ** 31))
  .option('-r, --ref <file>', 'additional reference image (path or file from out/); repeat for several', collect)
  .option('--no-prefix', 'do not prepend the element instructions')
  .option('--max-side <px>', 'longest side of the references', intArg(256, 4096))
  .addOption(privacyOption())
  .addOption(jsonOption())
  .action(async (words: string[], o, cmd: Command) => {
    out.intro(pc.inverse(' darkroom · images '));
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
    await finish('image', await runImage(run), totalLine);
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
  .addOption(jsonOption())
  .action(async (words: string[], o, cmd: Command) => {
    out.intro(pc.inverse(' darkroom · speech '));
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
    await finish('speech', await runSpeechRun(run), () => 'Done');
  });

program
  .command('preview')
  .description('Listen to a voice: a sample sentence in its language (previews of model voices are cached)')
  .argument('[text...]', 'own text instead of the sample sentence (always generated)')
  .option('-m, --model <id>', 'speech model', SPEECH_MODEL)
  .option('-v, --voice <voice>', 'model voice, or voice:<name> for an own voice (default: the model default voice)')
  .option('--no-play', 'do not play it, only print the path of the audio file')
  .addOption(privacyOption())
  .addOption(jsonOption())
  .addHelpText(
    'after',
    '\nPlays with afplay (macOS), paplay, aplay or ffplay (Linux) or PowerShell (Windows); without a player it\n' +
      'prints the path. Ctrl+C stops the playback. List the voices of a model: darkroom voices <model>',
  )
  .action(async (words: string[], o) => {
    out.intro(pc.inverse(' darkroom · voice preview '));
    const request = { model: o.model, voice: o.voice ?? '', text: words.join(' '), privacy: o.privacy };
    const preview = await previewVoice(request, { play: o.play });
    if (preview.playback === 'stopped') cancelled('Stopped');
    if (jsonMode) {
      const { file, cached, playback } = preview;
      return printJson({ ok: true, file, model: request.model, voice: request.voice || null, cached, playback });
    }
    out.outro(pc.dim('Done'));
  });

program
  .command('music')
  .description('Generate a music clip (Google Lyria); without a prompt in a terminal it asks')
  .argument('[prompt...]', 'style, instruments, tempo, mood, lyrics')
  .option('-m, --model <id>', 'music model', MUSIC_MODEL)
  .addOption(privacyOption())
  .addOption(jsonOption())
  .action(async (words: string[], o, cmd: Command) => {
    out.intro(pc.inverse(' darkroom · music '));
    const run: MusicRun = { privacy: o.privacy, model: o.model, prompt: words.join(' ').trim() };
    if (!run.prompt) {
      if (!interactive) missing('Describe the music');
      const fixed = explicitOptions(run, sourceOf(cmd), { privacy: 'privacy', model: 'model' });
      await interactiveMode(clackPrompter, 'music', { music: fixed });
    }
    await finish('music', await runMusicRun(run), () => 'Done');
  });

program
  .command('models')
  .description('Image, speech or music models with price, ZDR status and capabilities')
  .addArgument(new Argument('[kind]', 'which models').choices(MODEL_KINDS).default('image'))
  .option('--all', 'image models: include models without reference images')
  .option('--search <text>', 'filter by id or name')
  .option('--details', 'all parameters per model: sizes, aspect ratios, references, formats, voices, …')
  .addOption(privacyOption('privacy mode the models are checked against: zdr | zdr-strict | off'))
  .addOption(jsonOption())
  .action((kind, o) => showModels(kind, o));

const favorites = program
  .command('favorites')
  .description('Your favorite models (listed first everywhere): list, add or remove')
  .addArgument(new Argument('[kind]', 'only this kind').choices(MODEL_KINDS))
  .addHelpText(
    'after',
    '\nExamples:\n  darkroom favorites add microsoft/mai-image-2.6\n  darkroom favorites remove microsoft/mai-image-2.6\n' +
      '  darkroom favorites speech\nStored in favorites.json in the data folder, shared with the web UI.',
  )
  .addOption(jsonOption())
  .action((kind?: ModelKind) => showFavorites(kind));
const kindOption = () =>
  new Option('--kind <kind>', 'image | speech | music (default: found in the catalogs)').choices(MODEL_KINDS);
favorites
  .command('add')
  .description('Add a model to the favorites')
  .argument('<model>', 'model id, e.g. microsoft/mai-image-2.6')
  .addOption(kindOption())
  .addOption(jsonOption())
  .action((model: string, o: { kind?: ModelKind }) => addFavorite(model, o.kind));
favorites
  .command('remove')
  .alias('rm')
  .description('Remove a model from the favorites')
  .argument('<model>', 'model id')
  .addOption(kindOption())
  .addOption(jsonOption())
  .action((model: string, o: { kind?: ModelKind }) => removeFavorite(model, o.kind));

program
  .command('voices')
  .description('Own voices, or the voices of a speech model by language (with your own voices)')
  .argument('[model]', 'speech model, e.g. elevenlabs/eleven-v4')
  .addOption(jsonOption())
  .action((model?: string) => showVoices(model));

program
  .command('elements')
  .description('Reference sets in refs/')
  .addOption(jsonOption())
  .action(() => showElements());

program
  .command('costs')
  .description('Cost total per model from out/manifest.jsonl')
  .addOption(jsonOption())
  .action(() => showCosts());

program
  .command('skill')
  .description('Print the usage guide for AI agents (Markdown, matches this version)')
  .addHelpText(
    'after',
    '\nTell your AI agent (Claude Code, Codex, Gemini CLI, Cursor, …): "run `darkroom skill` and use it".',
  )
  .action(() => void process.stdout.write(skillGuide(program)));

program
  .command('start')
  .description(`Start the web UI on http://localhost:${PORT} (Ctrl+C stops it)`)
  .action(() => startWeb());

/** Help and --version end commander with exit code 0 (with --json they come here as an error). */
const helpShown = (err: unknown) => err instanceof CommanderError && err.exitCode === EXIT.ok;

if (import.meta.main) {
  try {
    // Plain `darkroom` in a terminal opens the main menu; elsewhere commander prints the help as before
    if (process.argv.length <= 2 && interactive) {
      out.intro(pc.inverse(' darkroom '));
      await interactiveMode(clackPrompter, 'menu');
    }
    await program.parseAsync();
  } catch (err) {
    if (helpShown(err)) process.exit(EXIT.ok);
    failSpinner();
    if (jsonMode) printJson(failureDocument(err));
    else out.error((err as Error).message);
    // Exit right away: background work of the failed command (catalog requests, timers) must not keep it running
    process.exit(EXIT.failed);
  }
}
