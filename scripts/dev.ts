// Development: start the API server (port 5177) and the Vite dev server (port 5173) together.
// Stopping with Ctrl+C stops both.
import { type ChildProcess, spawn } from 'node:child_process';

const children: ChildProcess[] = [
  // Vite serves the UI in development: the server does not rebuild dist/web on every restart
  spawn(process.execPath, ['--watch', 'apps/server/src/server.ts'], {
    stdio: 'inherit',
    env: { ...process.env, DARKROOM_WEB_BUILD: 'off' },
  }),
  spawn('pnpm', ['--filter', '@darkroom/web', 'dev'], { stdio: 'inherit' }),
];

const stop = () => {
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children) c.on('exit', (code) => code && code !== 0 && stop());
