// Runs (streamed as NDJSON): image generation, tools, speech, music; plus importing own images.

import { parsePrivacy } from '@darkroom/core/config';
import { runGeneration } from '@darkroom/core/generate';
import { runMusic } from '@darkroom/core/music';
import { runSpeech } from '@darkroom/core/speech';
import { importImage, LOCAL_TOOLS, runTool } from '@darkroom/core/tools';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireApiKey, streamRun } from '../http.ts';

/** Empty strings from form controls count as "not set". */
const opt = z
  .string()
  .optional()
  .transform((v) => v || undefined);

// Additional references from the UI: files from out/ or uploads as data URLs (no arbitrary local paths)
const extraRef = z.union([
  z.object({ outFile: z.string() }),
  z.object({ dataUrl: z.string(), name: z.string().optional() }),
]);

const generateBody = z.object({
  prompt: z.string(),
  models: z.array(z.string()),
  element: z
    .string()
    .nullish()
    .transform((v) => v || null),
  usePrefix: z.boolean().default(true),
  extraRefs: z.array(extraRef).default([]),
  count: z.coerce.number().int().min(1).max(10).default(1),
  aspectRatio: opt,
  resolution: opt,
  outputFormat: opt,
  quality: opt,
  seed: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform((v) => (v === '' || v === null || v === undefined ? undefined : Number(v))),
  privacy: z.string().optional(),
});

const toolBody = z.object({
  tool: z.string(),
  source: z.string(),
  model: opt,
  element: z
    .string()
    .nullish()
    .transform((v) => v || null),
  privacy: z.string().optional(),
  options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

const speechBody = z.object({
  text: z.string(),
  model: z.string(),
  voice: opt,
  instructions: opt,
  speed: z.number().optional(),
  privacy: z.string().optional(),
});

const musicBody = z.object({ prompt: z.string(), model: z.string(), privacy: z.string().optional() });

export async function runRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post('/api/generate', { schema: { body: generateBody } }, async (req, reply) => {
    requireApiKey();
    const { privacy, ...rest } = req.body;
    return streamRun(reply, (send, signal) => runGeneration({ ...rest, privacy: parsePrivacy(privacy) }, send, signal));
  });

  app.post('/api/tool', { schema: { body: toolBody } }, async (req, reply) => {
    const { privacy, options, ...rest } = req.body;
    if (!LOCAL_TOOLS.has(rest.tool)) requireApiKey();
    const opts = Object.fromEntries(Object.entries(options).map(([k, v]) => [k, String(v)]));
    return streamRun(reply, (send, signal) =>
      runTool({ ...rest, privacy: parsePrivacy(privacy), options: opts }, send, signal),
    );
  });

  app.post('/api/speech', { schema: { body: speechBody } }, async (req, reply) => {
    requireApiKey();
    const { privacy, ...rest } = req.body;
    return streamRun(reply, (send, signal) => runSpeech({ ...rest, privacy: parsePrivacy(privacy) }, send, signal));
  });

  app.post('/api/music', { schema: { body: musicBody } }, async (req, reply) => {
    requireApiKey();
    const { privacy, ...rest } = req.body;
    return streamRun(reply, (send, signal) => runMusic({ ...rest, privacy: parsePrivacy(privacy) }, send, signal));
  });

  app.post(
    '/api/import',
    { schema: { body: z.object({ dataUrl: z.string(), filename: z.string().default('image') }) } },
    async (req) => importImage(req.body.dataUrl, req.body.filename),
  );
}
