// Source checkouts: the server serves the built web UI (dist/web), so after a git pull without `pnpm build` it would
// show an outdated UI. Before starting, the UI is rebuilt when it is missing or older than its sources. Installed
// copies are built by the installer on every update and are not checked.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, FROM_SOURCE, WEB_DIST_DIR } from '@darkroom/core/config';

/** Files and folders the web build is made from, relative to the app folder. */
const WEB_SOURCES = ['apps/web/src', 'apps/web/public', 'apps/web/index.html', 'apps/web/vite.config.ts'];

function mtime(file: string): number | null {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/** Newest modification time of the given files and everything below the given folders (0 when none exist). */
export function newestMtime(paths: string[]): number {
  let newest = 0;
  for (const p of paths) {
    const stat = fs.statSync(p, { throwIfNoEntry: false });
    if (!stat) continue;
    newest = Math.max(newest, stat.mtimeMs);
    if (!stat.isDirectory()) continue;
    for (const entry of fs.readdirSync(p, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) newest = Math.max(newest, mtime(path.join(entry.parentPath, entry.name)) ?? 0);
    }
  }
  return newest;
}

/** Whether the built UI (time of its index.html, null when missing) is missing or older than its sources. */
export function webBuildStale(builtAt: number | null, sourcesAt: number): boolean {
  return builtAt === null || sourcesAt > builtAt;
}

interface BuildOptions {
  fromSource?: boolean;
  appDir?: string;
  distDir?: string;
  /** Runs the build; returns whether it succeeded. */
  build?: (appDir: string) => boolean;
  log?: (line: string) => void;
}

function pnpmBuild(appDir: string): boolean {
  const result = spawnSync('pnpm', ['--silent', 'build'], {
    cwd: appDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

/**
 * In a source checkout, rebuild the web UI when it is missing or older than its sources. A failed build is reported
 * and the server starts with the previous build. Off with DARKROOM_WEB_BUILD=off (`pnpm dev`, where Vite serves the UI).
 */
export function ensureWebBuild(opts: BuildOptions = {}): void {
  const {
    fromSource = FROM_SOURCE && process.env.DARKROOM_WEB_BUILD !== 'off',
    appDir = APP_DIR,
    distDir = WEB_DIST_DIR,
    build = pnpmBuild,
    log = console.log,
  } = opts;
  if (!fromSource) return;
  const builtAt = mtime(path.join(distDir, 'index.html'));
  if (!webBuildStale(builtAt, newestMtime(WEB_SOURCES.map((p) => path.join(appDir, p))))) return;
  log(builtAt === null ? 'Building the web UI…' : 'The web UI is older than its sources: rebuilding it…');
  if (!build(appDir)) {
    log('Building the web UI failed; darkroom starts with the previous build. Run pnpm build to see the error.');
  }
}
