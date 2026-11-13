// Elements (reference sets in refs/<name>/): create, edit, delete, photos, thumbnails.
import {
  addPhoto,
  deleteElement,
  deletePhoto,
  ELEMENT_TYPES,
  getElement,
  listElements,
  photoPath,
  saveElement,
  thumbnail,
  validName,
} from '@darkroom/core/refs';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { decodeDataUrl, HttpError, invalidName } from '../http.ts';

const name = z.string().refine(validName, { message: 'invalid_name' });
const elementType = z.enum(ELEMENT_TYPES as [string, ...string[]]);

export async function elementRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const params = z.object({ name });
  const photoParams = z.object({ name, file: z.string() });

  app.get('/api/elements', async () => listElements());

  app.post(
    '/api/elements',
    { schema: { body: z.object({ name: z.string(), label: z.string().optional(), type: elementType.optional() }) } },
    async (req) => {
      const { name: n, label, type = 'person' } = req.body;
      if (!validName(n)) throw invalidName(n);
      return saveElement(n, {
        label: label || n,
        type: type as (typeof ELEMENT_TYPES)[number],
        // Non-person types start without the person template
        ...(type === 'person' ? {} : { instructions: '' }),
      });
    },
  );

  app.get('/api/elements/:name', { schema: { params } }, async (req) => getElement(req.params.name));

  app.put(
    '/api/elements/:name',
    {
      schema: {
        params,
        body: z.object({
          label: z.string().optional(),
          instructions: z.string().optional(),
          type: elementType.optional(),
        }),
      },
    },
    async (req) => {
      await getElement(req.params.name);
      const { label, instructions, type } = req.body;
      return saveElement(req.params.name, {
        ...(label !== undefined ? { label } : {}),
        ...(instructions !== undefined ? { instructions } : {}),
        ...(type ? { type: type as (typeof ELEMENT_TYPES)[number] } : {}),
      });
    },
  );

  app.delete('/api/elements/:name', { schema: { params } }, async (req) => {
    await deleteElement(req.params.name);
    return { ok: true };
  });

  app.post(
    '/api/elements/:name/photos',
    { schema: { params, body: z.object({ dataUrl: z.string(), filename: z.string().default('photo') }) } },
    async (req) => {
      const buf = decodeDataUrl(req.body.dataUrl);
      try {
        return { file: await addPhoto(req.params.name, req.body.filename, buf) };
      } catch (e) {
        const message = (e as Error).message;
        throw new HttpError(
          400,
          'image_unreadable',
          `Image could not be read (${message}). Export HEIC as JPEG if needed.`,
          {
            message,
          },
        );
      }
    },
  );

  app.delete('/api/elements/:name/photos/:file', { schema: { params: photoParams } }, async (req) => {
    await deletePhoto(req.params.name, req.params.file);
    return { ok: true };
  });

  app.get(
    '/api/elements/:name/photos/:file',
    {
      schema: {
        params: photoParams,
        querystring: z.object({ size: z.coerce.number().int().min(16).max(2048).default(320) }),
      },
    },
    async (req, reply) => {
      const buf = await thumbnail(photoPath(req.params.name, req.params.file), req.query.size);
      return reply
        .type(buf[0] === 0x89 ? 'image/png' : 'image/jpeg')
        .header('Cache-Control', 'no-cache')
        .send(buf);
    },
  );
}
