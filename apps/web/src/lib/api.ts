import type { RunEvent } from './types';

/** Server error: English message plus the machine-readable code the UI translates. */
class ApiError extends Error {
  readonly code?: string;
  readonly params?: Record<string, unknown>;
  constructor(data: { error?: string; code?: string; params?: Record<string, unknown> }, status: number) {
    super(data.error || `HTTP ${status}`);
    this.code = data.code;
    this.params = data.params;
  }
}

type ErrorBody = { error?: string; code?: string; params?: Record<string, unknown> };

/** The server stopped (or the connection broke): fetch rejects with a TypeError ("Failed to fetch"). */
function unreachable(): ApiError {
  return new ApiError(
    {
      error: 'darkroom is not reachable. Is it still running? Start it with darkroom start.',
      code: 'server_unreachable',
    },
    0,
  );
}

/** Run a network step; a TypeError (no connection) becomes the coded server_unreachable error. */
async function network<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    throw err instanceof TypeError ? unreachable() : err;
  }
}

/** JSON request against the local server. Throws ApiError with the server's message on failure. */
export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await network(() =>
    fetch(path, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }),
  );
  const data = (await res.json().catch(() => ({}))) as ErrorBody;
  if (!res.ok) throw new ApiError(data, res.status);
  return data as T;
}

/**
 * POST and read the NDJSON event stream line by line. A fatal event (the run failed as a whole) is thrown as
 * ApiError, so its code and params reach errorMessage() like those of an HTTP error. A connection that breaks
 * mid-stream (server stopped) is reported as server_unreachable too; cancelling rejects with an AbortError.
 */
export async function streamEvents(
  path: string,
  body: unknown,
  onEvent: (ev: RunEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await network(() =>
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }),
  );
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as ErrorBody;
    throw new ApiError(data, res.status);
  }
  const stream = res.body;
  await network(() =>
    readNdjson(stream, (line) => {
      const ev = JSON.parse(line) as RunEvent;
      if (ev.type === 'fatal') throw new ApiError(ev, res.status);
      onEvent(ev);
    }),
  );
}

/** Call `onLine` for every non-empty line of a text stream (NDJSON: one JSON object per line). */
async function readNdjson(body: ReadableStream<BufferSource>, onLine: (line: string) => void): Promise<void> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    const lines = (pending + r.value).split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onLine(line.trim());
  }
  if (pending.trim()) onLine(pending.trim());
}

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** URL of a file below out/, with each path segment encoded. */
export function outUrl(file: string): string {
  return `/out/${file.split('/').map(encodeURIComponent).join('/')}`;
}

/** Image formats that can have transparency (they get a checkerboard behind them; JPEGs never need one). */
export function canBeTransparent(file: string): boolean {
  return /\.(png|webp|avif|gif)$/i.test(file);
}

export function downloadUrl(file: string, stripMeta: boolean): string {
  return `${outUrl(file)}?download=1${stripMeta ? '&clean=1' : ''}`;
}

export function elementPhotoUrl(element: string, file: string, size = 120): string {
  return `/api/elements/${encodeURIComponent(element)}/photos/${encodeURIComponent(file)}?size=${size}`;
}
