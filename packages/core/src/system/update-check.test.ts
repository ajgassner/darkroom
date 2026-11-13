import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION, ROOT } from '../config.ts';
import { checkForUpdate, isNewer } from './update-check.ts';

const cache = path.join(ROOT, '.update-check.json');

function githubAnswers(status: number, body: unknown = {}) {
  const fetchMock = vi.fn(async () => Response.json(body, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  process.env.DARKROOM_UPDATE_CHECK = 'on';
});
afterEach(async () => {
  process.env.DARKROOM_UPDATE_CHECK = 'off';
  await fs.rm(cache, { force: true });
});

describe('isNewer', () => {
  it('compares x.y.z numerically', () => {
    expect(isNewer('v0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
    expect(isNewer('1.2', '1.1.9')).toBe(true);
  });
});

describe('checkForUpdate', () => {
  it('reports a newer release with the command to install it', async () => {
    githubAnswers(200, { tag_name: 'v99.0.0', html_url: 'https://github.com/x/releases/v99.0.0' });
    const r = await checkForUpdate();
    expect(r).toMatchObject({ current: APP_VERSION, update: { version: '99.0.0' } });
    // The repository is a git checkout, so the update is a git pull
    expect(r.update?.command).toContain('git pull');
  });

  it('asks GitHub at most once a day', async () => {
    const fetchMock = githubAnswers(200, { tag_name: `v${APP_VERSION}`, html_url: '' });
    expect((await checkForUpdate()).update).toBeNull();
    expect((await checkForUpdate()).update).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stays quiet without releases, on errors and when switched off', async () => {
    githubAnswers(404);
    expect((await checkForUpdate()).update).toBeNull();
    await fs.rm(cache, { force: true });
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    expect((await checkForUpdate()).update).toBeNull();
    process.env.DARKROOM_UPDATE_CHECK = 'off';
    const fetchMock = githubAnswers(200, { tag_name: 'v99.0.0' });
    expect((await checkForUpdate()).update).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
