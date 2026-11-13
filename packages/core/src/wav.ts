// Minimal audio helpers: WAV (PCM) reading and writing, file type detection.

export interface WavInfo {
  rate: number;
  channels: number;
  bits: number;
  data: Buffer;
}

/** Wrap raw 16-bit PCM in a WAV header. */
export function pcmToWav(pcm: Buffer, rate: number, channels: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Read an uncompressed PCM WAV: format from the "fmt " chunk, samples from the "data" chunk. */
export function parseWav(buf: Buffer): WavInfo | null {
  if (buf.subarray(0, 4).toString() !== 'RIFF' || buf.subarray(8, 12).toString() !== 'WAVE') return null;
  let pos = 12;
  let fmt: Omit<WavInfo, 'data'> | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.subarray(pos, pos + 4).toString();
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      if (buf.readUInt16LE(body) !== 1) return null; // only uncompressed PCM
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data' && fmt) {
      return { ...fmt, data: buf.subarray(body, Math.min(body + size, buf.length)) };
    }
    pos = body + size + (size % 2);
  }
  return null;
}

/** File extension and media type of audio data (MP3 unless recognized otherwise). */
export function audioType(buf: Buffer): { ext: string; mediaType: string } {
  const magic = buf.subarray(0, 4).toString();
  if (magic === 'RIFF') return { ext: 'wav', mediaType: 'audio/wav' };
  if (magic === 'OggS') return { ext: 'ogg', mediaType: 'audio/ogg' };
  if (magic === 'fLaC') return { ext: 'flac', mediaType: 'audio/flac' };
  return { ext: 'mp3', mediaType: 'audio/mpeg' };
}

/** Interleaved 16-bit samples → mono floats in [-1, 1). */
function mixToMono(data: Buffer, channels: number): Float32Array {
  const frames = Math.floor(data.length / (2 * channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += data.readInt16LE((i * channels + c) * 2);
    mono[i] = sum / channels / 32768;
  }
  return mono;
}

/** Linear resampling. */
function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const out = new Float32Array(Math.floor((samples.length * to) / from));
  const step = from / to;
  const last = samples.length - 1;
  for (let i = 0; i < out.length; i++) {
    const x = i * step;
    const i0 = Math.floor(x);
    const t = x - i0;
    out[i] = samples[i0] * (1 - t) + samples[Math.min(i0 + 1, last)] * t;
  }
  return out;
}

/** 16-bit PCM WAV → mono 16 kHz Float32, the input Whisper expects. */
export function toWhisperInput(buf: Buffer): Float32Array {
  const wav = parseWav(buf);
  if (wav?.bits !== 16 || !wav.rate) {
    throw new Error('Only 16-bit PCM WAV samples can be transcribed locally');
  }
  return resample(mixToMono(wav.data, wav.channels), wav.rate, 16000);
}
