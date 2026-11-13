// Interactive mode: the questions for an image, speech or music run, the next steps after a run and the main menu.
// Prompts go through a Prompter (clack in the terminal, a script in tests); Escape goes back one question.
import type { PrivacyMode } from '@darkroom/core/config';
import type { ElementInfo, MusicModel, SpeechModel, VoiceInfo } from '@darkroom/core/contract';
import {
  aspectChoices,
  type CatalogImageModel,
  type Choice,
  COUNT_CHOICES,
  imageModelChoices,
  imageSummary,
  initialValue,
  initialValues,
  musicModelChoices,
  musicSummary,
  PRIVACY_CHOICES,
  SPEED_CHOICES,
  sizeChoices,
  speechModelChoices,
  speechSummary,
  takesInstructions,
  voiceChoices,
} from './choices.ts';
import type { ImageRun, MusicRun, SpeechRun } from './command-line.ts';

/** Escape at a prompt: go back one question. */
export const BACK: unique symbol = Symbol('back');
export type Back = typeof BACK;

export interface Prompter {
  select<T>(o: { message: string; options: Choice<T>[]; initialValue?: T }): Promise<T | Back>;
  /** Single choice from a long list, filtered by typing. */
  search(o: { message: string; options: Choice<string>[]; initialValue?: string }): Promise<string | Back>;
  /** Several choices from a long list, filtered by typing (at least one). */
  searchMany(o: { message: string; options: Choice<string>[]; initialValues?: string[] }): Promise<string[] | Back>;
  text(o: { message: string; placeholder?: string; initialValue?: string; optional?: boolean }): Promise<string | Back>;
  confirm(o: { message: string; initialValue?: boolean }): Promise<boolean | Back>;
  note(lines: string[], title: string): void;
  info(message: string): void;
}

const SKIP = Symbol('skip');
const DONE = Symbol('done');
type StepResult = typeof SKIP | typeof DONE | Back;
type Step = () => Promise<StepResult>;

/**
 * Run the questions in order: BACK returns to the previous question that was asked (skipped ones are passed
 * over in both directions). false when the user went back from the first question.
 */
async function runSteps(steps: Step[]): Promise<boolean> {
  let dir = 1;
  for (let i = 0; i < steps.length; ) {
    if (i < 0) return false;
    const r = await steps[i]();
    if (r === BACK) dir = -1;
    else if (r === DONE) dir = 1;
    i += dir;
  }
  return true;
}

/** One question: skipped when its value was given on the command line, otherwise asked and stored. */
async function step<T>(skip: boolean, ask: () => Promise<T | Back>, set: (v: T) => void): Promise<StepResult> {
  if (skip) return SKIP;
  const v = await ask();
  if (v === BACK) return BACK;
  set(v);
  return DONE;
}

/** A select for short lists, a searchable list for long ones. */
function pick(ui: Prompter, message: string, options: Choice<string>[], initial?: string): Promise<string | Back> {
  const o = { message, options, initialValue: initialValue(options, initial) };
  return options.length > 10 ? ui.search(o) : ui.select(o);
}

async function confirmStep(ui: Prompter, title: string, summary: string[], message: string): Promise<StepResult> {
  ui.note(summary, title);
  const ok = await ui.confirm({ message, initialValue: true });
  return ok === true ? DONE : BACK;
}

const given = <T extends object>(fixed: Partial<T>, key: keyof T) => fixed[key] !== undefined;

function privacyStep(ui: Prompter, fixed: { privacy?: PrivacyMode }, d: { privacy: PrivacyMode }): Step {
  return () =>
    step(
      given(fixed, 'privacy'),
      () => ui.select({ message: 'Privacy', options: PRIVACY_CHOICES, initialValue: d.privacy }),
      (v) => (d.privacy = v),
    );
}

/** What a question flow needs: values from the command line (not asked) and pre-filled answers. */
interface Ask<R> {
  fixed: Partial<R>;
  initial: Partial<R>;
  /** Default privacy mode (config/env). */
  privacy: PrivacyMode;
}

export interface ImageAsk extends Ask<ImageRun> {
  defaultModel: string;
  /** Catalog incl. ZDR and prices (loading it may show a spinner). */
  models: () => Promise<CatalogImageModel[]>;
  elements: ElementInfo[];
  estimate: (run: ImageRun, models: CatalogImageModel[]) => string;
}

