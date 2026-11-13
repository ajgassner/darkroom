// Status, presets, history, deletion and debug records.
import fs from 'node:fs/promises';
import { saveApiKey } from '@darkroom/core/api-key';
import {
  DEFAULT_MODEL,
  DEFAULT_PRIVACY,
  ENV_FILE,
  hasApiKey,
  PRESETS_FILE,
  REF_MAX_SIDE,
  TRANSCRIBE_ENGINE,
  TRANSCRIBE_MODEL,
} from '@darkroom/core/config';
import type { StatusResponse } from '@darkroom/core/contract';
import { deleteDebug, readDebug } from '@darkroom/core/debug';
import { costSummary, markDeleted, readEntries, removeFiles, unusedDebugIds } from '@darkroom/core/manifest';
import { DEFAULT_INSTRUCTIONS } from '@darkroom/core/refs';
import { RELIGHT_PRESETS } from '@darkroom/core/tools';
import { checkForUpdate } from '@darkroom/core/update-check';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HttpError } from '../http.ts';

export async function metaRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/api/status',
    async (): Promise<StatusResponse> => ({
      hasKey: hasApiKey(),
      envFile: ENV_FILE,
      defaultModel: DEFAULT_MODEL,
      defaultPrivacy: DEFAULT_PRIVACY,
      refMaxSide: REF_MAX_SIDE,
      defaultInstructions: DEFAULT_INSTRUCTIONS,
      transcribe: { engine: TRANSCRIBE_ENGINE, apiModel: TRANSCRIBE_MODEL },
      relightPresets: Object.fromEntries(Object.entries(RELIGHT_PRESETS).map(([k, v]) => [k, v.label])),
      costs: costSummary(await readEntries()),
    }),
  );

  // First start without a key: the UI asks for it (the server only accepts local requests)
  app.post('/api/key', { schema: { body: z.object({ key: z.string().max(500) }) } }, async (req) => {
    await saveApiKey(req.body.key);
    return { ok: true };
  });

  app.get('/api/update', () => checkForUpdate());

  app.get('/api/presets', async () => JSON.parse(await fs.readFile(PRESETS_FILE, 'utf8').catch(() => '[]')));

  app.get(
    '/api/history',
    { schema: { querystring: z.object({ limit: z.coerce.number().int().positive().default(500) }) } },
    async (req) => {
      const entries = (await readEntries()).filter((e) => !e.deleted && !e.demo);
      return entries.slice(-req.query.limit).reverse();
    },
  );

  app.get('/api/debug/:id', { schema: { params: z.object({ id: z.string() }) } }, async (req) => {
    try {
      return await readDebug(req.params.id);
    } catch {
      throw new HttpError(
        404,
        'debug_not_found',
        'No debug log for this entry (only available for calls made with this version or later)',
      );
    }
  });

  // Delete files; manifest entries are only marked so the cost total stays correct
  app.post(
    '/api/delete',
    {
      schema: {
        body: z.object({
          ids: z.array(z.string()).default([]),
          files: z.array(z.string()).default([]),
          runId: z.string().optional(),
        }),
      },
    },
    async (req) => {
      const ids = new Set(req.body.ids);
      const files = new Set(req.body.files);
      const runId = req.body.runId || null;
      if (!ids.size && !files.size && !runId)
        throw new HttpError(400, 'nothing_to_delete', 'Nothing to delete specified');
      const changed = await markDeleted(
        (e) =>
          (e.id !== undefined && ids.has(e.id)) ||
          (e.file !== null && files.has(e.file)) ||
          (runId !== null && e.runId === runId),
      );
      const removed = await removeFiles(changed);
      // Results of one call share its debug record: keep it while one of them remains
      await Promise.all((await unusedDebugIds(changed)).map((id) => deleteDebug(id)));
      return { entries: changed.length, files: removed };
    },
  );
}
