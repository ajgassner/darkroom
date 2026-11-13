// Remove metadata losslessly: only metadata blocks are dropped,
// image and audio data stay unchanged byte for byte.
import sharp from 'sharp';
import { AppError } from './errors.ts';

/** PNG: keep only chunks needed for the image (incl. color information). */
const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'pHYs',
  'acTL',
  'fcTL',
  'fdAT',
]);

function stripPng(buf: Buffer): Buffer {
  const parts: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + len;
    if (end > buf.length) throw new AppError('file_corrupt', 'PNG is corrupt', { format: 'png' });
    if (PNG_KEEP.has(type)) parts.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(parts);
}

/**
 * JPEG: filter the segments before the image data stream.
 * Keep: APP0 (JFIF), APP2 only with an ICC profile, APP14 (Adobe, needed for color decoding), all non-APP segments.
 * Remove: APP1 (EXIF/XMP), APP11 (C2PA/JUMBF), APP13 (IPTC), other APPn, comments.
 */
function stripJpeg(buf: Buffer): Buffer {
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) throw new AppError('file_corrupt', 'JPEG is corrupt', { format: 'jpeg' });
    const marker = buf[i + 1];
    if (marker === 0xda) {
      parts.push(buf.subarray(i)); // Start of Scan: copy the rest unchanged
      return Buffer.concat(parts);
    }
    const len = buf.readUInt16BE(i + 2);
    const seg = buf.subarray(i, i + 2 + len);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keep =
      !isApp && marker !== 0xfe
        ? true
        : marker === 0xe0 ||
          marker === 0xee ||
          (marker === 0xe2 && seg.subarray(4, 15).toString('latin1') === 'ICC_PROFILE');
    if (keep) parts.push(seg);
    i += 2 + len;
  }
  throw new AppError('file_corrupt', 'JPEG without image data', { format: 'jpeg' });
}

/** MP3: remove the ID3v2 tag at the start and the ID3v1 tag at the end. */
function stripMp3(buf: Buffer): Buffer {
  let start = 0;
  while (buf.subarray(start, start + 3).toString('latin1') === 'ID3') {
    const size =
      ((buf[start + 6] & 0x7f) << 21) |
      ((buf[start + 7] & 0x7f) << 14) |
      ((buf[start + 8] & 0x7f) << 7) |
      (buf[start + 9] & 0x7f);
    const footer = buf[start + 5] & 0x10 ? 10 : 0;
    start += 10 + size + footer;
  }
  let end = buf.length;
  if (end - start >= 128 && buf.subarray(end - 128, end - 125).toString('latin1') === 'TAG') end -= 128;
  return buf.subarray(start, end);
}

/** WAV: keep only the fmt and data chunks (remove LIST/INFO, id3 etc.). */
function stripWav(buf: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const id = buf.subarray(i, i + 4).toString('latin1');
    const size = buf.readUInt32LE(i + 4);
    const end = Math.min(buf.length, i + 8 + size + (size % 2));
    if (id === 'fmt ' || id === 'data') chunks.push(buf.subarray(i, end));
    i = end;
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WAVE', 8, 'latin1');
  return Buffer.concat([head, body]);
}

/** Remove metadata depending on the file type. WebP is rewritten via sharp (lossless); unknown types are returned unchanged. */
export async function stripMetadata(buf: Buffer, file: string): Promise<Buffer> {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return stripPng(buf);
  if (buf[0] === 0xff && buf[1] === 0xd8) return stripJpeg(buf);
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WAVE') {
    return stripWav(buf);
  }
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return sharp(buf).webp({ lossless: true }).toBuffer();
  }
  if (
    buf.subarray(0, 3).toString('latin1') === 'ID3' ||
    (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) ||
    /\.mp3$/i.test(file)
  ) {
    return stripMp3(buf);
  }
  return buf;
}
