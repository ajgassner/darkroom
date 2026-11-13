import { describe, expect, it } from 'vitest';
import { commandLine, genArgs, musicArgs, shellQuote, speakArgs, windowsQuote } from './command-line.ts';

describe('command line of an interactive run', () => {
  it('quotes for POSIX shells', () => {
    expect(shellQuote('google/gemini-3.1-flash-image')).toBe('google/gemini-3.1-flash-image');
    expect(shellQuote('voice:me')).toBe('voice:me');
    expect(shellQuote('a cat')).toBe("'a cat'");
    expect(shellQuote("it's $HOME")).toBe("'it'\\''s $HOME'");
    expect(shellQuote('')).toBe("''");
  });

  it('quotes for Windows with double quotes', () => {
    expect(windowsQuote('C:\\out\\a.png')).toBe('C:\\out\\a.png');
    expect(windowsQuote('a cat')).toBe('"a cat"');
    expect(windowsQuote('say "hi"')).toBe('"say \\"hi\\""');
    expect(windowsQuote("it's $HOME")).toBe(`"it's $HOME"`);
    // Backslashes before a quote and at the end are doubled, so they stay backslashes
    expect(windowsQuote('a\\"b')).toBe('"a\\\\\\"b"');
    expect(windowsQuote('dir with space\\')).toBe('"dir with space\\\\"');
    expect(windowsQuote('')).toBe('""');
    const argv = speakArgs({ privacy: 'zdr', model: 'x/tts', text: "It's me" });
    expect(commandLine(argv, 'win32')).toBe(`darkroom speak -m x/tts --privacy zdr "It's me"`);
    expect(commandLine(argv, 'linux')).toBe("darkroom speak -m x/tts --privacy zdr 'It'\\''s me'");
  });

  it('renders darkroom gen with every choice', () => {
    expect(
      commandLine(
        genArgs({
          privacy: 'zdr',
          models: ['a/one', 'b/two'],
          element: 'me',
          aspect: '3:4',
          size: '2K',
          count: 2,
          prompt: 'Portrait of @me, golden hour',
          format: 'png',
          quality: 'high',
          seed: 0,
          refs: ['out/x.png'],
          prefix: false,
          maxSide: 2048,
        }),
      ),
    ).toBe(
      "darkroom gen -m a/one -m b/two -e me -a 3:4 -s 2K -n 2 -f png -q high --seed 0 -r out/x.png --no-prefix --max-side 2048 --privacy zdr 'Portrait of @me, golden hour'",
    );
    expect(genArgs({ privacy: 'off', models: ['a/one'], element: null, count: 1, prompt: '-dash' })).toEqual([
      'darkroom',
      'gen',
      '-m',
      'a/one',
      '--privacy',
      'off',
      '--',
      '-dash',
    ]);
  });

  it('renders darkroom speak and darkroom music', () => {
    expect(
      commandLine(
        speakArgs({ privacy: 'zdr', model: 'x/tts', voice: 'voice:me', text: 'Hi!', instructions: 'calm', speed: 1.1 }),
      ),
    ).toBe("darkroom speak -m x/tts -v voice:me -i calm --speed 1.1 --privacy zdr 'Hi!'");
    expect(commandLine(speakArgs({ privacy: 'zdr', model: 'x/tts', text: 'Hi', speed: 1 }))).toBe(
      'darkroom speak -m x/tts --privacy zdr Hi',
    );
    expect(commandLine(musicArgs({ privacy: 'off', model: 'g/lyria', prompt: 'calm jingle' }))).toBe(
      "darkroom music -m g/lyria --privacy off 'calm jingle'",
    );
  });
});
