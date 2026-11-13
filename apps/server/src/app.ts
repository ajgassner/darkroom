// Fastify application: local-only security hook, error mapping, routes.
import fs from 'node:fs/promises';
import { OUT_DIR } from '@darkroom/core/config';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { abortActiveWork, errorBody, localOnly, statusOf } from './http.ts';
import { elementRoutes } from './routes/elements.ts';
import { fileRoutes } from './routes/files.ts';
import { metaRoutes } from './routes/meta.ts';
import { modelRoutes } from './routes/models.ts';
import { runRoutes } from './routes/runs.ts';
import { voiceRoutes } from './routes/voices.ts';

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'warn' },
    // Uploads (photos, voice samples) arrive as data URLs in JSON
    bodyLimit: 80 * 1024 * 1024,
    // Generations stream for minutes; no request timeout
    requestTimeout: 0,
    // On close, drop connections that are still open after the running work was aborted (see preClose)
    forceCloseConnections: true,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onRequest', localOnly);

  // Runs and transcriptions in progress: aborted on shutdown (Ctrl+C), so paid calls and workers stop
  app.decorate<typeof app.activeWork>('activeWork', new Set());
  app.addHook('preClose', () => abortActiveWork(app.activeWork));

  app.setErrorHandler((err, req, reply) => {
    // Schema validation errors: 400 with a readable message
    if ((err as { validation?: unknown }).validation) {
      return reply.code(400).send({ error: (err as Error).message, code: 'bad_request' });
    }
    const status = statusOf(err);
    if (status >= 500) req.log.error(err);
    return reply.code(status).header('Cache-Control', 'no-store').send(errorBody(err));
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found', code: 'not_found' }));

  // reply.sendFile (range requests for seeking, ETag) for every route plugin, so registered here and not inside
  // one of them: plugins are encapsulated. No routes of its own; the root must exist.
  await fs.mkdir(OUT_DIR, { recursive: true });
  await app.register(fastifyStatic, { root: OUT_DIR, serve: false });

  await app.register(metaRoutes);
  await app.register(modelRoutes);
  await app.register(elementRoutes);
  await app.register(voiceRoutes);
  await app.register(runRoutes);
  await app.register(fileRoutes);
  return app;
}
