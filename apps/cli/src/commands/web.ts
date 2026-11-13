// `darkroom start`: the web UI server as a child process.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/** Run the web UI server until it stops (Ctrl+C); the CLI exits with its exit code. */
export function startWeb(): Promise<never> {
  // The server is its own app: run it as a child process instead of importing it into the CLI
  const server = path.resolve(import.meta.dirname, '../../../server/src/server.ts');
  const child = spawn(process.execPath, [server], { stdio: 'inherit' });
  // Pass signals on and wait for the server to shut down. Ctrl+C in a terminal also reaches the server directly
  // (same process group): it takes the forwarded copy right after as the same Ctrl+C. Windows has no signals:
  // kill() ends the server abruptly there, so Ctrl+C (which reaches it through the shared console) is not passed on.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (signal === 'SIGTERM' || process.platform !== 'win32') child.kill(signal);
    });
  }
  return new Promise(() => {
    child.on('exit', (code, signal) => process.exit(code ?? 128 + (signal ? os.constants.signals[signal] : 0)));
  });
}
