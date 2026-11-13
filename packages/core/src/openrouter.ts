// OpenRouter image API: model catalog, prices, ZDR endpoints and image generation.
import { apiKey } from './config.ts';
import type { ImageModel, ImagePrice, ParamSpec, ZdrEndpoint } from './contract.ts';
import { AppError, type MessageParams } from './errors.ts';
import { CallLog, callSignal, getJson, jsonOrText, postJson, transportError, upstreamMessage } from './upstream.ts';

export type { ImageModel, ImagePrice, ParamSpec, ZdrEndpoint };

export interface InputReference {
  type: 'image_url';
  image_url: { url: string };
}

export interface ImageRequest {
  model: string;
  prompt: string;
  n?: number;
  aspect_ratio?: string;
  resolution?: string;
  output_format?: string;
  quality?: string;
  seed?: number;
  input_references?: InputReference[];
  provider?: { only?: string[]; allow_fallbacks?: boolean };
}

/** What a call cost and who served it (also known for some failed calls). */
export interface Billing {
  cost: number | null;
  generationId: string | null;
  provider: string | null;
}

export interface ImageResult extends Billing {
  images: { b64: string; mediaType?: string }[];
  usage: Record<string, unknown> | null;
  debugId?: string;
}

/** Cache for catalog data that rarely changes (1 hour). */
class Cached<T> {
  private value: { at: number; data: T } | null = null;
  private readonly load: () => Promise<T>;
  constructor(load: () => Promise<T>) {
    this.load = load;
  }
  async get(force = false): Promise<T> {
    if (!force && this.value && Date.now() - this.value.at < 3_600_000) return this.value.data;
    const data = await this.load();
    this.value = { at: Date.now(), data };
    return data;
  }
}

const models = new Cached(async () => (await getJson<{ data: ImageModel[] }>('/images/models')).data);

/** All image models incl. supported parameters (public, no key needed). */
export function listImageModels(force = false): Promise<ImageModel[]> {
  return models.get(force);
}

interface PriceEntry {
  billable: string;
  unit: string;
  cost_usd: number;
  variant?: string;
}

/** Price of the cheapest endpoint: output image price, surcharge variants and input image price. */
export function cheapestPrice(endpoints: { pricing?: PriceEntry[] }[]): ImagePrice | null {
  let best: ImagePrice | null = null;
  for (const { pricing = [] } of endpoints) {
    const out = pricing.filter((p) => p.billable === 'output_image');
    const base = out.find((p) => !p.variant);
    if (!base || (best && base.cost_usd >= best.cost)) continue;
    const input = pricing.find((p) => p.billable === 'input_image' && p.cost_usd > 0);
    best = {
      cost: base.cost_usd,
      unit: base.unit,
      variants: Object.fromEntries(out.filter((p) => p.variant).map((p) => [p.variant as string, p.cost_usd])),
      ...(input ? { inputImage: { cost: input.cost_usd, unit: input.unit } } : {}),
    };
  }
  return best;
}

async function modelPrice(id: string): Promise<ImagePrice | null> {
  try {
    const body = await getJson<{ endpoints?: { pricing?: PriceEntry[] }[] }>(`/images/models/${id}/endpoints`);
    return cheapestPrice(body.endpoints ?? []);
  } catch {
    return null; // continue without a price
  }
}

const prices = new Cached(async () => {
  const queue = (await listImageModels()).map((m) => m.id);
  const map = new Map<string, ImagePrice>();
  // 8 requests at a time
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const price = await modelPrice(id);
      if (price) map.set(id, price);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return map;
});

/** Output prices per image model from the endpoint data (public). */
export function imagePrices(force = false): Promise<Map<string, ImagePrice>> {
  return prices.get(force);
}

const zdr = new Cached(async () => {
  const body = await getJson<{
    data: { model_id: string; tag: string; provider_name: string; safety_retention?: boolean }[];
  }>('/endpoints/zdr');
  const map = new Map<string, ZdrEndpoint[]>();
  for (const e of body.data) {
    if (!e.model_id || !e.tag) continue;
    const list = map.get(e.model_id) ?? [];
    if (!list.some((x) => x.tag === e.tag)) {
      list.push({ tag: e.tag, provider: e.provider_name, safetyRetention: Boolean(e.safety_retention) });
    }
    map.set(e.model_id, list);
  }
  return map;
});

/** model_id → ZDR endpoints (from GET /endpoints/zdr). */
export function zdrEndpoints(force = false): Promise<Map<string, ZdrEndpoint[]>> {
  return zdr.get(force);
}

/**
 * Error with a reference to the debug record. `code` is only set for errors we generate (not upstream errors).
 * `billing` is set when the call was answered (and possibly charged) but delivered no usable result.
 */
class ApiError extends AppError {
  debugId?: string;
  billing?: Billing;
  constructor(message: string, debugId?: string, code?: string, params?: MessageParams, billing?: Billing) {
    super(code, message, params);
    this.debugId = debugId;
    this.billing = billing;
  }
}

interface ImagesResponse {
  data?: { b64_json?: unknown; media_type?: string }[];
  usage?: Record<string, unknown>;
  id?: string;
  generation_id?: string;
  provider?: string;
  error?: { message?: string; metadata?: unknown };
}

function imagesOf(body: ImagesResponse): ImageResult['images'] {
  const data = Array.isArray(body.data) ? body.data : [];
  return data.flatMap((d) => (typeof d?.b64_json === 'string' ? [{ b64: d.b64_json, mediaType: d.media_type }] : []));
}

function httpError(status: number, text: string, body: ImagesResponse | null, debugId?: string): ApiError {
  const meta = body?.error?.metadata ? ` ${JSON.stringify(body.error.metadata).slice(0, 500)}` : '';
  return new ApiError(`HTTP ${status}: ${upstreamMessage(text)}${meta}`, debugId);
}

export async function generateImages(req: ImageRequest, abort?: AbortSignal): Promise<ImageResult> {
  apiKey();
  const log = new CallLog('/images', req);
  let res: Response;
  let text: string;
  try {
    res = await postJson('/images', req, callSignal(abort));
    text = await res.text();
  } catch (err) {
    const e = transportError(err, abort);
    throw new ApiError(e.message, await log.save(null, e.message), e.code, e.params);
  }
  log.received(res);
  const parsed = jsonOrText(text);
  const body = parsed && typeof parsed === 'object' ? (parsed as ImagesResponse) : null;
  const debugId = await log.save(parsed, res.ok ? undefined : upstreamMessage(text));
  if (!res.ok || !body) throw httpError(res.status, text, body, debugId);

  const images = imagesOf(body);
  const billing = billingOf(body, res.headers);
  if (!images.length) {
    const message = `Response without an image: ${text.slice(0, 300)}`;
    throw new ApiError(message, debugId, 'no_image_data', undefined, billing);
  }
  return { images, ...billing, usage: body.usage ?? null, debugId };
}

function billingOf(body: ImagesResponse, headers: Headers): Billing {
  const cost = body.usage?.cost;
  return {
    cost: typeof cost === 'number' ? cost : null,
    generationId: body.id ?? body.generation_id ?? headers.get('x-generation-id') ?? null,
    provider: body.provider ?? headers.get('x-openrouter-provider') ?? null,
  };
}

/** Debug record and billing of a failed image call (empty for other errors). */
export function failedCallInfo(err: unknown): { debugId?: string; billing?: Billing } {
  return err instanceof ApiError ? { debugId: err.debugId, billing: err.billing } : {};
}
