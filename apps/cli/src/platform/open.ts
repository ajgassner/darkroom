// Opening result files with the system's default app (macOS open, Windows explorer, Linux xdg-open).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Commands that open the files, or null when the system has no opener. */
export function openCommands(platform: string, files: string[], hasXdgOpen: boolean): string[][] | null {
  if (platform === 'darwin') return [['open', ...files]];
  // explorer opens a file with its default app, without the quoting pitfalls of cmd /c start
  if (platform === 'win32') return files.map((f) => ['explorer', f]);
  return hasXdgOpen ? files.map((f) => ['xdg-open', f]) : null;
}

/** Whether an executable of that name is on the PATH. */
export function onPath(name: string, envPath = process.env.PATH ?? ''): boolean {
  return envPath.split(path.delimiter).some((dir) => {
    try {
      fs.accessSync(path.join(dir, name), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** A function that opens files, or undefined when this system cannot. */
export function fileOpener(): ((files: string[]) => void) | undefined {
  const hasXdgOpen = process.platform !== 'darwin' && process.platform !== 'win32' && onPath('xdg-open');
  if (!openCommands(process.platform, [], hasXdgOpen)) return undefined;
  return (files) => {
    for (const [cmd, ...args] of openCommands(process.platform, files, hasXdgOpen) ?? []) {
      spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
    }
  };
}
