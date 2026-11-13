import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from './errors.ts';
import { runWorker } from './worker.ts';

let dir: string;

/** Write a tiny worker script and return its absolute path. */
async function script(name: string, code: string): Promise<string> {
  const file = path.join(dir, name);
  await fs.writeFile(file, code);
  return file;
}

const opts = {
  timeout: 10_000,
  notInstalled: () => new AppError('x_not_installed', 'not installed'),
  failed: (message: string) => new AppError('x_failed', `failed: ${message}`, { message }),
};

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'darkroom-worker-'));
});
afterAll(() => fs.rm(dir, { recursive: true, force: true }));

describe('runWorker', () => {
  it('returns the output and passes the arguments', async () => {
    const file = await script('echo.mjs', 'process.stdout.write(process.argv.slice(2).join("+"));');
    expect(await runWorker(file, ['a', 'b'], opts)).toBe('a+b');
  });

  it('reports the last line of the error output', async () => {
    const file = await script('fail.mjs', 'console.error("details\\nbroken input"); process.exit(1);');
    await expect(runWorker(file, [], opts)).rejects.toMatchObject({
      code: 'x_failed',
      message: 'failed: broken input',
    });
  });

  it('reports a missing package as not installed', async () => {
    const file = await script('missing.mjs', 'await import("darkroom-no-such-package");');
    await expect(runWorker(file, [], opts)).rejects.toMatchObject({ code: 'x_not_installed' });
  });

  it('reports a timeout with its own code', async () => {
    const file = await script('slow.mjs', 'setTimeout(() => {}, 60_000);');
    await expect(runWorker(file, [], { ...opts, timeout: 300 })).rejects.toMatchObject({
      code: 'worker_timeout',
      params: { seconds: 1 },
    });
  });

  it('reports a worker that ended by a signal', async () => {
    const file = await script('crash.mjs', 'process.kill(process.pid, "SIGKILL");');
    await expect(runWorker(file, [], opts)).rejects.toMatchObject({ message: 'failed: process ended by SIGKILL' });
  });

  it('kills the worker on abort, before it can write its result', async () => {
    const out = path.join(dir, 'result.txt');
    const file = await script(
      'writer.mjs',
      'import fs from "node:fs"; setTimeout(() => fs.writeFileSync(process.argv[2], "done"), 800);',
    );
    const ac = new AbortController();
    const t0 = performance.now();
    const run = runWorker(file, [out], { ...opts, signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    await expect(run).rejects.toMatchObject({ code: 'aborted' });
    expect(performance.now() - t0).toBeLessThan(800);
    await new Promise((r) => setTimeout(r, 1000));
    await expect(fs.access(out)).rejects.toThrow();
  });
});
