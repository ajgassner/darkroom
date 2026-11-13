// Imported first by cli.ts, before picocolors decides about colors at import time: no color codes when stdout is
// not a terminal (pipes, scripts, AI agents) or the output is JSON, unless FORCE_COLOR asks for them. clack's
// colors (node:util styleText) follow NO_COLOR as well.
import { jsonMode } from './mode.ts';

if ((!process.stdout.isTTY || jsonMode) && process.env.FORCE_COLOR === undefined) process.env.NO_COLOR = '1';
