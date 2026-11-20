import fs from 'node:fs/promises';
import path from 'node:path';
import { handleWorkerRequest } from '../src/index';

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

async function handleWorkerSourceRequest(): Promise<Response> {
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
    return new Response(JSON.stringify({ ok: true, files }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Failed to load worker source files.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

async function routeRequest(request: Request): Promise<Response> {
  const incomingUrl = new URL(request.url);

  if (request.method === 'GET' && incomingUrl.pathname === '/api/worker-source') {
    return handleWorkerSourceRequest();
  }

  // Strip the internal /api prefix added by vercel.json rewrites, except for /api/test
  if (incomingUrl.pathname !== '/api/test' && incomingUrl.pathname.startsWith('/api/')) {
    incomingUrl.pathname = incomingUrl.pathname.slice('/api'.length);
  }

  const bodyBuffer =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();

  const forwardedRequest = new Request(incomingUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: bodyBuffer && bodyBuffer.byteLength > 0 ? bodyBuffer : undefined,
  });

  return handleWorkerRequest(forwardedRequest, {
    ADDON_BRAND: process.env.ADDON_BRAND || 'IPTV 8K',
    MATCH_THRESHOLD: process.env.MATCH_THRESHOLD || '0.85',
  });
}

export async function GET(request: Request): Promise<Response> {
  return routeRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return routeRequest(request);
}

export async function OPTIONS(request: Request): Promise<Response> {
  return routeRequest(request);
}
