// Run a worker script (background removal, local transcription) as a separate Node process.
// Workers load native libraries that must not share a process with the server's own sharp/libvips.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { CORE_SRC_DIR, ROOT } from '../config.ts';
import { AppError } from '../errors.ts';

const execFileP = promisify(execFile);

interface WorkerOptions {
  timeout: number;
  /** Cancel button, closed browser, server shutdown: kills the worker. */
  signal?: AbortSignal;
  notInstalled: () => AppError;
  failed: (message: string) => AppError;
}

type ExecError = Error & { stderr?: string; killed?: boolean; signal?: NodeJS.Signals | null; code?: unknown };

/** Last meaningful line of the error output (skips stack frames). */
function lastLine(msg: string): string {
  return (
    msg
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('at '))
      .slice(-1)[0] ?? ''
  );
}

/** The error to report for a failed worker run. */
function workerError(e: ExecError, opts: WorkerOptions): AppError {
  if (opts.signal?.aborted) return new AppError('aborted', 'Aborted');
  const msg = String(e.stderr || e.message);
  if (msg.includes('Cannot find package') || msg.includes('ERR_MODULE_NOT_FOUND')) return opts.notInstalled();
  // Killed by Node itself: the timeout ran out (too much output kills it as well, but has its own code)
  if (e.killed && e.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    const seconds = Math.ceil(opts.timeout / 1000);
    return new AppError('worker_timeout', `The local process took longer than ${seconds} s and was stopped`, {
      seconds,
    });
  }
  if (e.signal) return opts.failed(`process ended by ${e.signal}`);
  return opts.failed(lastLine(msg));
}

/** Run `script` (relative to core's src/, or absolute) and return its stdout. */
export async function runWorker(script: string, args: string[], opts: WorkerOptions): Promise<string> {
  try {
    const { stdout } = await execFileP(process.execPath, [path.resolve(CORE_SRC_DIR, script), ...args], {
      timeout: opts.timeout,
      signal: opts.signal,
      cwd: ROOT,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  } catch (e) {
    throw workerError(e as ExecError, opts);
  }
}
