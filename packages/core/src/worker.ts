// Run a worker script (background removal, local transcription) as a separate Node process.
// Workers load native libraries that must not share a process with the server's own sharp/libvips.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { CORE_SRC_DIR, ROOT } from './config.ts';
import type { AppError } from './errors.ts';

const execFileP = promisify(execFile);

export async function runWorker(
  script: string,
  args: string[],
  opts: { timeout: number; notInstalled: () => AppError; failed: (message: string) => AppError },
): Promise<string> {
  try {
    const { stdout } = await execFileP(process.execPath, [path.join(CORE_SRC_DIR, script), ...args], {
      timeout: opts.timeout,
      cwd: ROOT,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  } catch (e) {
    const msg = String((e as { stderr?: string }).stderr || (e as Error).message);
    if (msg.includes('Cannot find package') || msg.includes('ERR_MODULE_NOT_FOUND')) throw opts.notInstalled();
    // Last meaningful line of the error output (skip stack frames)
    const message = msg
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('at '))
      .slice(-1)[0];
    throw opts.failed(message ?? '');
  }
}
