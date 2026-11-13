import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasMention, parseModels, resolveRefs } from './args.ts';

describe('CLI arguments', () => {
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
    expect(() => resolveRefs(['missing.png'], out)).toThrow('Reference not found: missing.png');
    await fs.rm(dir, { recursive: true });
  });

  it('detects @mentions', () => {
    expect(hasMention('photo of @max')).toBe(true);
    expect(hasMention('mail me@ home')).toBe(false);
  });
});
