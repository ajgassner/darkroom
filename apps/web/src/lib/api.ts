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

/** JSON request against the local server. Throws ApiError with the server's message on failure. */
export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as ErrorBody;
  if (!res.ok) throw new ApiError(data, res.status);
  return data as T;
}

/** POST and read the NDJSON event stream line by line. */
export async function streamEvents(
  path: string,
  body: unknown,
  onEvent: (ev: RunEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as ErrorBody;
    throw new ApiError(data, res.status);
  }
  await readNdjson(res.body, (line) => onEvent(JSON.parse(line) as RunEvent));
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

export function downloadUrl(file: string, stripMeta: boolean): string {
  return `${outUrl(file)}?download=1${stripMeta ? '&clean=1' : ''}`;
}

export function elementPhotoUrl(element: string, file: string, size = 120): string {
  return `/api/elements/${encodeURIComponent(element)}/photos/${encodeURIComponent(file)}?size=${size}`;
}
