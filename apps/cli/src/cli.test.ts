import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const CLI = path.join(import.meta.dirname, 'cli.ts');
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'darkroom-cli-run-'));
afterAll(() => fs.rm(home, { recursive: true, force: true }));

/** Run the CLI as its own process (stdin stays open, as in a terminal) with an empty data folder. */
function cli(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; output: string }> {
  const { OPENROUTER_API_KEY: _key, ...rest } = process.env;
  const child = spawn(process.execPath, [CLI, ...args], {
    env: { ...rest, DARKROOM_HOME: home, OPENROUTER_BASE: 'http://127.0.0.1:9/api/v1', ...env },
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI still running after 4 s:\n${output}`));
    }, 4000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

describe('CLI process', () => {
  it('stops its spinner and exits with an error when a run fails', async () => {
    const res = await cli(['speak', 'hello']);
    expect(res.code).toBe(1);
    expect(res.output).toContain('OPENROUTER_API_KEY is missing');
  });

  it('exits with an error when OpenRouter cannot be reached', async () => {
    const res = await cli(['models'], { OPENROUTER_API_KEY: 'test' });
    expect(res.code).toBe(1);
    expect(res.output).toContain('Network error');
  });
});
