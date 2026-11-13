// Model catalogs (image, speech, music) in list order with favorite/recommended marks, and the favorites.
import { listMusicModels, listSpeechModels } from '@darkroom/core/audio-models';
import { rankModels } from '@darkroom/core/catalog';
import type { ImageModelInfo, MusicModelInfo, SpeechModelInfo } from '@darkroom/core/contract';
import { unknownModel } from '@darkroom/core/errors';
import { inCatalog, MODEL_KINDS, readFavorites, setFavorite } from '@darkroom/core/favorites';
import { imagePrices, listImageModels, zdrEndpoints } from '@darkroom/core/openrouter';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

const refresh = z.object({ refresh: z.string().optional() });

export async function modelRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/api/models', { schema: { querystring: refresh } }, async (req): Promise<ImageModelInfo[]> => {
    const [models, zdr, prices, favorites] = await Promise.all([
      listImageModels(req.query.refresh !== undefined),
      zdrEndpoints(),
      imagePrices(),
      readFavorites(),
    ]);
    const infos = models.map((m) => ({
      id: m.id,
      name: m.name,
      created: m.created,
      supported_parameters: m.supported_parameters,
      zdr: zdr.get(m.id) ?? [],
      price: prices.get(m.id) ?? null,
    }));
    return rankModels(infos, 'image', favorites.image);
  });

  app.get('/api/speech/models', { schema: { querystring: refresh } }, async (req): Promise<SpeechModelInfo[]> => {
    const [models, favorites] = await Promise.all([listSpeechModels(req.query.refresh !== undefined), readFavorites()]);
    return rankModels(models, 'speech', favorites.speech);
  });

  app.get('/api/music/models', { schema: { querystring: refresh } }, async (req): Promise<MusicModelInfo[]> => {
    const [models, favorites] = await Promise.all([listMusicModels(req.query.refresh !== undefined), readFavorites()]);
    return rankModels(models, 'music', favorites.music);
  });

  app.get('/api/favorites', () => readFavorites());

  // Add or remove one favorite; only models of that catalog can be added (removing works for any id)
  app.post(
    '/api/favorites',
    {
      schema: {
        body: z.object({ kind: z.enum(MODEL_KINDS), model: z.string().min(1).max(200), favorite: z.boolean() }),
      },
    },
    async (req) => {
      const { kind, model, favorite } = req.body;
      if (favorite && !(await inCatalog(kind, model))) throw unknownModel(model);
      return setFavorite(kind, model, favorite);
    },
  );
}
