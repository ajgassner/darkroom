import { describe, expect, it } from 'vitest';
import { jsonOutput, plainOutput } from './out.ts';

describe('plain output', () => {
  it('writes results and listings to stdout, everything else to stderr, as plain lines', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const out = plainOutput({ write: (s: string) => stdout.push(s) }, { write: (s: string) => stderr.push(s) });
    out.intro('darkroom · images');
    out.status('1 result, 0 errors, $0.0100');
    out.success('out/a.png  $0.0100 · 1.0 s · x/y');
    out.message('block one\n\nblock two');
    out.info('No elements yet.');
    out.hint('legend');
    out.warn('Size 4K not available, using 2K');
    out.error('x/z: failed');
    out.note(['$0.01  1  x/y'], 'Costs');
    out.outro('Total so far: $0.0100');
    out.cancel('Cancelled');
    expect(stdout).toEqual([
      'out/a.png  $0.0100 · 1.0 s · x/y\n',
      'block one\n\nblock two\n',
      'No elements yet.\n',
      'Costs\n$0.01  1  x/y\n',
    ]);
    expect(stderr).toEqual([
      '1 result, 0 errors, $0.0100\n',
      'legend\n',
      'Size 4K not available, using 2K\n',
      'x/z: failed\n',
      'Total so far: $0.0100\n',
      'Cancelled\n',
    ]);
  });

  it('keeps stdout free with --json: only progress, totals and cancellation on stderr', () => {
    const stderr: string[] = [];
    const out = jsonOutput({ write: (s: string) => stderr.push(s) });
    out.intro('darkroom · images');
    out.status('1 result, 0 errors, $0.0100');
    for (const write of [out.success, out.message, out.info, out.hint, out.warn, out.error]) write('data');
    out.note(['$0.01  1  x/y'], 'Costs');
    out.outro('Done');
    out.cancel('Cancelled');
    expect(stderr).toEqual(['1 result, 0 errors, $0.0100\n', 'Done\n', 'Cancelled\n']);
  });
});
