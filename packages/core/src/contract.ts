// API contract: the data shapes exchanged between the server and its clients (web UI, CLI).
// Pure types only, no runtime imports, so the browser bundle can import them as well.

export type PrivacyMode = 'zdr' | 'zdr-strict' | 'off';
export type MessageParams = Record<string, string | number>;

/** A warning in machine-readable form (stored in ManifestEntry.notices). */
export interface Notice {
  code: string;
  params?: MessageParams;
}

// ---------------------------------------------------------------- Models

export type ParamSpec =
  | { type: 'enum'; values: string[] }
  | { type: 'range'; min: number; max: number }
  | { type: 'boolean' };

export interface ZdrEndpoint {
  tag: string;
  provider: string;
  safetyRetention: boolean;
}

export interface ImagePrice {
  /** Price per unit in USD (cheapest endpoint). */
  cost: number;
  unit: 'image' | 'megapixel' | 'token' | string;
  /** Surcharge variants, e.g. high_resolution. */
  variants: Record<string, number>;
  /** Price per input image (if charged). */
  inputImage?: { cost: number; unit: string };
}

/** Image model as listed by the OpenRouter image models API. */
export interface ImageModel {
  id: string;
  name: string;
  description?: string;
  created?: number;
  supported_parameters: Record<string, ParamSpec>;
  supports_streaming?: boolean;
}

/** Image model as returned by GET /api/models (with ZDR endpoints and price). */
export interface ImageModelInfo {
  id: string;
  name: string;
  created?: number;
  supported_parameters: Record<string, ParamSpec>;
  zdr: ZdrEndpoint[];
  price: ImagePrice | null;
}

export interface SpeechModel {
  id: string;
  name: string;
  description: string;
  pricing: Record<string, string>;
  voices: string[];
  cloning: boolean;
  multiRef: boolean;
  zdr: ZdrEndpoint[];
}

export interface MusicModel {
  id: string;
  name: string;
  description: string;
  zdr: ZdrEndpoint[];
}

// ---------------------------------------------------------------- Elements and voices

export type ElementType = 'person' | 'logo' | 'object' | 'location' | 'style';

export interface ElementConfig {
  label: string;
  type: ElementType;
  instructions: string;
}

export interface ElementInfo extends ElementConfig {
  name: string;
  photos: string[];
}

export interface VoiceInfo {
  name: string;
  label: string;
  /** Full transcript in sample order (matches the combined clip). */
  transcript: string;
  /** Transcript per sample. */
  transcripts: Record<string, string>;
  samples: string[];
}

// ---------------------------------------------------------------- Results

export interface ManifestEntry {
  id?: string;
  /** Missing in old entries: then image. */
  kind?: 'image' | 'audio';
  /** Tool (crop, upscale, relight, …) and source file. */
  tool?: string;
  source?: string;
  /** Options the tool ran with (e.g. { preset: 'golden' }), so the UI can render a translated label. */
  toolOptions?: Record<string, string>;
  /** Audio: voice (name of the model voice or voice:<own voice>). */
  voice?: string;
  /** Voice preview: counts towards costs, does not appear in the gallery. */
  demo?: boolean;
  /** Reference to out/debug/<id>.json (request/response of the API call). */
  debugId?: string;
  runId: string;
  /** Time of deletion; the file is removed then, costs still count. */
  deleted?: string;
  ts: string;
  ok: boolean;
  file: string | null;
  /** English error text (also for upstream API errors). */
  error?: string;
  /** Code + params for errors we generate (not set for upstream API errors). */
  errorCode?: string;
  errorParams?: MessageParams;
  /** English label; for tool runs a readable tool label (e.g. "Relight: golden hour"). */
  prompt: string;
  fullPrompt: string;
  model: string;
  element: string | null;
  /** All elements used (dropdown + @mentions). */
  elements?: string[];
  usePrefix: boolean;
  /** Additional references (paths relative to out/). */
  extraRefs: string[];
  refCount: number;
  params: Record<string, unknown>;
  privacy: string;
  providerRestriction: string[] | null;
  /** English warning texts (CLI/debug). */
  warnings: string[];
  /** The same warnings as codes for the UI (one per warning). */
  notices?: Notice[];
  generationId: string | null;
  provider: string | null;
  /** Cost in USD for this image (call cost / number of images in the call). */
  cost: number | null;
  callCost: number | null;
  durationMs: number;
  mediaType: string | null;
}

export interface CostSummary {
  total: number;
  images: number;
  byModel: Record<string, { cost: number; images: number }>;
}

/** Events streamed as NDJSON by /api/generate, /api/tool, /api/speech and /api/music. */
export type RunEvent =
  | { type: 'start'; runId: string; plan: { model: string; count: number }[] }
  | { type: 'image'; entry: ManifestEntry }
  | { type: 'error'; entry: ManifestEntry }
  | { type: 'done'; runId: string; images: number; failed: number; cost: number };

/** Final stream event when a run fails as a whole. */
export type FatalEvent = { type: 'fatal'; error: string; code?: string; params?: MessageParams };

export interface DebugRecord {
  id: string;
  ts: string;
  endpoint: string;
  method: string;
  status: number | null;
  durationMs: number;
  request: unknown;
  response: unknown;
  responseHeaders: Record<string, string>;
  error?: string;
  /** Sent reference images/audio, relative to out/. */
  sentFiles: { index: number; file: string; mime: string; bytes: number; width?: number; height?: number }[];
}

// ---------------------------------------------------------------- Status

export interface Preset {
  name: string;
  prompt: string;
}

/** GET /api/status */
/** GET /api/update: a newer release, if there is one. */
export interface UpdateResponse {
  current: string;
  update: { version: string; url: string; command: string } | null;
}

export interface StatusResponse {
  hasKey: boolean;
  /** Where the key is stored when entered in the UI */
  envFile: string;
  defaultModel: string;
  defaultPrivacy: PrivacyMode;
  refMaxSide: number;
  defaultInstructions: string;
  transcribe: { engine: 'local' | 'api'; apiModel: string };
  relightPresets: Record<string, string>;
  costs: CostSummary;
}