export async function askImage(ui: Prompter, a: ImageAsk): Promise<ImageRun | Back> {
  const d: ImageRun = { privacy: a.privacy, models: [a.defaultModel], element: null, count: 1, prompt: '' };
  Object.assign(d, a.initial, a.fixed);
  const catalog = await a.models();
  const chosen = () => catalog.filter((m) => d.models.includes(m.id));
  const modelStep = async (): Promise<StepResult> => {
    if (given(a.fixed, 'models')) return SKIP;
    const options = imageModelChoices(catalog, d.privacy);
    if (!options.length) {
      ui.info(`No image model with reference support is allowed in privacy mode "${d.privacy}".`);
      return BACK;
    }
    return step(
      false,
      () => ui.searchMany({ message: 'Models', options, initialValues: initialValues(options, d.models) }),
      (v) => (d.models = v),
    );
  };
  const paramStep =
    (key: 'aspect' | 'size', message: string, choices: (m: CatalogImageModel[]) => Choice<string>[]) => async () => {
      const options = choices(chosen());
      return step(
        given(a.fixed, key) || !options.length,
        () => ui.select({ message, options, initialValue: initialValue(options, d[key]) }),
        (v) => (d[key] = v || undefined),
      );
    };
  const ok = await runSteps([
    privacyStep(ui, a.fixed, d),
    modelStep,
    () =>
      step(
        given(a.fixed, 'element') || /@\w/.test(a.fixed.prompt ?? '') || !a.elements.length,
        () =>
          ui.select<string>({
            message: 'Element (or use @name in the prompt)',
            options: [
              { value: '', label: 'none' },
              ...a.elements.map((e) => ({
                value: e.name,
                label: `@${e.name}`,
                hint: `${e.type}, ${e.photos.length} images`,
              })),
            ],
            initialValue: d.element ?? '',
          }),
        (v) => (d.element = v || null),
      ),
    paramStep('aspect', 'Aspect ratio', aspectChoices),
    paramStep('size', 'Size', sizeChoices),
    () =>
      step(
        given(a.fixed, 'count'),
        () => ui.select({ message: 'Images per model', options: COUNT_CHOICES, initialValue: d.count }),
        (v) => (d.count = v),
      ),
    () =>
      step(
        given(a.fixed, 'prompt'),
        () =>
          ui.text({
            message: 'Prompt (@name includes an element)',
            placeholder: 'Business portrait in a bright office, soft window light',
            initialValue: d.prompt,
          }),
        (v) => (d.prompt = v),
      ),
    () => confirmStep(ui, 'Image run', imageSummary(d, a.estimate(d, catalog)), 'Generate now?'),
  ]);
  return ok ? d : BACK;
}

export interface SpeechAsk extends Ask<SpeechRun> {
  defaultModel: string;
  models: () => Promise<SpeechModel[]>;
  ownVoices: VoiceInfo[];
  estimate: (run: SpeechRun, model: SpeechModel | undefined) => string;
}

export async function askSpeech(ui: Prompter, a: SpeechAsk): Promise<SpeechRun | Back> {
  const d: SpeechRun = { privacy: a.privacy, model: a.defaultModel, text: '' };
  Object.assign(d, a.initial, a.fixed);
  const models = await a.models();
  const model = () => models.find((m) => m.id === d.model);
  const modelStep = async (): Promise<StepResult> => {
    if (given(a.fixed, 'model')) return SKIP;
    const options = speechModelChoices(models, d.privacy);
    if (!options.length) {
      ui.info(`No speech model is allowed in privacy mode "${d.privacy}".`);
      return BACK;
    }
    return step(
      false,
      () => pick(ui, 'Speech model', options, d.model),
      (v) => (d.model = v),
    );
  };
  const voiceStep = async (): Promise<StepResult> => {
    const m = model();
    const options = m ? voiceChoices(m, a.ownVoices) : [];
    // Nothing to choose: keep the only voice (or the model default)
    if (!given(a.fixed, 'voice') && options.length < 2) d.voice = options[0]?.value || undefined;
    return step(
      given(a.fixed, 'voice') || options.length < 2,
      () => pick(ui, 'Voice', options, d.voice),
      (v) => (d.voice = v || undefined),
    );
  };
  const ok = await runSteps([
    privacyStep(ui, a.fixed, d),
    modelStep,
    voiceStep,
    () =>
      step(
        given(a.fixed, 'text'),
        () => ui.text({ message: 'Text', placeholder: 'Hello! This is a short test.', initialValue: d.text }),
        (v) => (d.text = v),
      ),
    () =>
      step(
        given(a.fixed, 'instructions') || !takesInstructions(d.model),
        () =>
          ui.text({
            message: 'Delivery instructions (optional)',
            placeholder: 'e.g. calm and warm, slightly slower',
            initialValue: d.instructions,
            optional: true,
          }),
        (v) => (d.instructions = v || undefined),
      ),
    () =>
      step(
        given(a.fixed, 'speed'),
        () =>
          ui.select({
            message: 'Speed',
            options: SPEED_CHOICES,
            initialValue: initialValue(SPEED_CHOICES, d.speed, 1),
          }),
        (v) => (d.speed = v === 1 ? undefined : v),
      ),
    () => confirmStep(ui, 'Speech', speechSummary(d, a.estimate(d, model())), 'Speak now?'),
  ]);
  return ok ? d : BACK;
}

