import { describe, expect, it, vi } from 'vitest';
import { listenErrorMessage, signalHandler } from './lifecycle.ts';

const errno = (code: string, message = code) => Object.assign(new Error(message), { code });

describe('listenErrorMessage', () => {
  it('explains a port that is already in use', () => {
    expect(listenErrorMessage(errno('EADDRINUSE'), 5177, '/data/.env')).toBe(
      'Port 5177 is already in use: darkroom may already be running (open http://localhost:5177), or set PORT in /data/.env.',
    );
  });

  it('keeps other errors short', () => {
    expect(listenErrorMessage(errno('EACCES'), 80, '/data/.env')).toBe(
      'Port 80 is not allowed for this user: set another PORT in /data/.env.',
    );
    expect(listenErrorMessage(errno('EINVAL', 'bad port'), 1, '/e')).toBe(
      'darkroom could not start on port 1: bad port',
    );
  });
});

describe('signalHandler', () => {
  function setup() {
    let t = 0;
    const stop = vi.fn();
    const quit = vi.fn();
    const handle = signalHandler(stop, quit, () => t);
    return { stop, quit, handle, at: (ms: number) => (t = ms) };
  }

  it('shuts down on the first signal and quits on a second one', () => {
    const s = setup();
    s.handle('SIGINT');
    expect(s.stop).toHaveBeenCalledOnce();
    expect(s.quit).not.toHaveBeenCalled();
    s.at(1000);
    s.handle('SIGINT');
    expect(s.quit).toHaveBeenCalledWith(130);
    expect(s.stop).toHaveBeenCalledOnce();
  });

  it('treats a second SIGINT right after the first as the same Ctrl+C (forwarded by darkroom start)', () => {
    const s = setup();
    s.handle('SIGINT');
    s.at(20);
    s.handle('SIGINT');
    expect(s.quit).not.toHaveBeenCalled();
    s.at(800);
    s.handle('SIGINT');
    expect(s.quit).toHaveBeenCalledWith(130);
  });

  it('never ignores a different second signal and exits with its code', () => {
    const s = setup();
    s.handle('SIGTERM');
    s.at(10);
    s.handle('SIGINT');
    expect(s.quit).toHaveBeenCalledWith(130);
    const t = setup();
    t.handle('SIGINT');
    t.at(500);
    t.handle('SIGTERM');
    expect(t.quit).toHaveBeenCalledWith(143);
  });
});
