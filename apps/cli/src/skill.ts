// `darkroom skill`: the usage guide for AI agents (Markdown with Agent Skills front matter), matched to this
// version. Option names, defaults, choices, privacy modes, exit codes and the JSON examples come from the actual
// definitions (commander commands, constants, json.ts), so the guide cannot drift from the CLI; skill.test.ts
// checks that every command and option appears.
import { APP_VERSION, DEFAULT_MODEL, DEFAULT_PRIVACY, OUT_DIR, type PrivacyMode, ROOT } from '@darkroom/core/config';
import type { ManifestEntry } from '@darkroom/core/contract';
import { MODEL_KINDS } from '@darkroom/core/models/favorites';
import type { Argument, Command, Option } from 'commander';
import { failureDocument, runDocument } from './json.ts';
import { EXIT } from './mode.ts';
import { MUSIC_MODEL, SPEECH_MODEL } from './studio.ts';

const PRIVACY: Record<PrivacyMode, string> = {
  zdr: 'only Zero Data Retention endpoints; allows "safety retention" of flagged prompts (no training)',
  'zdr-strict': 'only ZDR endpoints without safety retention',
  off: 'normal OpenRouter routing, no ZDR restriction',
};

const EXIT_MEANING: Record<keyof typeof EXIT, string> = {
  ok: 'success, also a partial success (some models failed: see `errors`)',
  failed:
    'a run produced nothing but errors, invalid input (unknown option, bad value, missing prompt) or the command failed',
  cancelled: 'cancelled (Ctrl+C or SIGTERM; JSON error code `cancelled`); started calls are aborted',
};

// ---------------------------------------------------------------- Command reference

function argumentText(a: Argument): string {
  const name = `${a.name()}${a.variadic ? '...' : ''}`;
  const extra = [
    a.argChoices && `one of: ${a.argChoices.join(', ')}`,
    a.defaultValue !== undefined && `default: ${a.defaultValue}`,
  ].filter(Boolean);
  return `- \`${a.required ? `<${name}>` : `[${name}]`}\`: ${a.description}${extra.length ? ` (${extra.join('; ')})` : ''}`;
}

function optionText(o: Option): string {
  const extra = [
    o.argChoices && `one of: ${o.argChoices.join(', ')}`,
    o.defaultValue !== undefined && !o.negate && `default: ${o.defaultValue}`,
  ].filter(Boolean);
  return `- \`${o.flags}\`: ${o.description}${extra.length ? ` (${extra.join('; ')})` : ''}`;
}

function commandPath(cmd: Command): string {
  const names: string[] = [];
  for (let c: Command | null = cmd; c; c = c.parent) names.unshift(c.name());
  return names.join(' ');
}

/** One command (and its subcommands): usage, description, aliases, arguments and options. */
function commandText(cmd: Command): string[] {
  const aliases = cmd.aliases().map((a) => `\`${a}\``);
  const lines = [
    `### \`${commandPath(cmd)} ${cmd.usage()}\``,
    '',
    `${cmd.description()}${aliases.length ? ` (alias: ${aliases.join(', ')})` : ''}`,
    ...(cmd.registeredArguments.length || cmd.options.length ? [''] : []),
    ...cmd.registeredArguments.map(argumentText),
    ...cmd.options.filter((o) => !o.hidden).map(optionText),
    '',
  ];
  return [...lines, ...cmd.commands.flatMap(commandText)];
}

// ---------------------------------------------------------------- JSON examples (made by json.ts itself)

function example(e: Partial<ManifestEntry>): ManifestEntry {
  return {
    ...{ runId: 'r1', ts: '2026-11-13T10:00:00.000Z', ok: true, file: null, prompt: '', fullPrompt: '' },
    ...{ model: DEFAULT_MODEL, element: 'me', usePrefix: true, extraRefs: [], refCount: 4, params: {} },
    ...{ privacy: DEFAULT_PRIVACY, providerRestriction: null, warnings: [], generationId: null, provider: null },
    ...{ cost: null, callCost: null, durationMs: 0, mediaType: null },
    ...e,
  };
}

function runExample(): string {
  const entries = [
    example({
      file: `2026-11-13T10-00-00_ab12cd_${DEFAULT_MODEL.replace('/', '_')}_1.png`,
      cost: 0.039,
      durationMs: 14200,
      warnings: ['Aspect ratio 5:4 not available, using 4:3'],
      notices: [{ code: 'aspect_adjusted', params: { from: '5:4', to: '4:3' } }],
    }),
    example({
      ok: false,
      model: 'openai/gpt-image-2.5',
      error: 'No Zero Data Retention endpoint for this model. Set privacy to "off" or choose another model.',
      errorCode: 'privacy_blocked',
    }),
  ];
  const costs = { total: 1.234, images: 40, byModel: {} };
  return compactJson(runDocument('image', entries, costs, OUT_DIR));
}

