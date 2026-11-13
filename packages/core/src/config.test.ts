import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiKey, OUT_DIR, parsePrivacy, ROOT, resolveOut } from './config.ts';

describe('test isolation', () => {
  it('runs against a temporary data folder, never the repository', () => {
    expect(ROOT.startsWith(os.tmpdir()) || ROOT.startsWith(path.resolve(os.tmpdir()))).toBe(true);
    expect(OUT_DIR).toBe(path.join(ROOT, 'out'));
    expect(apiKey()).toBe('test-key');
  });
});

describe('parsePrivacy', () => {
  it.each(['zdr', 'zdr-strict', 'off'])('accepts %s', (v) => expect(parsePrivacy(v)).toBe(v));
  it.each([undefined, '', 'ZDR', 'strict', 1])('rejects %s', (v) => expect(parsePrivacy(v)).toBeUndefined());
});

describe('resolveOut', () => {
  it('resolves files below out/', () => {
    expect(resolveOut('a.png')).toBe(path.join(OUT_DIR, 'a.png'));
    expect(resolveOut('uploads/b.jpg')).toBe(path.join(OUT_DIR, 'uploads', 'b.jpg'));
  });

  it.each(['../secret', '/etc/passwd', 'uploads/../../x', '', '.'])('rejects %j', (rel) => {
    expect(() => resolveOut(rel)).toThrow(expect.objectContaining({ code: 'invalid_path' }));
  });
});
