// `darkroom favorites`: list, add and remove favorite models, and "Add to favorites" after an interactive run.
import type { ModelKind } from '@darkroom/core/contract';
import { unknownModel } from '@darkroom/core/errors';
import { inCatalog, MODEL_KINDS, modelKindOf, readFavorites, setFavorite } from '@darkroom/core/models/favorites';
import { FAVORITE_MARK } from '../interactive/choices.ts';
import { favoritesDocument, printJson } from '../output/json.ts';
import { favoriteBlocks } from '../output/listing.ts';
import { jsonMode } from '../output/mode.ts';
import { out } from '../output/out.ts';
import { loading } from '../output/term.ts';

/** The favorites of one kind or all kinds (no network needed). */
export async function showFavorites(kind?: ModelKind): Promise<void> {
  const kinds = kind ? [kind] : MODEL_KINDS;
  if (jsonMode) return printJson(favoritesDocument(await readFavorites(), kinds));
  out.message(favoriteBlocks(await readFavorites(), kinds).join('\n\n'));
}

/** Add a model to the favorites; its kind comes from the catalogs unless given. */
export async function addFavorite(model: string, kind?: ModelKind): Promise<void> {
  const k = await loading(
    'Looking up the model',
    (k) => `${k} model`,
    async () => {
      if (!kind) return modelKindOf(model);
      if (!(await inCatalog(kind, model))) throw unknownModel(model);
      return kind;
    },
  );
  await setFavorite(k, model, true);
  if (jsonMode) return printJson({ ok: true, model, kind: k, favorite: true });
  out.success(`${FAVORITE_MARK} ${model} is one of your ${k} favorites`);
}

/** Remove a model from the favorites of its kind (or of every kind that has it); any id works. */
export async function removeFavorite(model: string, kind?: ModelKind): Promise<void> {
  const favorites = await readFavorites();
  const removed = (kind ? [kind] : MODEL_KINDS).filter((k) => favorites[k].includes(model));
  for (const k of removed) await setFavorite(k, model, false);
  if (jsonMode) return printJson({ ok: true, model, removedFrom: removed, favorite: false });
  if (!removed.length) return out.info(`${model} is not a favorite`);
  out.success(`Removed ${model} from your ${removed.join(' and ')} favorites`);
}

/** Next step "Add to favorites" of the interactive mode: the models of the run that are not favorites yet. */
export async function favoriteRun(kind: ModelKind, models: string[]): Promise<string> {
  const known = (await readFavorites())[kind];
  const added: string[] = [];
  for (const m of models.filter((id) => !known.includes(id))) {
    if (!(await inCatalog(kind, m))) continue;
    await setFavorite(kind, m, true);
    added.push(m);
  }
  return added.length
    ? `${FAVORITE_MARK} Added ${added.join(', ')} to your ${kind} favorites`
    : `Nothing to add: already a favorite or not in the catalog`;
}
