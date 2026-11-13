import type { SpeechModel } from '@darkroom/core/contract';
import { describe, expect, it } from 'vitest';
import { previewCall, previewDetails, userLanguage } from './preview.ts';

const model = (id: string, voices: string[]): SpeechModel => ({
  id,
  name: id,
  description: '',
  pricing: {},
  voices,
  cloning: true,
  multiRef: false,
  zdr: [],
});
const models = [model('x/tts', ['de-DE-Anna', 'Kore']), model('x/plain', [])];

describe('voice preview', () => {
  it('takes the user language from the locale environment', () => {
    expect(userLanguage({ LANG: 'de_DE.UTF-8' }, 'en-US')).toBe('de');
    expect(userLanguage({ LC_ALL: 'fr_FR', LANG: 'de_DE' }, 'en-US')).toBe('fr');
    expect(userLanguage({ LC_ALL: 'C', LANG: 'C.UTF-8' }, 'nl-NL')).toBe('nl');
    expect(userLanguage({}, 'it')).toBe('it');
    expect(userLanguage({}, '')).toBe('en');
  });

  it('says a sentence in the voice language unless a text is given, which is always generated', () => {
    const call = previewCall({ model: 'x/tts', voice: 'de-DE-Anna', privacy: 'zdr' }, models, 'en');
    expect(call).toMatchObject({ model: 'x/tts', voice: 'de-DE-Anna', privacy: 'zdr', regenerate: false });
    expect(call.text).toMatch(/^Hallo!/);
    // Own and multilingual voices speak the user language
    expect(previewCall({ model: 'x/tts', voice: 'voice:me', privacy: 'off' }, models, 'fr').text).toMatch(/^Bonjour/);
    expect(previewCall({ model: 'x/plain', voice: '', privacy: 'off' }, models, 'es').text).toMatch(/^¡Hola!/);
    const own = previewCall({ model: 'x/tts', voice: 'Kore', text: '  Testing  ', privacy: 'zdr' }, models, 'en');
    expect(own).toMatchObject({ text: 'Testing', regenerate: true });
    expect(previewCall({ model: 'x/plain', voice: 'any', privacy: 'zdr' }, models, 'en').voice).toBe('any');
  });

  it('rejects unknown models and voices', () => {
    expect(() => previewCall({ model: 'x/none', voice: '', privacy: 'zdr' }, models, 'en')).toThrow(
      'Unknown model "x/none"',
    );
    expect(() => previewCall({ model: 'x/tts', voice: 'Nope', privacy: 'zdr' }, models, 'en')).toThrow(
      'Unknown voice "Nope" for x/tts (list: darkroom voices x/tts)',
    );
  });

  it('tells whether the preview came from the cache', () => {
    expect(previewDetails({ model: 'x/tts', voice: 'Kore', privacy: 'zdr' }, true)).toBe('cached, free · Kore · x/tts');
    expect(previewDetails({ model: 'x/tts', voice: '', privacy: 'zdr' }, false)).toBe(
      'new · model default voice · x/tts',
    );
  });
});
