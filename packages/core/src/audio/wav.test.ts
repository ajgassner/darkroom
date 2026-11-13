import { describe, expect, it } from 'vitest';
import { audioType, parseWav, pcmToWav, toWhisperInput } from './wav.ts';

/** Stereo 16-bit PCM with the given frames ([left, right] pairs). */
function stereo(frames: [number, number][], rate: number): Buffer {
  const pcm = Buffer.alloc(frames.length * 4);
  frames.forEach(([l, r], i) => {
    pcm.writeInt16LE(l, i * 4);
    pcm.writeInt16LE(r, i * 4 + 2);
  });
  return pcmToWav(pcm, rate, 2);
}

describe('WAV', () => {
  it('writes and reads PCM WAV', () => {
    const wav = pcmToWav(Buffer.alloc(8, 1), 24000, 1);
    expect(parseWav(wav)).toMatchObject({ rate: 24000, channels: 1, bits: 16, data: Buffer.alloc(8, 1) });
    expect(parseWav(Buffer.from('not a wav file at all'))).toBeNull();
  });

  it('detects audio types', () => {
    expect(audioType(pcmToWav(Buffer.alloc(2), 8000, 1))).toEqual({ ext: 'wav', mediaType: 'audio/wav' });
    expect(audioType(Buffer.from('OggS....'))).toEqual({ ext: 'ogg', mediaType: 'audio/ogg' });
    expect(audioType(Buffer.from('fLaC....'))).toEqual({ ext: 'flac', mediaType: 'audio/flac' });
    expect(audioType(Buffer.from('ID3.....'))).toEqual({ ext: 'mp3', mediaType: 'audio/mpeg' });
  });

  it('mixes to mono and resamples to 16 kHz for Whisper', () => {
    const at16k = toWhisperInput(
      stereo(
        [
          [16384, 0],
          [0, -16384],
        ],
        16000,
      ),
    );
    expect([...at16k]).toEqual([0.25, -0.25]);

    const at32k = toWhisperInput(
      stereo(
        Array.from({ length: 8 }, () => [8192, 8192] as [number, number]),
        32000,
      ),
    );
    expect(at32k).toHaveLength(4);
    expect([...at32k].every((v) => v === 0.25)).toBe(true);

    expect(() => toWhisperInput(Buffer.from('ID3 mp3 data'))).toThrow('16-bit PCM WAV');
  });
});
