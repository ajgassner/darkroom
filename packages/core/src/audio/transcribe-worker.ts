// Local transcription with Whisper (transformers.js), as a separate process.
// Usage: node src/audio/transcribe-worker.ts <file.wav> [language]
// Output (stdout): {"text": "..."}
// The model is downloaded from Hugging Face on the first run and cached under models/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toWhisperInput } from './wav.ts';

// Project root (four levels up from packages/core/src/audio), where the models/ cache lives; same as ROOT in config.ts
const ROOT = path.resolve(
  process.env.DARKROOM_HOME ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'),
);
const [file, language] = process.argv.slice(2);
if (!file) {
  console.error('Usage: transcribe-worker.ts <file.wav> [language]');
  process.exit(2);
}

const { pipeline, env } = await import('@huggingface/transformers');
env.cacheDir = path.join(ROOT, 'models');
const model = process.env.WHISPER_MODEL || 'onnx-community/whisper-small';
const dtype = (process.env.WHISPER_DTYPE || 'q8') as 'q8';
const asr = await pipeline('automatic-speech-recognition', model, { dtype });
const audio = toWhisperInput(await fs.readFile(file));
const result = (await asr(audio, {
  chunk_length_s: 30,
  stride_length_s: 5,
  task: 'transcribe',
  ...(language ? { language } : {}),
})) as { text: string } | { text: string }[];
const text = (Array.isArray(result) ? result.map((r) => r.text).join(' ') : result.text).trim();
process.stdout.write(`${JSON.stringify({ text, model })}\n`);
