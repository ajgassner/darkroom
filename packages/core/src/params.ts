// Adapting the requested image parameters to what a model supports.
import { addWarning, type WarningList } from './errors.ts';
import type { ImageModel, ImageRequest, ParamSpec } from './openrouter.ts';

/** The image parameters a run asks for (UI/CLI values, may not fit every model). */
export interface WantedParams {
  aspectRatio?: string;
  resolution?: string;
  outputFormat?: string;
  quality?: string;
  seed?: number;
}

type Params = Partial<ImageRequest>;

const RES_ORDER = ['512', '768', '1K', '1.5K', '2K', '4K'];

function ratio(r: string): number {
  const [a, b] = r.split(':').map(Number);
  return a && b ? a / b : Number.NaN;
}

function enumValues(spec: ParamSpec | undefined): string[] | null {
  return spec?.type === 'enum' ? spec.values : null;
}

/** The value closest to `want` (by distance), ignoring values the distance cannot be computed for. */
function nearest(values: string[], distance: (v: string) => number): string | undefined {
  return values
    .map((v) => ({ v, d: distance(v) }))
    .filter((x) => !Number.isNaN(x.d))
    .sort((a, b) => a.d - b.d)[0]?.v;
}

function fitAspect(spec: ParamSpec | undefined, want: string, params: Params, w: WarningList): void {
  const values = enumValues(spec);
  if (!values) {
    addWarning(w, 'aspect_unsupported', `Aspect ratio is not supported (${want} ignored)`, { value: want });
  } else if (values.includes(want)) {
    params.aspect_ratio = want;
  } else {
    const best = nearest(values, (v) => Math.abs(Math.log(ratio(v) / ratio(want))));
    if (!best) return;
    params.aspect_ratio = best;
    addWarning(w, 'aspect_adjusted', `Aspect ratio ${want} not available, using ${best}`, { from: want, to: best });
  }
}

function fitResolution(spec: ParamSpec | undefined, want: string, params: Params, w: WarningList): void {
  const values = enumValues(spec);
  if (!values) {
    addWarning(w, 'size_unsupported', `Size is not supported (${want} ignored)`, { value: want });
  } else if (values.includes(want)) {
    params.resolution = want;
  } else {
    const rank = (v: string) => (RES_ORDER.includes(v) ? RES_ORDER.indexOf(v) : Number.NaN);
    const best = nearest(values, (v) => Math.abs(rank(v) - RES_ORDER.indexOf(want)));
    if (!best) return;
    params.resolution = best;
    addWarning(w, 'size_adjusted', `Size ${want} not available, using ${best}`, { from: want, to: best });
  }
}

function fitFormat(spec: ParamSpec | undefined, want: string, params: Params, w: WarningList): void {
  if (enumValues(spec)?.includes(want)) {
    params.output_format = want;
    return;
  }
  addWarning(w, 'format_unsupported', `File format ${want} cannot be selected, the model returns its default format`, {
    value: want,
  });
}

/** Unknown model: pass the values through unchanged. */
function passThrough(o: WantedParams, w: WarningList): Params {
  addWarning(w, 'model_unknown', 'Model not found in the image models API, parameters sent unchecked');
  return {
    ...(o.aspectRatio ? { aspect_ratio: o.aspectRatio } : {}),
    ...(o.resolution ? { resolution: o.resolution } : {}),
    ...(o.outputFormat ? { output_format: o.outputFormat } : {}),
    ...(o.quality ? { quality: o.quality } : {}),
    ...(o.seed !== undefined ? { seed: o.seed } : {}),
  };
}

/** Adapt the parameters to the capabilities of the model; adjustments are reported as warnings. */
export function fitParams(model: ImageModel | undefined, o: WantedParams): { params: Params } & WarningList {
  const w: WarningList = { warnings: [], notices: [] };
  const sp = model?.supported_parameters;
  if (!sp) return { params: passThrough(o, w), ...w };

  const params: Params = {};
  if (o.aspectRatio) fitAspect(sp.aspect_ratio, o.aspectRatio, params, w);
  if (o.resolution) fitResolution(sp.resolution, o.resolution, params, w);
  if (o.outputFormat) fitFormat(sp.output_format, o.outputFormat, params, w);
  if (o.quality && enumValues(sp.quality)?.includes(o.quality)) params.quality = o.quality;
  if (o.seed !== undefined && sp.seed) params.seed = o.seed;
  return { params, ...w };
}

/** Images per call the model allows (n). */
export function maxN(model: ImageModel | undefined): number {
  const s = model?.supported_parameters?.n;
  return s?.type === 'range' ? Math.max(1, s.max) : 1;
}

/** Reference image limit: null for unknown models (no limit applied), 0 without reference support. */
export function maxRefs(model: ImageModel | undefined): number | null {
  if (!model) return null;
  const s = model.supported_parameters?.input_references;
  return s?.type === 'range' ? s.max : 0;
}
