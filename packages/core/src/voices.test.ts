import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VOICES_DIR } from './config.ts';
import { deleteSample, deleteVoice, getVoice, saveVoice } from './voices.ts';

const WAV = Buffer.from('RIFF....WAVE');

async function voiceWithSamples(name: string, samples: string[]): Promise<string> {
  const dir = path.join(VOICES_DIR, name);
  await fs.mkdir(dir, { recursive: true });
  for (const f of samples) await fs.writeFile(path.join(dir, f), WAV);
  return dir;
}

describe('voice.json', () => {
  it('keeps every change when saves of one voice overlap', async () => {
    const samples = Array.from({ length: 8 }, (_, i) => `s${i}.wav`);
    const dir = await voiceWithSamples('busy', samples);
    await saveVoice('busy', { label: 'Busy' });
    await Promise.all(samples.map((f, i) => saveVoice('busy', { transcripts: { [f]: `text ${i}` } })));
    const v = await getVoice('busy');
    expect(v.label).toBe('Busy');
    expect(Object.keys(v.transcripts).sort()).toEqual(samples);
    // Written atomically: no temporary files are left over
    expect((await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses to overwrite a damaged voice.json', async () => {
    const dir = await voiceWithSamples('broken', ['a.wav']);
    const file = path.join(dir, 'voice.json');
    for (const damaged of ['{"label":"Bro', 'null', '[]']) {
      await fs.writeFile(file, damaged);
      await expect(saveVoice('broken', { transcripts: { 'a.wav': 'x' } })).rejects.toMatchObject({
        code: 'voice_config_invalid',
        params: { name: 'broken' },
      });
      await expect(deleteSample('broken', 'missing.wav')).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readFile(file, 'utf8')).toBe(damaged);
      // Showing the voice still works, with defaults
      expect(await getVoice('broken')).toMatchObject({ label: 'broken', transcripts: {} });
    }
    await fs.writeFile(path.join(dir, 'b.wav'), WAV);
    await expect(deleteSample('broken', 'b.wav')).rejects.toMatchObject({ code: 'voice_config_invalid' });
    expect(await fs.readFile(file, 'utf8')).toBe('[]');
  });

  it('removes the transcript of a deleted sample', async () => {
    await voiceWithSamples('del', ['a.wav', 'b.wav']);
    await saveVoice('del', { label: 'Del', transcripts: { 'a.wav': 'one', 'b.wav': 'two' } });
    await deleteSample('del', 'a.wav');
    expect(await getVoice('del')).toMatchObject({ label: 'Del', samples: ['b.wav'], transcripts: { 'b.wav': 'two' } });
  });
});

describe('deleting voices', () => {
  it('removes voices/<name>/ with its samples and voice.json', async () => {
    await voiceWithSamples('old', ['a.wav']);
    await saveVoice('old', { label: 'Old', transcripts: { 'a.wav': 'hi' } });
    await deleteVoice('old');
    await expect(fs.access(path.join(VOICES_DIR, 'old'))).rejects.toThrow();
    await expect(deleteVoice('old')).rejects.toMatchObject({ code: 'voice_not_found', params: { name: 'old' } });
    await expect(deleteVoice('../x')).rejects.toMatchObject({ code: 'invalid_name' });
  });
});
