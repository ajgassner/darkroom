import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { onPath, openCommands } from './open.ts';

describe('opening results', () => {
  it('uses the system opener', () => {
    expect(openCommands('darwin', ['/a.png', '/b.png'], false)).toEqual([['open', '/a.png', '/b.png']]);
    expect(openCommands('win32', ['C:\\a b.png'], false)).toEqual([['explorer', 'C:\\a b.png']]);
    expect(openCommands('linux', ['/a.png', '/b.png'], true)).toEqual([
      ['xdg-open', '/a.png'],
      ['xdg-open', '/b.png'],
    ]);
    expect(openCommands('linux', ['/a.png'], false)).toBeNull();
  });

  it('finds executables on the PATH', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'darkroom-path-'));
    await fs.writeFile(path.join(dir, 'tool'), '', { mode: 0o755 });
    expect(onPath('tool', ['/nonexistent', dir].join(path.delimiter))).toBe(true);
    expect(onPath('missing-tool', dir)).toBe(false);
    await fs.rm(dir, { recursive: true });
  });
});
