// Static files: generated results below out/ (reply.sendFile from app.ts, with range support) and the built web UI.
import fs from 'node:fs/promises';
import path from 'node:path';
import { OUT_DIR, WEB_DIST_DIR } from '@darkroom/core/config';
import { stripMetadata } from '@darkroom/core/image/strip';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, inside } from '../http.ts';

const UI_NOT_BUILT = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>darkroom</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5">
<h1>darkroom</h1>
<p>UI not built yet. Run <code>pnpm build</code> (or <code>pnpm dev</code> for development).</p>
</body>
</html>
`;

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

/**
 * Files below out/ that are never served: the manifest (and its temp file) and the debug records.
 * Compared on the resolved path, lowercased and with "/" separators, so case-insensitive file systems (macOS,
 * Windows), "x/../" detours, backslashes and Windows' ignored trailing dots/spaces cannot bypass the check.
 */
function isPrivate(file: string): boolean {
  const rel = path
    .relative(OUT_DIR, file)
    .split(/[\\/]+/)
    .map((part) => part.replace(/[. ]+$/, ''))
    .join('/')
    .toLowerCase();
  return rel.startsWith('manifest.jsonl') || (rel.startsWith('debug/') && rel.endsWith('.json'));
}

/**
 * Results only display as images or play as audio; <img>/<audio> in the UI are not affected by this policy.
 * default-src 'none' without script-src already keeps scripts (e.g. in an SVG) from running. `sandbox` is added on
 * top for everything but audio: browsers do not play audio in a sandboxed document opened in its own tab.
 */
const RESULT_CSP = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";

function resultCsp(file: string): string {
  return MIME[path.extname(file).toLowerCase()]?.startsWith('audio/') ? RESULT_CSP : `${RESULT_CSP}; sandbox`;
}

export async function fileRoutes(app: FastifyInstance) {
  const query = z.object({ download: z.string().optional(), clean: z.string().optional() });

  app.get('/out/*', async (req, reply) => {
    const file = inside(OUT_DIR, (req.params as { '*': string })['*']);
    // Results come from models (an SVG may contain scripts): opened in a tab they must not run code on this origin
    reply.header('Content-Security-Policy', resultCsp(file)).header('X-Content-Type-Options', 'nosniff');
    if (isPrivate(file)) throw new HttpError(404, 'not_found', 'Not found');
    const q = query.parse(req.query);
    // Download (optionally without metadata): serve as attachment
    if (q.download !== undefined) {
      const raw = await fs.readFile(file).catch(() => null);
      if (!raw) throw new HttpError(404, 'not_found', 'Not found');
      const data: Buffer = q.clean === '1' ? await stripMetadata(raw, file) : raw;
      return reply
        .header('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${path.basename(file).replace(/[^\w.-]/g, '_')}"`)
        .header('Cache-Control', 'no-store')
        .send(data);
    }
    // Result files never change: cache long-term
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.sendFile(path.relative(OUT_DIR, file), OUT_DIR, { cacheControl: false });
  });

  // Built web UI (dist/web): index.html without caching, hashed assets/* long-term
  const built = await fs
    .stat(path.join(WEB_DIST_DIR, 'index.html'))
    .then((s) => s.isFile())
    .catch(() => false);
  if (!built) {
    app.get('/', async (_req, reply) =>
      reply.code(503).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(UI_NOT_BUILT),
    );
    return;
  }
  await app.register(fastifyStatic, {
    root: WEB_DIST_DIR,
    prefix: '/',
    decorateReply: false,
    cacheControl: false,
    setHeaders: (res, filePath) => {
      const asset = filePath.includes(`${path.sep}assets${path.sep}`);
      res.header('Cache-Control', asset ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
}
