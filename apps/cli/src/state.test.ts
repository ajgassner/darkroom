import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '@darkroom/core/config';
import { describe, expect, it } from 'vitest';
import { choicesOf, loadState, rememberRun, sanitizeState } from './state.ts';

describe('remembered choices', () => {
  it('keeps only fields of the expected types', () => {
    expect(sanitizeState(null)).toEqual({ image: {}, speech: {}, music: {} });
    expect(
      sanitizeState({
        image: { privacy: 'nope', models: ['a', 3], aspect: '1:1', size: 2, count: 'x' },
        speech: { privacy: 'off', model: 'm', voice: 'voice:me', speed: 1.1 },
        music: [],
      }),
    ).toEqual({
      image: { models: ['a'], aspect: '1:1' },
      speech: { privacy: 'off', model: 'm', voice: 'voice:me', speed: 1.1 },
      music: {},
    });
  });

  it('remembers the choices of a run but not its prompt or text', async () => {
    expect(choicesOf({ privacy: 'off', model: 'g/lyria', prompt: 'secret' })).toEqual({
      privacy: 'off',
      model: 'g/lyria',
    });
    await rememberRun('image', {
      privacy: 'zdr',
      models: ['a/b'],
      element: 'me',
      count: 2,
      prompt: 'secret',
      size: '2K',
    });
    await rememberRun('speech', { privacy: 'zdr', model: 'x/tts', voice: 'v', text: 'secret', speed: 0.9 });
    const file = await fs.readFile(path.join(ROOT, '.cli-state.json'), 'utf8');
    expect(file).not.toContain('secret');
    const state = await loadState();
    expect(state.image).toMatchObject({ privacy: 'zdr', models: ['a/b'], count: 2, size: '2K' });
    expect(state.speech).toMatchObject({ model: 'x/tts', voice: 'v', speed: 0.9 });
  });
});
