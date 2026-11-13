import { describe, expect, it } from 'vitest';
import { playerCommand } from './play.ts';

const having =
  (...cmds: string[]) =>
  (cmd: string) =>
    cmds.includes(cmd);

describe('audio player', () => {
  it('uses afplay on macOS', () => {
    expect(playerCommand('darwin', '/out/a.mp3', having('afplay'))).toEqual(['afplay', '/out/a.mp3']);
    expect(playerCommand('darwin', '/out/a.mp3', having())).toBeNull();
  });

  it('plays WAV in PowerShell on Windows and opens other formats in the default app', () => {
    expect(playerCommand('win32', "C:\\it's\\a.wav", having())).toEqual([
      'powershell',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "(New-Object System.Media.SoundPlayer 'C:\\it''s\\a.wav').PlaySync()",
    ]);
    expect(playerCommand('win32', 'C:\\a.mp3', having())).toEqual(['explorer', 'C:\\a.mp3']);
  });

  it('takes the first available player on Linux: paplay or aplay for WAV, ffplay for anything', () => {
    const ffplay = ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet'];
    expect(playerCommand('linux', '/a.wav', having('paplay', 'aplay', 'ffplay'))).toEqual(['paplay', '/a.wav']);
    expect(playerCommand('linux', '/a.WAV', having('aplay', 'ffplay'))).toEqual(['aplay', '-q', '/a.WAV']);
    expect(playerCommand('linux', '/a.wav', having('ffplay'))).toEqual([...ffplay, '/a.wav']);
    expect(playerCommand('linux', '/a.mp3', having('paplay', 'aplay', 'ffplay'))).toEqual([...ffplay, '/a.mp3']);
    expect(playerCommand('linux', '/a.mp3', having('paplay', 'aplay'))).toBeNull();
    expect(playerCommand('freebsd', '/a.wav', having())).toBeNull();
  });
});
