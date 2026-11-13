import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { entryTitle, relightName, relightOptions } from './tools';

/** Returns the key, followed by the param values: "toolTitle.crop:16:9". */
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join('/')}` : key) as unknown as TFunction;

describe('relight presets', () => {
  it('translates known presets and keeps the server label for unknown ones', () => {
    expect(relightName(t, 'golden', 'Golden hour')).toBe('tools.preset.golden');
    expect(relightName(t, 'sunset', 'Sunset')).toBe('Sunset');
    expect(relightName(t, 'sunset')).toBe('sunset');
  });

  it('builds the select options from the server presets', () => {
    expect(relightOptions(t, { studio: 'Studio light', candle: 'Candle light' })).toEqual([
      ['studio', 'tools.preset.studio'],
      ['candle', 'Candle light'],
    ]);
    expect(relightOptions(t, undefined)).toEqual([['golden', 'tools.preset.golden']]);
  });
});

describe('entryTitle', () => {
  const title = (tool: string, toolOptions: Record<string, string>, params: Record<string, unknown> = {}) =>
    entryTitle(t, { tool, toolOptions, params, prompt: 'english label' });

  it('translates the AI tools', () => {
    expect(title('expand', { aspect: '16:9' })).toBe('toolTitle.expand:16:9');
    expect(title('upscale', { resolution: '4K' })).toBe('toolTitle.upscale:4K');
    expect(title('cleanup', {})).toBe('toolTitle.cleanup');
    expect(title('relight', { preset: 'golden' })).toBe('toolTitle.relight:tools.preset.golden');
    expect(title('relight', { preset: 'golden', custom: ' candle light ' })).toBe('toolTitle.relight:candle light');
  });

  it('translates the local tools and imports', () => {
    expect(title('crop', { aspect: '1:1' }, { width: 800, height: 800 })).toBe('toolTitle.cropSize:1:1/800/800');
    expect(title('crop', { aspect: '1:1' })).toBe('toolTitle.crop:1:1');
    expect(title('resize', { factor: '2' }, { width: 2048, height: 1536 })).toBe('toolTitle.resize:2048/1536');
    expect(title('resize', { width: '1000' })).toBe('toolTitle.resizeWidth:1000');
    expect(title('resize', { factor: '2' })).toBe('toolTitle.resizeFactor:2');
    expect(title('removebg', { background: 'transparent' })).toBe('toolTitle.removebg');
    expect(title('removebg', { background: '#ffffff' })).toBe('toolTitle.removebgColor:#ffffff');
    expect(title('import', { filename: 'me.jpg' })).toBe('toolTitle.import:me.jpg');
  });

  it('falls back to the prompt for unknown tools, old entries and incomplete options', () => {
    expect(title('sharpen', { amount: '2' })).toBe('english label');
    expect(entryTitle(t, { tool: 'crop', prompt: 'Crop to 1:1' })).toBe('Crop to 1:1');
    expect(title('relight', { preset: 'candle' })).toBe('english label');
    for (const tool of ['crop', 'resize', 'removebg', 'expand', 'upscale', 'relight', 'import']) {
      expect(title(tool, {})).toBe('english label');
    }
    expect(entryTitle(t, { prompt: 'portrait' })).toBe('portrait');
    expect(entryTitle(t, {})).toBe('');
  });
});
