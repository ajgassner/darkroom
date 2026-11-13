import { describe, expect, it } from 'vitest';
import { fakeOpenRouter } from '../test/fake-openrouter.ts';
import { runMusic } from './music.ts';

describe('music privacy', () => {
  // test/lyria-safety only has a ZDR endpoint with safety retention
  it('keeps zdr-strict pinned to ZDR endpoints with safety retention instead of running unrestricted', async () => {
    const api = fakeOpenRouter();
    const [entry] = await runMusic({ prompt: 'calm guitar', model: 'test/lyria-safety', privacy: 'zdr-strict' });
    expect(entry).toMatchObject({
      ok: true,
      providerRestriction: ['lyria-safety-provider'],
      notices: [{ code: 'music_safety_retention' }],
    });
    expect(api.callsTo('/chat/completions')[0].body).toMatchObject({
      provider: { only: ['lyria-safety-provider'], allow_fallbacks: false },
    });
  });

  it('uses the safety retention endpoint without a notice in zdr mode', async () => {
    fakeOpenRouter();
    const [entry] = await runMusic({ prompt: 'calm guitar', model: 'test/lyria-safety', privacy: 'zdr' });
    expect(entry).toMatchObject({ ok: true, providerRestriction: ['lyria-safety-provider'], notices: [] });
  });

  it('runs unrestricted with the no-ZDR notice only without any ZDR endpoint', async () => {
    const api = fakeOpenRouter();
    const [entry] = await runMusic({ prompt: 'calm guitar', model: 'test/lyria', privacy: 'zdr-strict' });
    expect(entry).toMatchObject({ ok: true, providerRestriction: null, notices: [{ code: 'music_no_zdr' }] });
    expect(api.callsTo('/chat/completions')[0].body).not.toHaveProperty('provider');
  });
});
