import { describe, expect, it } from 'vitest';
import type { SpeechModel } from '../contract.ts';
import { languageName, previewSentence, voiceGroups, voiceLanguage } from './voice-lang.ts';

const model = (id: string, voices: string[], extra: Partial<SpeechModel> = {}): SpeechModel => ({
  id,
  name: id,
  description: '',
  pricing: {},
  voices,
  cloning: false,
  multiRef: false,
  zdr: [],
  ...extra,
});

describe('voice languages', () => {
  it('reads the language from provider naming conventions', () => {
    const m = model('x/y', []);
    expect(voiceLanguage(m, 'de-DE-KatjaNeural')).toEqual({ code: 'de', region: 'DE' });
    expect(voiceLanguage(m, 'Rachel_fr')).toEqual({ code: 'fr', region: '' });
    expect(voiceLanguage(m, 'it_female')).toEqual({ code: 'it', region: '' });
    expect(voiceLanguage(m, 'German_Calm_Woman')).toEqual({ code: 'de', region: '' });
    expect(voiceLanguage(m, 'Kore')).toEqual({ code: 'multi', region: '' });
    expect(voiceLanguage(m, 'zz_unknown')).toEqual({ code: 'multi', region: '' });
    expect(voiceLanguage(model('hexgrad/kokoro-82m', []), 'bf_emma')).toEqual({ code: 'en', region: 'GB' });
    expect(voiceLanguage(model('other/x', []), 'bf_emma')).toEqual({ code: 'multi', region: '' });
    expect(voiceLanguage(model('x/en', [], { description: 'An English-only model' }), 'Ava')).toEqual({
      code: 'en',
      region: '',
    });
    expect(voiceLanguage(undefined, 'Ava')).toEqual({ code: 'multi', region: '' });
  });

  it('names languages in English', () => {
    expect(languageName({ code: 'de', region: 'AT' })).toBe('German (AT)');
    expect(languageName({ code: 'en', region: '' })).toBe('English');
    expect(languageName({ code: 'multi', region: '' })).toBe('multilingual');
    expect(languageName({ code: '!!', region: '' })).toBe('!!');
  });

  it('groups voices: own voices for cloning models, German, multilingual, English, then the rest', () => {
    const own = [{ name: 'me', label: 'Me' }];
    const m = model('microsoft/mai', ['fr-FR-Lea', 'Kore', 'en-US-Ben', 'de-DE-Anna', 'Nova:MAI-Voice-1'], {
      cloning: true,
    });
    expect(voiceGroups(m, own)).toEqual([
      { code: 'own', label: 'own voices', voices: [{ value: 'voice:me', label: 'Me' }] },
      { code: 'de', label: 'German', voices: [{ value: 'de-DE-Anna', label: 'de-DE-Anna (DE)' }] },
      {
        code: 'multi',
        label: 'multilingual',
        voices: [
          { value: 'Kore', label: 'Kore' },
          { value: 'Nova:MAI-Voice-1', label: 'Nova' },
        ],
      },
      { code: 'en', label: 'English', voices: [{ value: 'en-US-Ben', label: 'en-US-Ben (US)' }] },
      { code: 'fr', label: 'French', voices: [{ value: 'fr-FR-Lea', label: 'fr-FR-Lea (FR)' }] },
    ]);
    expect(voiceGroups({ ...m, cloning: false, voices: [] }, own)).toEqual([]);
  });

  it('picks the preview sentence in the voice language, own and multilingual voices in the user language', () => {
    const m = model('x/tts', ['de-DE-Anna', 'Kore', 'ja-JP-Aoi']);
    expect(previewSentence(m, 'de-DE-Anna', 'en')).toMatch(/^Hallo! So klingt/);
    expect(previewSentence(m, 'Kore', 'fr')).toMatch(/^Bonjour/);
    expect(previewSentence(m, 'voice:me_de', 'nl')).toMatch(/^Hallo! Zo klinkt/);
    expect(previewSentence(m, 'ja-JP-Aoi', 'de')).toMatch(/^Hi there/);
    expect(previewSentence(m, 'Kore', 'xx')).toMatch(/^Hi there/);
    expect(previewSentence({ id: 'x/en', description: 'English-only speech' }, '', 'de')).toMatch(/^Hi there/);
    expect(previewSentence(undefined, '', 'de')).toMatch(/^Hallo!/);
  });
});