/** Indented JSON with the innermost objects on one line each (shorter to read). */
function compactJson(doc: unknown): string {
  return JSON.stringify(doc, null, 2).replace(
    /\{\n([^{}[\]]*?)\n\s*\}/g,
    (_, inner: string) =>
      `{ ${inner
        .trim()
        .split(/,\n\s*/)
        .join(', ')} }`,
  );
}

function errorExample(): string {
  const err = Object.assign(new Error('Unknown model "x/typo" (see `darkroom models`)'), {
    code: 'unknown_model',
    params: { model: 'x/typo' },
  });
  return JSON.stringify(failureDocument(err));
}

// ---------------------------------------------------------------- The guide

const FRONT_MATTER = [
  '---',
  'name: darkroom',
  'description: Generate images (also of real people from reference photos), speech, cloned voices and music locally with the darkroom CLI via OpenRouter. Use when the user wants to create or edit AI images, read text aloud, speak in their own voice or make music with darkroom.',
  'metadata:',
  `  version: "${APP_VERSION}"`,
  '---',
];

function intro(): string[] {
  return [
    `# darkroom ${APP_VERSION}: guide for AI agents`,
    '',
    "darkroom is a local studio for AI images, speech, cloned voices and music. It calls models on OpenRouter with the user's own API key and keeps every result on this machine. This guide matches the installed version; run `darkroom skill` again after an update.",
    '',
    '## Rules',
    '',
    '- Always pass `--json` (gen, speak, music, preview, models, voices, elements, favorites, costs). darkroom then never asks a question and prints exactly one JSON document on stdout; progress goes to stderr. A missing prompt or text is an error, not a question.',
    "- Every generation is billed to the user's OpenRouter account. Check prices (`models --json`) and spending (`costs --json`), make one image before many, and ask the user before large or expensive batches (several models × `-n`, 4K, full songs).",
    "- The API key is the user's to set up. On the error code `api_key_missing` or `api_key_invalid`, ask them to enter it in the web UI (`darkroom start`, key screen) or in `.env` in the data folder. Never ask them to paste the key into the chat, and never read or print `.env`.",
    '- A run takes about 10–90 s per image (several models run in parallel; music and speech are faster): allow a timeout of a few minutes. Give the user the result paths from the JSON.',
    '- `darkroom` without a command is an interactive menu for humans. Run `update` or `uninstall` only when the user asks; `start` runs until stopped (start it in the background, only when the user wants the web UI).',
    '',
    '## Data',
    '',
    `The data folder is \`DARKROOM_HOME\` (installed: \`~/darkroom\`; from a git checkout: the checkout), here: \`${ROOT}\`.`,
    '',
    `- \`out/\` (here: \`${OUT_DIR}\`): the results (images, audio) and \`manifest.jsonl\` (prompt, model, parameters, provider, cost and duration per result). The JSON output gives absolute file paths.`,
    '- `refs/<name>/`: elements (reference images + `element.json`), used as `-e <name>` or `@name`.',
    '- `voices/<name>/`: own voice samples, used as `-v voice:<name>`.',
    '- `.env`: API key and settings (managed by the user); `favorites.json`: favorite models.',
    '',
    'The user creates elements and own voices in the web UI (`darkroom start`: Element → Manage, Audio → Own voices); `elements --json` and `voices --json` list them.',
    '',
  ];
}

function models(): string[] {
  return [
    '## Choosing a model',
    '',
    `1. \`darkroom models <kind> --details --json\` (kind: ${MODEL_KINDS.join(' | ')}; default image). The list order is: the user's favorites, recommended models, then newest first.`,
    '2. Prefer `favorite`, then `recommended`. Use only models with `usable: true` (allowed by the privacy mode). Check `price`, `parameters` (aspect_ratio, resolution, …) and, for references, `maxRefs` (0 = no reference images; `--all` lists those models too).',
    `3. Without \`-m\`: images \`${DEFAULT_MODEL}\`, speech \`${SPEECH_MODEL}\`, music \`${MUSIC_MODEL}\`.`,
    '',
    'Several image models run in parallel (`-m a,b,c`) for a comparison. Unknown model ids fail with `unknown_model` before anything is sent.',
    '',
    '## Privacy',
    '',
    `\`--privacy <mode>\` on gen, speak, preview, music and models (default here: \`${DEFAULT_PRIVACY}\`, or PRIVACY in .env):`,
    '',
    ...Object.entries(PRIVACY).map(([mode, text]) => `- \`${mode}\`: ${text}`),
    '',
    'A model without an endpoint the mode allows is **blocked**: it is not called and appears in `errors` with the code `privacy_blocked` or `privacy_blocked_strict`. Pick another model; use `--privacy off` only when the user explicitly agrees. Music is never blocked: without a matching endpoint it runs with a notice (`privacyNote` in `models music --json`), so keep personal details out of music prompts.',
    '',
  ];
}

