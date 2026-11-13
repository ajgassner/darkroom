import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

const CLI = path.join(import.meta.dirname, 'cli.ts');
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'darkroom-cli-run-'));
afterAll(() => fs.rm(home, { recursive: true, force: true }));

interface Run {
  code: number | null;
  /** stdout and stderr together, without color and cursor codes. */
  output: string;
  stdout: string;
  stderr: string;
}

/** Run the CLI as its own process (stdin stays open, as in a terminal) with an empty data folder. */
function cli(args: string[], env: Record<string, string> = {}): Promise<Run> {
  const { OPENROUTER_API_KEY: _key, ...rest } = process.env;
  const child = spawn(process.execPath, [CLI, ...args], {
    env: { ...rest, DARKROOM_HOME: home, OPENROUTER_BASE: 'http://127.0.0.1:9/api/v1', ...env },
  });
  let output = '';
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    output += d;
    stdout += d;
  });
  child.stderr.on('data', (d) => {
    output += d;
    stderr += d;
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI still running after 4 s:\n${output}`));
    }, 4000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      // Colors and cursor codes depend on the environment (CI turns colors on): compare plain text
      resolve({ code, output: stripVTControlCharacters(output), stdout, stderr });
    });
  });
}

describe('CLI process', () => {
  it('stops its spinner and exits with an error when a run fails', async () => {
    const res = await cli(['speak', 'hello']);
    expect(res.code).toBe(1);
    expect(res.output).toContain('OPENROUTER_API_KEY is missing');
  });

  it('writes plain lines when piped: no color or cursor codes, errors on stderr', async () => {
    const res = await cli(['speak', 'hello'], { CI: 'true' });
    // One line, the message only (CI=true would turn picocolors on without the NO_COLOR of a pipe)
    expect(res.stderr.split('\n')).toEqual([expect.stringMatching(/^OPENROUTER_API_KEY is missing\. /), '']);
    expect(res.stderr).not.toContain('\u001b');
    expect(res.stdout).toBe('');
    const help = await cli(['preview', '--help'], { CI: 'true' });
    expect(help.stdout).toContain('--no-play');
  });

  it('takes image sizes in any case and rejects unknown ones', async () => {
    const res = await cli(['gen', '-s', '8k', 'a cat']);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("option '-s, --size <tier>' argument '8k' is invalid. must be one of 512");
  });

  it('exits with an error when OpenRouter cannot be reached', async () => {
    const res = await cli(['models'], { OPENROUTER_API_KEY: 'test' });
    expect(res.code).toBe(1);
    expect(res.output).toContain('Network error');
  });

  it('never asks outside a terminal: missing input is an error, plain darkroom prints the help', async () => {
    const gen = await cli(['gen', '-m', 'a/b']);
    expect(gen.code).toBe(1);
    expect(gen.output).toContain('Prompt (missing argument)');
    const speak = await cli(['speak']);
    expect(speak.output).toContain('Text (missing argument)');
    const plain = await cli([]);
    expect(plain.code).toBe(1);
    expect(plain.output).toContain('Usage: darkroom');
  });

  it('validates the speed and names the web UI port', async () => {
    const speed = await cli(['speak', '--speed', 'abc', 'hello']);
    expect(speed.code).toBe(1);
    expect(speed.output).toContain('must be a number from 0.25 to 4');
    const help = await cli(['--help'], { PORT: '5199' });
    expect(help.output).toContain('http://localhost:5199');
  });

  it('lists and removes favorites without network, and looks up a model before adding it', async () => {
    const file = path.join(home, 'favorites.json');
    await fs.writeFile(file, JSON.stringify({ image: ['a/one', 'gone/two'], speech: ['s/one'], music: [] }));
    const all = await cli(['favorites']);
    expect(all.code).toBe(0);
    expect(all.output).toContain('image favorites (2)');
    expect(all.output).toContain('gone/two');
    expect(all.output).toContain('music favorites (0)');
    const speech = await cli(['favorites', 'speech']);
    expect(speech.output).toContain('s/one');
    expect(speech.output).not.toContain('image favorites');

    const removed = await cli(['favorites', 'remove', 'gone/two']);
    expect(removed.output).toContain('Removed gone/two from your image favorites');
    expect(JSON.parse(await fs.readFile(file, 'utf8')).image).toEqual(['a/one']);
    expect((await cli(['favorites', 'rm', 'never/added'])).output).toContain('never/added is not a favorite');

    const add = await cli(['favorites', 'add', 'x/y', '--kind', 'image'], { OPENROUTER_API_KEY: 'test' });
    expect(add.code).toBe(1);
    expect(add.output).toContain('Network error');
    expect((await cli(['favorites', 'video'])).output).toContain("'video' is invalid for argument 'kind'");
  });
});
