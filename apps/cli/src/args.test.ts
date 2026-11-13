import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collect,
  displayPath,
  explicitOptions,
  floatArg,
  hasMention,
  intArg,
  parseModels,
  resolveRefs,
} from './args.ts';

describe('CLI arguments', () => {
  it('collects repeated option values', () => {
    expect(collect('b', collect('a'))).toEqual(['a', 'b']);
  });

  it('parses repeated and comma-separated models', () => {
    expect(parseModels(['a/x,b/y', ' c/z ', 'a/x', ''])).toEqual(['a/x', 'b/y', 'c/z']);
  });

  it('resolves references on disk or below out/', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'darkroom-cli-'));
    const out = path.join(dir, 'out');
    await fs.mkdir(out);
    await fs.writeFile(path.join(dir, 'photo.jpg'), 'x');
    await fs.writeFile(path.join(out, 'result.png'), 'x');
    expect(resolveRefs([path.join(dir, 'photo.jpg'), 'result.png'], out)).toEqual([
      { path: path.join(dir, 'photo.jpg') },
      { outFile: 'result.png' },
    ]);
    expect(resolveRefs(undefined, out)).toEqual([]);
    // As results were printed before (out/<file>) and as absolute paths into out/
    expect(resolveRefs(['out/result.png', path.join(out, 'result.png')], out)).toEqual([
      { outFile: 'result.png' },
      { outFile: 'result.png' },
    ]);
    expect(() => resolveRefs(['../photo.jpg'], out)).toThrow('Reference not found');
    expect(() => resolveRefs(['missing.png'], out)).toThrow('Reference not found: missing.png');
    await fs.rm(dir, { recursive: true });
  });

  it('detects @mentions', () => {
    expect(hasMention('photo of @max')).toBe(true);
    expect(hasMention('mail me@ home')).toBe(false);
  });

  it('shows result paths relative to the working directory when shorter', () => {
    const file = path.join(path.sep, 'home', 'me', 'darkroom', 'out', 'a.png');
    expect(displayPath(file, path.join(path.sep, 'home', 'me', 'darkroom'))).toBe(path.join('out', 'a.png'));
    expect(displayPath(file, path.join(path.sep, 'home', 'me', 'projects'))).toBe(file);
  });

  it('validates numbers', () => {
    expect(intArg(1, 10)('3')).toBe(3);
    expect(() => intArg(1, 10)('1.5')).toThrow('must be an integer from 1 to 10');
    expect(floatArg(0.25, 4)('1.1')).toBe(1.1);
    for (const bad of ['abc', '', '9', '0.1'])
      expect(() => floatArg(0.25, 4)(bad)).toThrow('must be a number from 0.25 to 4');
  });

  it('keeps only options given on the command line', () => {
    const sources: Record<string, string> = { model: 'cli', privacy: 'default', voice: 'cli' };
    expect(
      explicitOptions({ model: 'm', privacy: 'zdr', voice: undefined, text: '' }, (k) => sources[k], {
        model: 'model',
        privacy: 'privacy',
        voice: 'voice',
      }),
    ).toEqual({ model: 'm', voice: undefined });
  });
});
