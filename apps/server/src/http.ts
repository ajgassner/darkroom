// Shared HTTP helpers: error mapping, local-only security checks and NDJSON streaming.
import path from 'node:path';
import { hasApiKey, PORT } from '@darkroom/core/config';
import { AppError, type MessageParams } from '@darkroom/core/errors';
import type { FastifyReply, FastifyRequest } from 'fastify';

export class HttpError extends AppError {
  status: number;
  constructor(status: number, code: string, message: string, params?: MessageParams) {
    super(code, message, params);
    this.status = status;
  }
}

export type ErrorBody = { error: string; code?: string; params?: MessageParams };

/** Error response body: English text plus code/params for errors we generate. */
export function errorBody(err: unknown): ErrorBody {
  const error = err instanceof Error ? err.message : String(err);
  if (err instanceof AppError && err.code)
    return { error, code: err.code, ...(err.params ? { params: err.params } : {}) };
  return { error };
}

/** HTTP status for an error: explicit HttpError status, 404 for "*_not_found" codes, 400 for other AppErrors. */
export function statusOf(err: unknown): number {
  if (err instanceof HttpError) return err.status;
  if (err instanceof AppError && err.code) return err.code.endsWith('_not_found') ? 404 : 400;
  const s = (err as { statusCode?: number }).statusCode;
  return typeof s === 'number' && s >= 400 && s < 600 ? s : 500;
}

export function requireApiKey() {
  if (!hasApiKey()) throw new HttpError(400, 'api_key_missing', 'OPENROUTER_API_KEY is missing (.env)');
}

export function invalidName(name: string): HttpError {
  return new HttpError(400, 'invalid_name', 'Invalid name (allowed: letters, digits, _ - .)', { name });
}

/** Absolute path below `dir`; 403 for paths that would leave it. */
export function inside(dir: string, rel: string): string {
  const p = path.resolve(dir, rel);
  if (!p.startsWith(dir + path.sep)) throw new HttpError(403, 'forbidden', 'Forbidden');
  return p;
}

/** Vite dev server (proxies /api and /out to this server). */
const DEV_HOSTS = ['localhost:5173', '127.0.0.1:5173'];

/**
 * Protection against foreign websites (CSRF, DNS rebinding): only requests from localhost (and the Vite dev server).
 * Requests with a body must be JSON, which browsers cannot send cross-origin without a preflight.
 */
export async function localOnly(req: FastifyRequest) {
  const okHosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`, ...DEV_HOSTS];
  if (!okHosts.includes(req.headers.host ?? '')) throw new HttpError(403, 'host_not_allowed', 'Host not allowed');
  const origin = req.headers.origin;
  if (origin && !okHosts.some((h) => origin === `http://${h}`)) {
    throw new HttpError(403, 'origin_not_allowed', 'Origin not allowed');
  }
  const m = req.method;
  if (!['GET', 'HEAD', 'DELETE'].includes(m) && !(req.headers['content-type'] ?? '').includes('application/json')) {
    throw new HttpError(415, 'json_required', 'Content-Type application/json expected');
  }
}

/**
 * NDJSON stream: one event per finished result. If the browser disconnects (cancel button, page closed),
 * the signal aborts the running API calls as well.
 */
export async function streamRun(
  reply: FastifyReply,
  run: (send: (ev: unknown) => void, signal: AbortSignal) => Promise<unknown>,
) {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) ac.abort();
  });
  const send = (ev: unknown) => {
    if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(ev)}\n`);
  };
  try {
    await run(send, ac.signal);
  } catch (e) {
    send({ type: 'fatal', ...errorBody(e) });
  }
  if (!res.destroyed) res.end();
}

/** Decode a "data:<mime>;base64,<data>" URL. */
export function decodeDataUrl(dataUrl: string): Buffer {
  const match = /^data:[^;,]*;base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new HttpError(400, 'data_url_missing', 'dataUrl is missing');
  return Buffer.from(match[1], 'base64');
}
