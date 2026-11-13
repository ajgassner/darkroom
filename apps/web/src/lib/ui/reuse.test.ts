import { describe, expect, it } from 'vitest';
import { audioSettingsFrom, extraRefsFrom, imageSettingsFrom } from './reuse';

describe('reuse settings', () => {
  it('restores music and speech settings', () => {
    expect(audioSettingsFrom({ model: 'google/lyria', params: { mode: 'music' } })).toEqual({
      mode: 'audio',
      audioKind: 'music',
      musicModel: 'google/lyria',
    });
    expect(audioSettingsFrom({ model: 'x/tts', params: {}, voice: undefined })).toEqual({
      mode: 'audio',
      audioKind: 'speech',
      speechModel: 'x/tts',
      voice: '',
      instructions: '',
      speed: 1,
    });
    expect(
      audioSettingsFrom({ model: 'x/tts', params: { instructions: 'calm', speed: 1.2 }, voice: 'Rachel' }),
    ).toMatchObject({ voice: 'Rachel', instructions: 'calm', speed: 1.2 });
  });

  it('restores image settings and keeps the current model selection if it contains the model', () => {
    const current = { aspect: '3:4', models: ['x/a', 'x/b'] };
    expect(
      imageSettingsFrom(
        [
          {
            model: 'x/c',
            params: { aspect_ratio: '16:9', resolution: '4K', count: 2 },
            element: null,
            usePrefix: false,
          },
        ],
        current,
      ),
    ).toEqual({
      mode: 'image',
      element: '',
      usePrefix: false,
      aspect: '16:9',
      size: '4K',
      quality: '',
      format: '',
      count: 2,
      models: ['x/c'],
    });
    expect(imageSettingsFrom([{ model: 'x/b', params: {}, element: 'anna', usePrefix: true }], current)).toMatchObject({
      element: 'anna',
      aspect: '3:4',
      count: 1,
      models: ['x/a', 'x/b'],
    });
  });

  it('restores all models of a multi-model run and the params of the entry that kept the requested ones', () => {
    const base = { element: null, usePrefix: true };
    const run = [
      // This model does not support sizes and adjusted the aspect ratio
      {
        ...base,
        model: 'x/a',
        params: { aspect_ratio: '3:2', count: 1 },
        notices: [{ code: 'aspect_adjusted', params: { from: '16:9', to: '3:2' } }],
      },
      { ...base, model: 'x/b', params: { aspect_ratio: '16:9', resolution: '2K', count: 1 } },
      { ...base, model: 'x/a', params: { aspect_ratio: '3:2', count: 1 } },
      { ...base, model: 'x/c', params: { aspect_ratio: '16:9', resolution: '2K', count: 1 }, notices: [] },
    ];
    expect(imageSettingsFrom(run, { aspect: '1:1', models: ['x/a'] })).toMatchObject({
      aspect: '16:9',
      size: '2K',
      models: ['x/a', 'x/b', 'x/c'],
    });
    // The current selection stays if it already contains every model of the run
    const current = { aspect: '1:1', models: ['x/c', 'x/b', 'x/a', 'x/d'] };
    expect(imageSettingsFrom(run, current).models).toEqual(current.models);
  });

  it('turns extra references into output file references', () => {
    expect(extraRefsFrom({ extraRefs: ['a.png'] })).toEqual([{ kind: 'out', outFile: 'a.png' }]);
  });
});
