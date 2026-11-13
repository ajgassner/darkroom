import zlib from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { testImage } from '../../test/fake-openrouter.ts';
import { stripMetadata } from './strip.ts';

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0);
  return Buffer.concat([head, data, crc]);
}

/** Insert a chunk right after IHDR (8 byte signature + 25 byte IHDR chunk). */
function withPngText(png: Buffer, text: string): Buffer {
  return Buffer.concat([png.subarray(0, 33), pngChunk('tEXt', Buffer.from(`Comment\0${text}`)), png.subarray(33)]);
}

function riffChunk(id: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(id, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function wav(extra: Buffer[] = []): Buffer {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); // PCM
  fmt.writeUInt16LE(1, 2); // mono
  fmt.writeUInt32LE(8000, 4);
  fmt.writeUInt32LE(16000, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const body = Buffer.concat([riffChunk('fmt ', fmt), ...extra, riffChunk('data', Buffer.alloc(32, 7))]);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WAVE', 8, 'latin1');
  return Buffer.concat([head, body]);
}

describe('stripMetadata', () => {
  it('removes PNG text chunks and keeps the pixels', async () => {
    const png = await testImage({ alpha: true });
    const tagged = withPngText(png, 'secret-location');
    expect(tagged.includes('secret-location')).toBe(true);

    const clean = await stripMetadata(tagged, 'a.png');
    expect(clean.includes('secret-location')).toBe(false);
    expect(clean.equals(png)).toBe(true);
  });

  it('removes JPEG EXIF but keeps the image data byte for byte', async () => {
    const jpeg = await sharp(await testImage({ format: 'jpeg' }))
      .withExif({ IFD0: { Copyright: 'secret-owner', Software: 'TestCam' } })
      .jpeg()
      .toBuffer();
    expect(jpeg.includes('secret-owner')).toBe(true);

    const clean = await stripMetadata(jpeg, 'a.jpg');
    expect(clean.includes('secret-owner')).toBe(false);
    expect(clean.includes('Exif')).toBe(false);
    const sos = (b: Buffer) => b.subarray(b.indexOf(Buffer.from([0xff, 0xda])));
    expect(sos(clean).equals(sos(jpeg))).toBe(true);
    expect((await sharp(clean).metadata()).width).toBe(16);
  });

  it('keeps only fmt and data in WAV files', async () => {
    const plain = wav();
    const tagged = wav([riffChunk('LIST', Buffer.from('INFOIART\x08\0\0\0Somebody'))]);
    const clean = await stripMetadata(tagged, 'a.wav');
    expect(clean.equals(plain)).toBe(true);
  });

  it('removes ID3v2 and ID3v1 tags from MP3 files', async () => {
    const frames = Buffer.from([0xff, 0xfb, 0x90, 0x64, ...Array(60).fill(1)]);
    const id3v2Body = Buffer.from('TIT2 secret title');
    const id3v2 = Buffer.concat([
      Buffer.from(
        ['I', 'D', '3', 4, 0, 0, 0, 0, 0, id3v2Body.length].map((v) => (typeof v === 'string' ? v.charCodeAt(0) : v)),
      ),
      id3v2Body,
    ]);
    const id3v1 = Buffer.concat([Buffer.from('TAG'), Buffer.alloc(125, 0x41)]);
    const clean = await stripMetadata(Buffer.concat([id3v2, frames, id3v1]), 'a.mp3');
    expect(clean.equals(frames)).toBe(true);
  });

  it('returns unknown formats unchanged and rejects corrupt files', async () => {
    const text = Buffer.from('just text');
    expect(await stripMetadata(text, 'a.txt')).toBe(text);
    const png = await testImage();
    await expect(stripMetadata(png.subarray(0, 50), 'a.png')).rejects.toMatchObject({ code: 'file_corrupt' });
  });
});
