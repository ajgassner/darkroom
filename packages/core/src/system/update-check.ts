// Checks GitHub at most once a day for a newer darkroom release. Off with DARKROOM_UPDATE_CHECK=off.
import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_VERSION, FROM_SOURCE, ROOT } from '../config.ts';
import type { UpdateResponse } from '../contract.ts';

const LATEST_RELEASE = 'https://api.github.com/repos/ajgassner/darkroom/releases/latest';
const DAY_MS = 24 * 60 * 60 * 1000;

type Release = { version: string; url: string } | null;
type Cache = { checkedAt: number; release: Release };

const cacheFile = () => path.join(ROOT, '.update-check.json');

/** Whether version `a` is newer than `b` (x.y.z, an optional leading "v" is ignored). */
export function isNewer(a: string, b: string): boolean {
  const parts = (v: string) => v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map(Number);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

async function readCache(): Promise<Cache | null> {
  try {
    return JSON.parse(await fs.readFile(cacheFile(), 'utf8')) as Cache;
  } catch {
    return null;
  }
}

/** Latest release on GitHub; null when there is none. Network errors keep the last known answer. */
async function latestRelease(): Promise<Release> {
  const cached = await readCache();
  if (cached && Date.now() - cached.checkedAt < DAY_MS) return cached.release;
  try {
    const res = await fetch(LATEST_RELEASE, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'darkroom' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok && res.status !== 404) return cached?.release ?? null;
    const data = res.ok ? ((await res.json()) as { tag_name?: string; html_url?: string }) : {};
    const release = data.tag_name ? { version: data.tag_name.replace(/^v/, ''), url: data.html_url ?? '' } : null;
    await fs.writeFile(cacheFile(), JSON.stringify({ checkedAt: Date.now(), release } satisfies Cache)).catch(() => {});
    return release;
  } catch {
    return cached?.release ?? null;
  }
}

/** The newer release and how to install it, or `update: null`. */
export async function checkForUpdate(): Promise<UpdateResponse> {
  if (process.env.DARKROOM_UPDATE_CHECK === 'off') return { current: APP_VERSION, update: null };
  const release = await latestRelease();
  if (!release || !isNewer(release.version, APP_VERSION)) return { current: APP_VERSION, update: null };
  const command = FROM_SOURCE ? 'git pull && pnpm install && pnpm build' : 'darkroom update';
  return { current: APP_VERSION, update: { ...release, command } };
}
