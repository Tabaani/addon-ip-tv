import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { handleWorkerRequest } from '../src/index.js';

interface VercelNodeRequest extends IncomingMessage {
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

const WORKER_FILES: Array<{ label: string; diskPath: string; language: string; description: string }> = [
  {
    label: 'wrangler.toml',
    diskPath: 'wrangler.toml',
    language: 'toml',
    description: 'Cloudflare Workers deployment manifest pointing to src/index.ts.',
  },
  {
    label: 'package.json',
    diskPath: 'worker-package.json',
    language: 'json',
    description: 'Standalone Cloudflare Workers package.json (zero runtime dependencies).',
  },
  {
    label: 'src/index.ts',
    diskPath: 'src/index.ts',
    language: 'typescript',
    description: 'Native Web Fetch API router, CORS layer, 6h/24h cache, and Stremio endpoints.',
  },
  {
    label: 'src/matcher.ts',
    diskPath: 'src/matcher.ts',
    language: 'typescript',
    description: 'Title normalization, TMDB/IMDb exact matching, Dice + Levenshtein scoring, and filters.',
  },
  {
    label: 'src/ui.ts',
    diskPath: 'src/ui.ts',
    language: 'typescript',
    description: 'Zero-dependency HTML configuration page served at GET / and GET /configure on Workers.',
  },
];

function getParam(url: URL, key: string): string {
  return (url.searchParams.get(key) ?? '').trim();
}

async function readRawBody(req: VercelNodeRequest): Promise<string | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return undefined;
  }

  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body;
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf-8');
    return JSON.stringify(req.body);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks).toString('utf-8') : undefined;
}

async function handleWorkerSource(res: ServerResponse): Promise<void> {
  const rootDir = process.cwd();
  try {
    const files = await Promise.all(
      WORKER_FILES.map(async (entry) => {
        const resolved = path.resolve(rootDir, entry.diskPath);
        if (!resolved.startsWith(rootDir + path.sep)) {
          throw new Error('Invalid source path');
        }
        const content = await fs.readFile(resolved, 'utf-8');
        return {
          filename: entry.label,
          language: entry.language,
          description: entry.description,
          content,
          lines: content.split('\n').length,
        };
      })
    );
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(JSON.stringify({ ok: true, files }));
  } catch {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'Failed to load worker source files.' }));
  }
}

function buildCatalogExtraSegment(parsedUrl: URL, rawExtra: string): string {
  const parts: string[] = [];
  if (rawExtra) parts.push(rawExtra);

  for (const key of ['search', 'skip', 'genre']) {
    const val = parsedUrl.searchParams.get(key);
    if (val !== null && val !== '' && !rawExtra.includes(`${key}=`)) {
      parts.push(`${key}=${encodeURIComponent(val)}`);
    }
  }
  return parts.join('&');
}

function resolveCanonicalPath(parsedUrl: URL): string {
  const route = getParam(parsedUrl, '__route');
  const config = getParam(parsedUrl, 'config');
  const type = getParam(parsedUrl, 'type');
  const id = getParam(parsedUrl, 'id');
  const extra = buildCatalogExtraSegment(parsedUrl, getParam(parsedUrl, 'extra'));

  switch (route) {
    case 'test':
      return '/api/test';
    case 'live-channels':
      return '/api/live-channels';
    case 'worker-ui':
      return '/worker-ui';
    case 'root-manifest':
      return '/manifest.json';
    case 'manifest':
      return `/${encodeURIComponent(config)}/manifest.json`;
    case 'catalog':
      if (extra) {
        return `/${encodeURIComponent(config)}/catalog/${encodeURIComponent(type)}/${encodeURIComponent(id)}/${extra}.json`;
      }
      return `/${encodeURIComponent(config)}/catalog/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
    case 'meta':
      return `/${encodeURIComponent(config)}/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
    case 'stream':
      return `/${encodeURIComponent(config)}/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
    case 'tv-manifest':
      return `/tv/${encodeURIComponent(config)}/manifest.json`;
    case 'tv-catalog':
      if (extra) {
        return `/tv/${encodeURIComponent(config)}/catalog/tv/${encodeURIComponent(id)}/${extra}.json`;
      }
      return `/tv/${encodeURIComponent(config)}/catalog/tv/${encodeURIComponent(id)}.json`;
    case 'tv-meta':
      return `/tv/${encodeURIComponent(config)}/meta/tv/${encodeURIComponent(id)}.json`;
    case 'tv-stream':
      return `/tv/${encodeURIComponent(config)}/stream/tv/${encodeURIComponent(id)}.json`;
    default:
      return parsedUrl.pathname;
  }
}

export default async function handler(req: VercelNodeRequest, res: ServerResponse): Promise<void> {
  try {
    const proto =
      String(req.headers['x-forwarded-proto'] ?? 'https')
        .split(',')[0]
        .trim() || 'https';
    const host =
      String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost')
        .split(',')[0]
        .trim() || 'localhost';

    const incomingUrl = new URL(req.url || '/', `${proto}://${host}`);
    const route = getParam(incomingUrl, '__route');

    if (req.method === 'GET' && (route === 'worker-source' || incomingUrl.pathname === '/api/worker-source')) {
      await handleWorkerSource(res);
      return;
    }

    const canonicalPath = resolveCanonicalPath(incomingUrl);
    const targetUrl = `${proto}://${host}${canonicalPath}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else {
        headers.set(key, value);
      }
    }

    const bodyText = await readRawBody(req);
    const webRequest = new Request(targetUrl, {
      method: req.method || 'GET',
      headers,
      body: bodyText,
    });

    const webResponse = await handleWorkerRequest(webRequest, {
      ADDON_BRAND: process.env.ADDON_BRAND || 'IPTV 8K',
      MATCH_THRESHOLD: process.env.MATCH_THRESHOLD || '0.85',
    });

    res.statusCode = webResponse.status;
    webResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const buffer = Buffer.from(await webResponse.arrayBuffer());
    res.end(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error.';
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.end(JSON.stringify({ ok: false, error: `Addon server error: ${message}` }));
  }
}
