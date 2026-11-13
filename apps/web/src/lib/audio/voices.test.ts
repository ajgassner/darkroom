import { describe, expect, it } from 'vitest';
import type { SpeechModel, VoiceInfo } from '../types';
import {
  demoText,
  fallbackVoice,
  followsInstructions,
  langName,
  langRank,
  pricePerThousandChars,
  speechLangs,
  speechPrice,
  transcribeOptions,
  voiceAfterDelete,
  voiceGroups,
  voiceLang,
} from './voices';

const model = (id: string, description = ''): SpeechModel => ({
  id,
  name: id,
  description,
  pricing: {},
  voices: [],
  cloning: false,
  multiRef: false,
  zdr: [],
  favorite: false,
  recommended: false,
});

describe('voiceLang', () => {
  it.each([
    ['voice:me', undefined, { code: 'own' }],
    ['de-DE-KatjaNeural', undefined, { code: 'de', region: 'DE' }],
    ['narrator_fr', undefined, { code: 'fr', region: '' }],
    ['de_thorsten', undefined, { code: 'de', region: '' }],
    ['bf_emma', model('hexgrad/kokoro-82m'), { code: 'en', region: 'GB' }],
    ['Rachel', model('x/tts', 'Natural, expressive English speech'), { code: 'en', region: '' }],
    ['Rachel', model('x/tts', 'Speaks 30 languages'), { code: 'multi' }],
  ])('%s → %j', (voice, m, lang) => {
    expect(voiceLang(m, voice)).toEqual(lang);
  });
});

describe('language display', () => {
  it('names languages in the UI language and sorts own/German first', () => {
    expect(langName({ code: 'de', region: 'AT' }, 'en')).toBe('German (AT)');
    expect(langName({ code: 'de', region: '' }, 'de')).toBe('Deutsch');
    expect(langName({ code: 'multi' }, 'en')).toBe('multi');
    expect([langRank('en'), langRank('own'), langRank('fr'), langRank('de')]).toEqual([3, 0, 10, 1]);
  });

  it('picks a demo sentence in the voice language, otherwise the UI language', () => {
    expect(demoText({ code: 'fr', region: '' }, 'de')).toMatch(/^Bonjour/);
    expect(demoText({ code: 'multi' }, 'de')).toMatch(/^Hallo/);
    expect(demoText({ code: 'ja', region: '' }, 'de')).toMatch(/^Hi there/);
  });
});

describe('speech model summary', () => {
  it('collects the voice languages', () => {
    expect(speechLangs({ ...model('x/tts'), voices: ['de-DE-Katja', 'en-US-Ava', 'narrator_fr'] })).toEqual(
      new Set(['de', 'en', 'fr']),
    );
    expect(speechLangs(model('x/tts', 'Speaks 30 languages'))).toEqual(new Set(['multi']));
  });

  it('prices per 1,000 characters, otherwise per unit', () => {
    expect(pricePerThousandChars('0.000015')).toBe('$0.015');
    expect(speechPrice({ ...model('x'), pricing: { prompt: '0.000015' } })).toEqual({ per: 'chars', value: '$0.015' });
    expect(speechPrice({ ...model('x'), pricing: { prompt: '0', completion: '0.02' } })).toEqual({
      per: 'unit',
      value: '$0.02',
    });
    expect(speechPrice(model('x'))).toBeNull();
  });

  it('knows which providers follow instructions', () => {
    expect(['google/gemini-tts', 'openai/gpt-4o-mini-tts', 'fish-audio/s1'].every(followsInstructions)).toBe(true);
    expect(followsInstructions('elevenlabs/v3')).toBe(false);
  });
});

const own = (name: string): VoiceInfo => ({
  name,
  label: name.toUpperCase(),
  transcript: '',
  transcripts: {},
  samples: [],
});

describe('voice selection', () => {
  const tts = { ...model('x/tts'), voices: ['en-US-Ava', 'de-DE-Katja'] };
  const cloner = { ...model('x/clone'), cloning: true };

  it('keeps available voices and otherwise picks the best fallback', () => {
    expect(fallbackVoice(tts, 'en-US-Ava', [])).toBeNull();
    expect(fallbackVoice(cloner, 'voice:me', [own('me')])).toBeNull();
    // German ranks before English
    expect(fallbackVoice(tts, 'gone', [])).toBe('de-DE-Katja');
    expect(fallbackVoice(tts, 'voice:me', [own('me')])).toBe('de-DE-Katja');
    expect(fallbackVoice(cloner, 'gone', [own('me')])).toBe('voice:me');
    expect(fallbackVoice(model('x/none'), 'gone', [])).toBe('');
    // Already on the fallback (no voices, nothing to clone): keep it instead of setting it again
    expect(fallbackVoice(model('x/none'), '', [])).toBeNull();
    expect(fallbackVoice({ ...model('x/clone'), cloning: true }, '', [])).toBeNull();
  });

  it('groups voices by language with own voices first', () => {
    const labels = { own: 'Own', ownNoClone: 'Own (no cloning)', multi: 'Multilingual' };
    const groups = voiceGroups({ ...tts, voices: [...tts.voices, 'Rachel'] }, [own('me')], 'en', labels);
    expect(groups.map((g) => g.label)).toEqual(['Own (no cloning)', 'German', 'Multilingual', 'English']);
    expect(groups[0].options).toEqual([{ value: 'voice:me', label: 'ME', disabled: true }]);
    expect(groups[1].options).toEqual([{ value: 'de-DE-Katja', label: 'de-DE-Katja · German (DE)' }]);
    expect(groups[2].options).toEqual([{ value: 'Rachel', label: 'Rachel' }]);
    expect(voiceGroups(undefined, [], 'en', labels)).toEqual([]);
  });
});

describe('voiceAfterDelete', () => {
  it('clears the selection only if it was the deleted own voice', () => {
    expect(voiceAfterDelete('voice:me', 'me')).toBe('');
    expect(voiceAfterDelete('voice:mel', 'me')).toBe('voice:mel');
    expect(voiceAfterDelete('alloy', 'alloy')).toBe('alloy');
  });
});

describe('transcribeOptions', () => {
  it('uses the chosen engine and language', () => {
    expect(transcribeOptions({ transcribeEngine: 'api', transcribeLang: 'fr' }, 'local')).toEqual({
      engine: 'api',
      language: 'fr',
    });
  });

  it('falls back to the server engine and auto-detect', () => {
    expect(transcribeOptions({ transcribeEngine: '', transcribeLang: '' }, 'api')).toEqual({
      engine: 'api',
      language: 'auto',
    });
    expect(transcribeOptions({ transcribeEngine: '', transcribeLang: '' }, undefined).engine).toBe('local');
  });
});
