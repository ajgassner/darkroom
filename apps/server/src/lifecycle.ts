// Start and stop of the server process: readable listen errors and the Ctrl+C logic (kept out of server.ts for tests).

/** One-line message for a failed app.listen (instead of a stack trace). */
export function listenErrorMessage(err: unknown, port: number, envFile: string): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'EADDRINUSE') {
    return `Port ${port} is already in use: darkroom may already be running (open http://localhost:${port}), or set PORT in ${envFile}.`;
  }
  if (code === 'EACCES') return `Port ${port} is not allowed for this user: set another PORT in ${envFile}.`;
  return `darkroom could not start on port ${port}: ${(err as Error).message}`;
}

/**
 * A second signal of the same kind within this time is the same Ctrl+C: in a terminal it reaches the server
 * directly and once more forwarded by `darkroom start`.
 */
const SAME_SIGNAL_MS = 150;

/**
 * Handler for SIGINT/SIGTERM: the first signal calls `stop` (abort running work, shut down cleanly), a second one
 * calls `quit` with the exit code for that signal (quit right away).
 */
export function signalHandler(stop: () => void, quit: (code: number) => void, now = () => performance.now()) {
  let first: { signal: NodeJS.Signals; at: number } | null = null;
  return (signal: NodeJS.Signals) => {
    const at = now();
    if (!first) {
      first = { signal, at };
      stop();
      return;
    }
    if (signal === first.signal && at - first.at < SAME_SIGNAL_MS) return;
    quit(signal === 'SIGINT' ? 130 : 143);
  };
}
