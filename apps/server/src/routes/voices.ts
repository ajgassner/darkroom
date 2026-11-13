// Own voices (voices/<name>/): create, delete, samples, transcripts, transcription; speech/music model lists; voice previews.
import path from 'node:path';
import { listMusicModels, listSpeechModels } from '@darkroom/core/audio-models';
import { parsePrivacy, TRANSCRIBE_ENGINE } from '@darkroom/core/config';
import { validName } from '@darkroom/core/refs';
import { speechDemo } from '@darkroom/core/speech';
import { transcribeSample } from '@darkroom/core/transcribe';
import {
  addSample,
  deleteSample,
  deleteVoice,
  getVoice,
  listVoices,
  samplePath,
  saveVoice,
} from '@darkroom/core/voices';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { decodeDataUrl, HttpError, invalidName, requireApiKey, withAbort } from '../http.ts';

const name = z.string().refine(validName, { message: 'invalid_name' });
const refresh = z.object({ refresh: z.string().optional() });

export async function voiceRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const params = z.object({ name });
  const sampleParams = z.object({ name, file: z.string() });

  app.get('/api/speech/models', { schema: { querystring: refresh } }, async (req) =>
    listSpeechModels(req.query.refresh !== undefined),
  );
  app.get('/api/music/models', { schema: { querystring: refresh } }, async (req) =>
    listMusicModels(req.query.refresh !== undefined),
  );

  app.get('/api/voices', async () => listVoices());

  app.post(
    '/api/voices',
    { schema: { body: z.object({ name: z.string(), label: z.string().optional() }) } },
    async (req) => {
      if (!validName(req.body.name)) throw invalidName(req.body.name);
      return saveVoice(req.body.name, { label: req.body.label || req.body.name });
    },
  );

  app.put(
    '/api/voices/:name',
    {
      schema: {
        params,
        body: z.object({ label: z.string().optional(), transcripts: z.record(z.string(), z.string()).optional() }),
      },
    },
    async (req) => {
      await getVoice(req.params.name);
      return saveVoice(req.params.name, req.body);
    },
  );

  app.delete('/api/voices/:name', { schema: { params } }, async (req) => {
    await deleteVoice(req.params.name);
    return { ok: true };
  });

  app.post(
    '/api/voices/:name/samples',
    { schema: { params, body: z.object({ dataUrl: z.string(), filename: z.string().default('sample') }) } },
    async (req) => {
      const buf = decodeDataUrl(req.body.dataUrl);
      const isWav = buf.subarray(0, 4).toString() === 'RIFF';
      const isMp3 = buf.subarray(0, 3).toString() === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
      if (!isWav && !isMp3) {
        throw new HttpError(
          400,
          'audio_format_unsupported',
          'Only WAV or MP3 (the UI converts other formats to WAV automatically)',
        );
      }
      return { file: await addSample(req.params.name, req.body.filename, buf) };
    },
  );

  app.post(
    '/api/voices/:name/samples/:file/transcribe',
    {
      schema: {
        params: sampleParams,
        body: z.object({
          engine: z.enum(['local', 'api']).optional(),
          language: z.string().default('de'),
          privacy: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const engine = req.body.engine ?? TRANSCRIBE_ENGINE;
      if (engine === 'api') requireApiKey();
      const { body, params } = req;
      // Closing the page (or the server) stops the transcription, including the local Whisper worker
      return withAbort(reply, (signal) =>
        transcribeSample(params.name, params.file, engine, body.language, parsePrivacy(body.privacy), signal),
      );
    },
  );

  app.delete('/api/voices/:name/samples/:file', { schema: { params: sampleParams } }, async (req) => {
    await deleteSample(req.params.name, req.params.file);
    return { ok: true };
  });

  // Sample audio, with range support for the player
  app.get('/api/voices/:name/samples/:file', { schema: { params: sampleParams } }, async (req, reply) => {
    const p = samplePath(req.params.name, req.params.file);
    return reply
      .header('Cache-Control', 'no-cache')
      .sendFile(path.basename(p), path.dirname(p), { cacheControl: false });
  });

  // Voice preview: from the cache, or generated once (own voices are always regenerated)
  app.post(
    '/api/speech/demo',
    {
      schema: {
        body: z.object({
          model: z.string(),
          voice: z.string().default(''),
          text: z.string().default('Hello! This is how this voice sounds.'),
          privacy: z.string().optional(),
          regenerate: z.boolean().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { privacy, ...demo } = req.body;
      // Cached previews work without an API key. Closing the page (or the server) cancels the paid call.
      return withAbort(reply, (signal) => speechDemo({ ...demo, privacy: parsePrivacy(privacy) }, signal));
    },
  );
}
