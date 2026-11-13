import { APP_VERSION } from '@darkroom/core/config';
import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { program } from '../cli.ts';
import { EXIT } from '../output/mode.ts';
import { invocation, skillGuide, sourceNote } from './skill.ts';

const guide = skillGuide(program);

/** Every command below `cmd` (subcommands too), with its full name. */
function commands(cmd: Command, prefix = 'darkroom'): { name: string; cmd: Command }[] {
  return cmd.commands.flatMap((c) => {
    const name = `${prefix} ${c.name()}`;
    return [{ name, cmd: c }, ...commands(c, name)];
  });
}

describe('skill guide', () => {
  it('starts with Agent Skills front matter and names the version', () => {
    const [, name, description] = guide.split('\n');
    expect(guide.startsWith('---\n')).toBe(true);
    expect(name).toBe('name: darkroom');
    expect(description).toMatch(/^description: .*images.*speech.*cloned voices.*music.*OpenRouter.*Use when/);
    expect(guide).toContain(`version: "${APP_VERSION}"`);
    expect(guide).toContain(`# darkroom ${APP_VERSION}`);
  });

  it('documents every command, alias, argument and option', () => {
    const all = commands(program);
    expect(all.map((c) => c.name)).toContain('darkroom favorites add');
    for (const { name, cmd } of all) {
      expect(guide, name).toContain(`### \`${name} `);
      for (const alias of cmd.aliases()) expect(guide, `${name} alias`).toContain(`\`${alias}\``);
      for (const arg of cmd.registeredArguments) expect(guide, `${name} ${arg.name()}`).toContain(arg.name());
      for (const option of cmd.options) expect(guide, `${name} ${option.flags}`).toContain(`\`${option.flags}\``);
    }
  });

  it('lists the exit codes, privacy modes and the JSON shapes', () => {
    for (const code of Object.values(EXIT)) expect(guide).toContain(`- \`${code}\`: `);
    for (const mode of ['zdr', 'zdr-strict', 'off']) expect(guide).toContain(`- \`${mode}\`: `);
    for (const field of ['"ok": true', '"results"', '"errors"', '"totalSoFar"', '"warnings"', '"ok":false']) {
      expect(guide).toContain(field);
    }
  });

  it('keeps the key out of the chat, asks before spending, and suggests saving only a pointer', () => {
    expect(guide).toContain('Never ask them to paste the key into the chat');
    expect(guide).toContain("billed to the user's OpenRouter account");
    expect(guide).toContain('## Responsible use');
    expect(guide).toContain('## Make darkroom known permanently');
    expect(guide.trimEnd().endsWith('```')).toBe(true);
    // `darkroom skill` when installed, the pnpm command in a source checkout (like this test run)
    expect(guide).toMatch(/run the shell command `[^`]+ skill` and follow the guide/);
  });
});

describe('invocation', () => {
  it('uses the darkroom command when installed and silent pnpm in a source checkout', () => {
    expect(invocation(false, '/x')).toBe('darkroom');
    expect(invocation(true, '/Users/me/dev/dark room')).toBe('pnpm --silent --dir "/Users/me/dev/dark room" cli');
  });

  it('adds a note about the missing command only for a source checkout', () => {
    expect(sourceNote('darkroom')).toEqual([]);
    const note = sourceNote('pnpm --silent --dir "/repo" cli').join('\n');
    expect(note).toContain('there is no `darkroom` command');
    expect(note).toContain('`pnpm --silent --dir "/repo" cli gen --json');
  });
});