export interface MusicAsk extends Ask<MusicRun> {
  defaultModel: string;
  models: () => Promise<MusicModel[]>;
  estimate: (run: MusicRun) => string;
}

export async function askMusic(ui: Prompter, a: MusicAsk): Promise<MusicRun | Back> {
  const d: MusicRun = { privacy: a.privacy, model: a.defaultModel, prompt: '' };
  Object.assign(d, a.initial, a.fixed);
  const models = await a.models();
  const modelStep = async (): Promise<StepResult> => {
    if (given(a.fixed, 'model')) return SKIP;
    const options = musicModelChoices(models, d.privacy);
    if (!options.length) {
      ui.info(`No music model is allowed in privacy mode "${d.privacy}". Choose "off" to use one without ZDR.`);
      return BACK;
    }
    if (options.length === 1) d.model = options[0].value;
    return step(
      options.length === 1,
      () => pick(ui, 'Music model', options, d.model),
      (v) => (d.model = v),
    );
  };
  const ok = await runSteps([
    privacyStep(ui, a.fixed, d),
    modelStep,
    () =>
      step(
        given(a.fixed, 'prompt'),
        () =>
          ui.text({
            message: 'Describe the music (style, instruments, tempo, mood, lyrics)',
            placeholder: 'calm acoustic guitar jingle, 120 bpm',
            initialValue: d.prompt,
          }),
        (v) => (d.prompt = v),
      ),
    () => confirmStep(ui, 'Music', musicSummary(d, a.estimate(d)), 'Compose now?'),
  ]);
  return ok ? d : BACK;
}

type NextStep = 'open' | 'again' | 'change' | 'menu' | 'quit';

function nextStepChoices(canOpen: boolean): Choice<NextStep>[] {
  return [
    ...(canOpen ? [{ value: 'open' as const, label: 'Open the result' }] : []),
    { value: 'again', label: 'Run again', hint: 'same settings' },
    { value: 'change', label: 'Change settings and run again' },
    { value: 'menu', label: 'Main menu' },
    { value: 'quit', label: 'Quit' },
  ];
}

/** One kind of run in the interactive mode. */
export interface Mode<R> {
  /** Ask for the run (pre-filled with `previous` when changing settings). */
  ask(previous?: R): Promise<R | Back>;
  /** Run it and return the result files. */
  run(r: R): Promise<string[]>;
}

/**
 * Ask, run, then offer next steps until the user leaves: 'menu' or 'quit', or BACK when the first question
 * was left with Escape (nothing ran).
 */
export async function session<R>(
  ui: Prompter,
  mode: Mode<R>,
  open?: (files: string[]) => void,
): Promise<'menu' | 'quit' | Back> {
  let run = await mode.ask();
  if (run === BACK) return BACK;
  let files = await mode.run(run);
  for (;;) {
    const next = await ui.select({ message: 'What next?', options: nextStepChoices(Boolean(open && files.length)) });
    if (next === 'open') open?.(files);
    else if (next === 'again') files = await mode.run(run);
    else if (next === 'change') {
      const changed = await mode.ask(run);
      if (changed !== BACK) {
        run = changed;
        files = await mode.run(run);
      }
    } else return next === 'quit' ? 'quit' : 'menu';
  }
}

export type MenuItem = 'image' | 'speech' | 'music' | 'models' | 'library' | 'costs' | 'web' | 'quit';

const MENU: Choice<MenuItem>[] = [
  { value: 'image', label: 'Image', hint: 'generate images, several models in parallel' },
  { value: 'speech', label: 'Speech', hint: 'text to speech with model or own voices' },
  { value: 'music', label: 'Music', hint: 'a music clip' },
  { value: 'models', label: 'Models', hint: 'image, speech and music models with price and ZDR status' },
  { value: 'library', label: 'Elements & voices', hint: 'your reference sets and voices' },
  { value: 'costs', label: 'Costs', hint: 'spent per model' },
  { value: 'web', label: 'Open the web UI' },
  { value: 'quit', label: 'Quit' },
];

/** The main menu: runs the chosen action until it returns 'quit' or the user quits (Escape or "Quit"). */
export async function mainMenu(
  ui: Prompter,
  actions: Record<Exclude<MenuItem, 'quit'>, () => Promise<'menu' | 'quit' | Back | undefined>>,
): Promise<void> {
  let last: MenuItem = 'image';
  for (;;) {
    const item: MenuItem | Back = await ui.select({
      message: 'What do you want to do?',
      options: MENU,
      initialValue: last,
    });
    if (item === BACK || item === 'quit') return;
    last = item;
    if ((await actions[item]()) === 'quit') return;
  }
}