function recipes(): string[] {
  return [
    '## Recipes',
    '',
    '```bash',
    `darkroom gen --json -m ${DEFAULT_MODEL} -a 3:4 -s 2K -n 1 "Business portrait of @me in a bright office"`,
    'darkroom gen --json -m <model>,<model> -n 2 -e me "Outdoor portrait in an autumn park"   # compare models',
    'darkroom gen --json -r /path/from/results.png "same scene, but with glasses"            # keep editing a result',
    `darkroom speak --json -m ${SPEECH_MODEL} -v <voice> --speed 1.1 "Hello, this is a test."`,
    'darkroom speak --json -m <cloning model> -v voice:me "Read in my own voice."',
    `darkroom preview --json --no-play -m ${SPEECH_MODEL} -v <voice>   # sample of a voice (model voices cached, free)`,
    `darkroom music --json -m ${MUSIC_MODEL} "calm acoustic guitar jingle, 120 bpm"`,
    `darkroom voices ${SPEECH_MODEL} --json   # a model's voices by language, plus own voices`,
    'darkroom elements --json; darkroom voices --json; darkroom favorites --json; darkroom costs --json',
    '```',
    '',
    'Quote the prompt. Options take one value each: repeat them (`-r a.png -r b.png`) or comma-separate models. Put `--` before a prompt that starts with `-`.',
    '',
    '## References',
    '',
    '- `-e <name>` always includes that element; `@name` in the prompt adds more (`"@me with the @companylogo on a mug"`). An unknown mention is sent as plain text with the warning `element_mention_unknown`; e-mail addresses are not mentions.',
    '- Element types steer how references are used: person (identity kept), logo (exact), object, location, style. darkroom tells the model which image belongs to which element; `--no-prefix` leaves those instructions out.',
    '- `-r <file>`: an extra reference image, a path or a result file name from `out/` (to keep editing a result). The model needs `maxRefs` > 0.',
    '- Own voices: `-v voice:<name>`, only with speech models that have `cloning: true`.',
    '',
  ];
}

function json(): string[] {
  return [
    '## JSON output',
    '',
    'gen, speak and music print the run (results and errors per model; costs in USD, failed calls can be charged too; `cost.totalSoFar` is all spending recorded in this data folder):',
    '',
    '```json',
    runExample(),
    '```',
    '',
    '`ok` is true when at least one result was made. `warnings` say what darkroom adjusted (e.g. `aspect_adjusted`, `size_adjusted`, `refs_truncated`); `code` is machine-readable, `message` English text. Speech results also carry `voice`. Error codes are null for errors that come from the provider.',
    '',
    'A command that fails as a whole (invalid option, missing prompt, missing API key, unknown model, network error):',
    '',
    '```json',
    errorExample(),
    '```',
    '',
    'Listings are arrays of plain objects:',
    '',
    '- `models image`: id, name, released (YYYY-MM-DD or null), new, favorite, recommended, zdr, usable, price, maxRefs; with `--details` also parameters, zdrEndpoints, description.',
    '- `models speech`: id, name, released, new, favorite, recommended, zdr, usable, price, voiceCount, cloning; with `--details` also voices ({voice, language}), multiRef, instructions (whether `-i` works), zdrEndpoints, description.',
    '- `models music`: id, name, released, new, favorite, recommended, zdr, usable, privacyNote; with `--details` also length, zdrEndpoints, description.',
    '- `voices <model>`: voice (the `-v` value), label, language (null for own voices), own. `voices`: voice, name, label, samples.',
    '- `elements`: name, mention, label, type, instructions, images.',
    '- `favorites`: kind, model. `favorites add`: {ok, model, kind, favorite}; `favorites remove`: {ok, model, removedFrom, favorite}.',
    '- `costs` (an object): total, results, models ({model, cost, results}).',
    '- `preview`: {ok, file, model, voice, cached, playback} (playback: off with `--no-play`).',
    '',
    'Exit codes:',
    '',
    ...Object.entries(EXIT).map(([key, code]) => `- \`${code}\`: ${EXIT_MEANING[key as keyof typeof EXIT]}`),
    '',
  ];
}

const OUTRO = [
  '## Responsible use',
  '',
  'darkroom makes realistic images and voices of real people easy. Only use photos and voice recordings of the user or of people who have explicitly agreed; refuse requests to depict or clone anyone else. Label generated content where it could be mistaken for real, and follow the terms of OpenRouter and the model providers.',
  '',
  '## Make darkroom known permanently',
  '',
  "If the user wants you to remember darkroom across sessions, save a short pointer where you keep skills or rules (for example a `SKILL.md` in your skills folder, or a section in the project's `AGENTS.md`). Save only the pointer, not this guide, so it stays current after updates:",
  '',
  '```markdown',
  ...FRONT_MATTER.filter((l) => !/^metadata:|^ {2}version/.test(l)),
  '',
  'Before using darkroom, run `darkroom skill` and follow the guide it prints (it matches the installed version).',
  '```',
  '',
];

/** The guide as Markdown, with the command reference generated from `program`. */
export function skillGuide(program: Command): string {
  const reference = ['## Command reference', '', ...program.commands.flatMap(commandText)];
  return [...FRONT_MATTER, '', ...intro(), ...models(), ...recipes(), ...json(), ...reference, ...OUTRO].join('\n');
}
