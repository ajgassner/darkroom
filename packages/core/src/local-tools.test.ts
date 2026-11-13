import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { testImage } from '../test/fake-openrouter.ts';
import { OUT_DIR } from './config.ts';
import { AppError } from './errors.ts';
import { readEntries } from './manifest.ts';
import { runTool } from './tools.ts';
import { runWorker } from './worker.ts';

// The background removal worker needs a model download: replace it with a fake that writes its output file
vi.mock('./worker.ts', () => ({ runWorker: vi.fn() }));
const worker = vi.mocked(runWorker);

const SOURCE = 'source.png';

/** Files in out/ (without the manifest and the source). */
async function outFiles() {
  return (await fs.readdir(OUT_DIR)).filter((f) => f !== SOURCE && f !== 'manifest.jsonl');
}

/** Worker fake: writes `output` (args[1]), then optionally fails. */
function writesThen(fail?: AppError) {
  worker.mockImplementationOnce(async (_script, args) => {
    await fs.writeFile(args[1], await testImage({ alpha: true }));
    if (fail) throw fail;
    return '';
  });
}

beforeAll(async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, SOURCE), await testImage());
});

describe('background removal', () => {
  it('flattens onto a color and leaves no temporary file', async () => {
    writesThen();
    const [entry] = await runTool({ tool: 'removebg', source: SOURCE, options: { background: '#ffffff' } });
    expect(entry).toMatchObject({
      ok: true,
      model: 'local/background-removal',
      prompt: expect.stringContaining('#ffffff'),
    });
    expect(await outFiles()).toEqual([entry.file]);
    await fs.rm(path.join(OUT_DIR, entry.file as string));
  });

  it('removes the temporary file when the worker fails', async () => {
    writesThen(new AppError('worker_timeout', 'took too long', { seconds: 180 }));
    const [entry] = await runTool({ tool: 'removebg', source: SOURCE });
    expect(entry).toMatchObject({ ok: false, errorCode: 'worker_timeout', errorParams: { seconds: 180 } });
    expect(await outFiles()).toEqual([]);
  });

  it('passes the abort signal on and records nothing after a cancel', async () => {
    const before = (await readEntries()).length;
    const ac = new AbortController();
    worker.mockImplementationOnce(async (_script, args, opts) => {
      await fs.writeFile(args[1], 'partial');
      ac.abort();
      expect(opts.signal?.aborted).toBe(true);
      throw new AppError('aborted', 'Aborted');
    });
    const events: string[] = [];
    const [entry] = await runTool({ tool: 'removebg', source: SOURCE }, (e) => events.push(e.type), ac.signal);
    expect(entry).toMatchObject({ ok: false, errorCode: 'aborted' });
    expect(events).toEqual(['start', 'error', 'done']);
    expect(await outFiles()).toEqual([]);
    expect(await readEntries()).toHaveLength(before);
  });

  it('removes a result that finished only after the cancel', async () => {
    const before = (await readEntries()).length;
    const ac = new AbortController();
    worker.mockImplementationOnce(async (_script, args) => {
      await fs.writeFile(args[1], await testImage({ alpha: true }));
      ac.abort();
      return '';
    });
    const [entry] = await runTool({ tool: 'removebg', source: SOURCE }, () => {}, ac.signal);
    expect(entry).toMatchObject({ ok: false, errorCode: 'aborted', file: null });
    expect(await outFiles()).toEqual([]);
    expect(await readEntries()).toHaveLength(before);
  });

  it('does not start a local tool when the run is already cancelled', async () => {
    const [entry] = await runTool({ tool: 'crop', source: SOURCE }, () => {}, AbortSignal.abort());
    expect(entry).toMatchObject({ ok: false, errorCode: 'aborted' });
    expect(await outFiles()).toEqual([]);
  });
});
