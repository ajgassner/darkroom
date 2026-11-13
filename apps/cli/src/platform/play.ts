// Playing an audio file in the terminal with the system's player (voice previews). Ctrl+C stops the playback.
import { spawn } from 'node:child_process';
import { onPath } from './open.ts';

/** PowerShell string literal: single quotes, a quote inside doubled. */
const psString = (s: string) => `'${s.replaceAll("'", "''")}'`;

/**
 * The command that plays `file`, or null when there is no player for it. macOS: afplay. Windows: a WAV plays in
 * PowerShell (System.Media.SoundPlayer), other formats open in the default app (explorer, returns at once).
 * Linux and others: paplay or aplay for WAV, ffplay for anything. `has` tells whether a command is on the PATH.
 */
export function playerCommand(platform: string, file: string, has: (cmd: string) => boolean): string[] | null {
  const wav = /\.wav$/i.test(file);
  if (platform === 'darwin') return has('afplay') ? ['afplay', file] : null;
  if (platform === 'win32') {
    if (!wav) return ['explorer', file];
    const play = `(New-Object System.Media.SoundPlayer ${psString(file)}).PlaySync()`;
    return ['powershell', '-NoProfile', '-NonInteractive', '-Command', play];
  }
  const players = [
    ...(wav
      ? [
          ['paplay', file],
          ['aplay', '-q', file],
        ]
      : []),
    ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', file],
  ];
  return players.find(([cmd]) => has(cmd)) ?? null;
}

/** 'played', 'stopped' (Ctrl+C) or 'none' (no player: the caller shows the path). */
export type Playback = 'played' | 'stopped' | 'none';

/** Play a file and wait until it ends (`onStart` once the player runs); Ctrl+C (or SIGTERM) stops it. */
export function playFile(file: string, onStart: () => void): Promise<Playback> {
  const cmd = playerCommand(process.platform, file, (c) => onPath(c));
  if (!cmd) return Promise.resolve('none');
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: 'ignore' });
    child.on('spawn', onStart);
    let stopped = false;
    // In a terminal Ctrl+C reaches the player too (same process group); kill() covers the other cases
    const stop = () => {
      stopped = true;
      child.kill();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    const done = (result: Playback) => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      resolve(result);
    };
    child.on('error', () => done('none'));
    child.on('exit', () => done(stopped ? 'stopped' : 'played'));
  });
}
