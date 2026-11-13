import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ensureWebBuild, newestMtime, webBuildStale } from './web-build.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darkroom-web-build-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A fake checkout with web sources and a build, with the given modification times (seconds). */
function checkout(name: string, times: { source: number; built?: number }): { appDir: string; distDir: string } {
  const appDir = path.join(tmp, name);
  const src = path.join(appDir, 'apps/web/src/lib');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.ts'), '');
  // Folders count too (a deleted file changes its folder): date them like the file
  for (const p of [path.join(src, 'a.ts'), src, path.dirname(src)]) fs.utimesSync(p, times.source, times.source);
  const distDir = path.join(appDir, 'dist/web');
  if (times.built !== undefined) {
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '');
    fs.utimesSync(path.join(distDir, 'index.html'), times.built, times.built);
  }
  return { appDir, distDir };
}

function run(dirs: { appDir: string; distDir: string }, fromSource = true, ok = true) {
  const built: string[] = [];
  const lines: string[] = [];
  ensureWebBuild({
    ...dirs,
    fromSource,
    build: (dir) => {
      built.push(dir);
      return ok;
    },
    log: (l) => lines.push(l),
  });
  return { built, lines };
}

describe('web build check', () => {
  it('is stale when missing or older than its sources', () => {
    expect(webBuildStale(null, 0)).toBe(true);
    expect(webBuildStale(100, 200)).toBe(true);
    expect(webBuildStale(200, 100)).toBe(false);
  });

  it('finds the newest file below folders and skips missing paths', () => {
    const { appDir } = checkout('newest', { source: 1_000 });
    expect(Math.round(newestMtime([path.join(appDir, 'apps/web/src'), path.join(tmp, 'nope')]))).toBe(1_000_000);
    expect(newestMtime([path.join(tmp, 'nope')])).toBe(0);
  });

  it('rebuilds a missing or outdated UI in a source checkout', () => {
    const missing = checkout('missing', { source: 1_000 });
    expect(run(missing)).toEqual({ built: [missing.appDir], lines: ['Building the web UI…'] });
    const old = checkout('old', { source: 2_000, built: 1_000 });
    expect(run(old).lines).toEqual(['The web UI is older than its sources: rebuilding it…']);
  });

  it('leaves a current build, installed copies and failed builds alone', () => {
    const current = checkout('current', { source: 1_000, built: 2_000 });
    expect(run(current).built).toEqual([]);
    const outdated = checkout('installed', { source: 2_000, built: 1_000 });
    expect(run(outdated, false).built).toEqual([]);
    expect(run(outdated, true, false).lines.at(-1)).toContain('starts with the previous build');
  });
});
