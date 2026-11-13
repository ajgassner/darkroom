// HTTP calls to OpenRouter: auth, timeouts, error messages and the debug log of each call.
import { API_BASE, apiKey, REQUEST_TIMEOUT_MS } from './config.ts';
import { pickHeaders, writeDebug } from './debug.ts';
import { AppError, type MessageParams, TIMEOUT_MESSAGE } from './errors.ts';

/** GET a public JSON endpoint (catalogs, no key needed). */
export async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    // Offline, DNS or timeout: the same code as for failed API calls (the fixed timeout is not REQUEST_TIMEOUT_MS)
    const message = (err as Error).message;
    throw new AppError('network_error', `Network error: ${message}`, { message });
  }
  if (!res.ok) {
    throw new AppError('catalog_http_error', `${path}: HTTP ${res.status}`, { source: path, status: res.status });
  }
  return (await res.json()) as T;
}

/** The caller's abort signal (cancel button, Ctrl+C) combined with a timeout. */
export function callSignal(abort?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return abort ? AbortSignal.any([abort, timeout]) : timeout;
}

/** POST JSON with the API key. */
export function postJson(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

/** Error text of an upstream error response: error.message of a JSON body, otherwise the start of the text. */
export function upstreamMessage(text: string): string {
  try {
    const message = JSON.parse(text)?.error?.message;
    if (typeof message === 'string') return message;
  } catch {
    // not JSON
  }
  return text.slice(0, 500);
}

/** HTTP error response of an upstream call; keeps the body for the debug log. */
export class HttpStatusError extends Error {
  readonly status: number;
  readonly text: string;
  constructor(status: number, text: string) {
    super(`HTTP ${status}: ${upstreamMessage(text)}`);
    this.status = status;
    this.text = text;
  }
}

/** Throw an HttpStatusError for a failed response. */
export async function ensureOk(res: Response): Promise<Response> {
  if (!res.ok) throw new HttpStatusError(res.status, await res.text());
  return res;
}

/** Parse a response body as JSON, or keep (the start of) the text for the debug log. */
export function jsonOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 4000) || null;
  }
}

/** Error for a call that got no HTTP response: cancelled, timed out or network failure. */
export function transportError(
  err: unknown,
  abort?: AbortSignal,
): { message: string; code: string; params?: MessageParams } {
  if (abort?.aborted) return { message: 'Aborted', code: 'aborted' };
  const e = err as Error;
  if (e.name === 'TimeoutError') return { message: TIMEOUT_MESSAGE, code: 'timeout' };
  return { message: `Network error: ${e.message}`, code: 'network_error', params: { message: e.message } };
}

/** One upstream call as recorded in the debug log (out/debug/<id>.json). */
export class CallLog {
  private readonly t0 = performance.now();
  private status: number | null = null;
  private headers: Record<string, string> = {};

  private readonly path: string;
  request: unknown;

  constructor(path: string, request: unknown) {
    this.path = path;
    this.request = request;
  }

  /** Remember status and relevant headers of the response. */
  received(res: Response): void {
    this.status = res.status;
    this.headers = pickHeaders(res.headers);
  }

  /** Milliseconds since the call started. */
  elapsed(): number {
    return Math.round(performance.now() - this.t0);
  }

  /** Write the debug record; returns its ID, or undefined if it could not be written. */
  save(response: unknown, error?: string): Promise<string | undefined> {
    return writeDebug({
      endpoint: `${API_BASE}${this.path}`,
      method: 'POST',
      status: this.status,
      durationMs: this.elapsed(),
      request: this.request,
      response,
      responseHeaders: this.headers,
      ...(error ? { error } : {}),
    }).catch(() => undefined);
  }
}
