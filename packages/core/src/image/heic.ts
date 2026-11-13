// HEIC/HEIF (iPhone photos): sharp cannot decode HEVC for licensing reasons.
// On macOS we convert to JPEG with the built-in `sips` (no additional dependency).
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppError } from '../errors.ts';

const execFileP = promisify(execFile);
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);

/** Detects HEIC/HEIF with HEVC content from the ftyp header (AVIF is not matched, sharp handles it itself). */
function isHeic(buf: Buffer): boolean {
  if (buf.length < 16 || buf.subarray(4, 8).toString('latin1') !== 'ftyp') return false;
  const size = Math.min(buf.readUInt32BE(0), 64, buf.length);
  const brands: string[] = [buf.subarray(8, 12).toString('latin1')];
  for (let i = 16; i + 4 <= size; i += 4) brands.push(buf.subarray(i, i + 4).toString('latin1'));
  if (brands.includes('avif') || brands.includes('avis')) return false;
  return brands.some((b) => HEIC_BRANDS.has(b)) || brands[0] === 'mif1' || brands[0] === 'msf1';
}

/** HEIC → JPEG (quality 95) via macOS `sips`. The rotation from the HEIC is applied. */
async function heicToJpeg(buf: Buffer): Promise<Buffer> {
  if (process.platform !== 'darwin') {
    throw new AppError(
      'heic_unsupported',
      'HEIC cannot be read here (only converted automatically on macOS). Please export as JPEG.',
    );
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'darkroom-heic-'));
  try {
    const src = path.join(dir, 'in.heic');
    const dst = path.join(dir, 'out.jpg');
    await fs.writeFile(src, buf);
    await execFileP('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', src, '--out', dst], {
      timeout: 60_000,
    });
    return await fs.readFile(dst);
  } catch (e) {
    const message = (e as Error).message.split('\n')[0];
    throw new AppError('heic_failed', `HEIC conversion failed: ${message}`, { message });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Returns a buffer readable by sharp (HEIC is converted, everything else unchanged). */
export async function decodable(buf: Buffer): Promise<Buffer> {
  return isHeic(buf) ? heicToJpeg(buf) : buf;
}
