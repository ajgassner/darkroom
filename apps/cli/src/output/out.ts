// Where the CLI writes. In a terminal: clack's framed output. Otherwise (pipes, scripts, AI agents): plain lines
// without frames or cursor codes, with results and listings on stdout and everything else (progress, totals,
// warnings, errors) on stderr. Errors and warnings go to stderr in a terminal too. With --json stdout only gets the
// one JSON document (see json.ts) and stderr only progress.
import * as p from '@clack/prompts';
import { jsonMode } from './mode.ts';

export interface Output {
  intro(title: string): void;
  outro(text: string): void;
  /** Data: a listing or a block of one (blocks separated by an empty line). */
  message(text: string): void;
  info(text: string): void;
  /** An explanation next to data (a legend, a tip): kept out of stdout in plain mode. */
  hint(text: string): void;
  /** A result. */
  success(text: string): void;
  warn(text: string): void;
  error(text: string): void;
  /** Progress or a total (what a spinner shows in a terminal). */
  status(text: string): void;
  note(lines: string[], title: string): void;
  cancel(text: string): void;
}

interface Writable {
  write(text: string): unknown;
}

/** Plain lines for pipes: results and listings on `stdout`, everything else on `stderr`. */
export function plainOutput(stdout: Writable, stderr: Writable): Output {
  const out = (text: string) => void stdout.write(`${text}\n`);
  const err = (text: string) => void stderr.write(`${text}\n`);
  return {
    intro: () => {},
    outro: err,
    message: out,
    info: out,
    hint: err,
    success: out,
    warn: err,
    error: err,
    status: err,
    note: (lines, title) => out([title, ...lines].join('\n')),
    cancel: err,
  };
}

/**
 * --json: the data, results, warnings and errors are all in the JSON document, so only progress, totals and
 * cancellation reach `stderr` as plain lines; stdout stays free for the document.
 */
export function jsonOutput(stderr: Writable): Output {
  const err = (text: string) => void stderr.write(`${text}\n`);
  const none = () => {};
  return {
    ...{ intro: none, outro: err, message: none, info: none, hint: none, success: none },
    ...{ warn: none, error: none, status: err, note: none, cancel: err },
  };
}

const toStderr = { output: process.stderr };

function clackOutput(): Output {
  return {
    intro: (title) => p.intro(title),
    outro: (text) => p.outro(text),
    message: (text) => p.log.message(text),
    info: (text) => p.log.info(text),
    hint: (text) => p.log.info(text),
    success: (text) => p.log.success(text),
    warn: (text) => p.log.warn(text, toStderr),
    error: (text) => p.log.error(text, toStderr),
    status: (text) => p.log.step(text),
    note: (lines, title) => p.note(lines.join('\n'), title),
    cancel: (text) => p.cancel(text),
  };
}

/** Whether the output is for a terminal (otherwise plain lines, or JSON). */
export const terminal = Boolean(process.stdout.isTTY) && !jsonMode;

function chooseOutput(): Output {
  if (jsonMode) return jsonOutput(process.stderr);
  return terminal ? clackOutput() : plainOutput(process.stdout, process.stderr);
}

export const out: Output = chooseOutput();
