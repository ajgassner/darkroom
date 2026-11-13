// Imported first by cli.ts, before picocolors decides about colors at import time: no color codes when stdout is
// not a terminal (pipes, scripts, AI agents), unless FORCE_COLOR asks for them. clack's colors (node:util
// styleText) follow NO_COLOR as well.
if (!process.stdout.isTTY && process.env.FORCE_COLOR === undefined) process.env.NO_COLOR = '1';
