// Uploaded additional references (out/uploads/): list with usage, the runs using one, thumbnails, delete.
import type { UploadInfo, UploadRun } from '@darkroom/core/contract';
import { thumbnail } from '@darkroom/core/elements/refs';
import { readEntries } from '@darkroom/core/storage/manifest';
import { deleteUpload, existingUpload, listUploads, uploadRuns } from '@darkroom/core/storage/uploads';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

const params = z.object({ name: z.string() });

export async function uploadRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/api/uploads', async (): Promise<UploadInfo[]> => listUploads(await readEntries()));

  app.get(
    '/api/uploads/:name/runs',
    { schema: { params } },
    async (req): Promise<UploadRun[]> => uploadRuns(req.params.name, await readEntries()),
  );

  // Small preview for the uploads dialog (the uploads themselves are up to 2048 px)
  app.get(
    '/api/uploads/:name/thumb',
    {
      schema: {
        params,
        querystring: z.object({ size: z.coerce.number().int().min(16).max(1024).default(240) }),
      },
    },
    async (req, reply) => {
      const buf = await thumbnail(await existingUpload(req.params.name), req.query.size);
      // Uploads are named by their content: the same name always shows the same image
      return reply
        .type(buf[0] === 0x89 ? 'image/png' : 'image/jpeg')
        .header('Cache-Control', 'private, max-age=31536000, immutable')
        .send(buf);
    },
  );

  app.delete('/api/uploads/:name', { schema: { params } }, async (req) => {
    await deleteUpload(req.params.name, await readEntries());
    return { ok: true };
  });
}
