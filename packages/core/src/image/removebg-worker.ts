// Runs as a separate process: @imgly/background-removal-node ships an older sharp/libvips version
// that should not be loaded in the same process as our sharp.
// Usage: node src/image/removebg-worker.ts <input> <output.png>
import fs from 'node:fs/promises';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: removebg-worker.ts <input> <output.png>');
  process.exit(2);
}
const { removeBackground } = await import('@imgly/background-removal-node');
const buf = await fs.readFile(input);
const type = /\.jpe?g$/i.test(input) ? 'image/jpeg' : /\.webp$/i.test(input) ? 'image/webp' : 'image/png';
// The library looks for its model files below <cwd>/node_modules by default; with pnpm they live next to
// the resolved package, so point publicPath at the package's dist/ directory explicitly.
const publicPath = new URL('./', import.meta.resolve('@imgly/background-removal-node')).href;
const blob = await removeBackground(new Blob([buf], { type }), { publicPath, output: { format: 'image/png' } });
await fs.writeFile(output, Buffer.from(await blob.arrayBuffer()));
