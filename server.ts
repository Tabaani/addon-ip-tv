import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { handleWorkerRequest } from './src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Bridge an Express request directly into the native Web Fetch API Worker handler
 * (src/index.ts) so the running server executes the exact same Cloudflare Worker code.
 */
async function bridgeToWorker(req: express.Request, res: express.Response): Promise<void> {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() || req.get('host') || `localhost:${PORT}`;
  const fullUrl = `${proto}://${host}${req.originalUrl}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  let body: BodyInit | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  }

  const webRequest = new Request(fullUrl, {
    method: req.method,
    headers,
    body,
  });

  const webResponse = await handleWorkerRequest(webRequest, {
    ADDON_BRAND: process.env.ADDON_BRAND || 'IPTV 8K',
    MATCH_THRESHOLD: process.env.MATCH_THRESHOLD || '0.85',
  });

  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  const buffer = Buffer.from(await webResponse.arrayBuffer());
  res.send(buffer);
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

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '512kb' }));

  // Serve exact Cloudflare Worker source files from disk for the Deploy Worker console
  app.get('/api/worker-source', async (_req, res) => {
    try {
      const files = await Promise.all(
        WORKER_FILES.map(async (entry) => {
          const resolved = path.resolve(__dirname, entry.diskPath);
          if (!resolved.startsWith(__dirname + path.sep)) {
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
      res.json({ ok: true, files });
    } catch {
      res.status(500).json({ ok: false, error: 'Failed to load worker source files.' });
    }
  });

  // Mount live Cloudflare Worker API & Stremio Addon protocol endpoints
  app.all('/api/test', bridgeToWorker);
  app.all('/api/live-channels', bridgeToWorker);
  app.all('/worker-ui', bridgeToWorker);
  app.all('/manifest.json', bridgeToWorker);
  app.all('/tv/:config/manifest.json', bridgeToWorker);
  app.all('/tv/:config/catalog/tv/:id.json', bridgeToWorker);
  app.all('/tv/:config/catalog/tv/:id/:extra.json', bridgeToWorker);
  app.all('/tv/:config/meta/tv/:id.json', bridgeToWorker);
  app.all('/tv/:config/stream/tv/:id.json', bridgeToWorker);
  app.all('/:config/manifest.json', bridgeToWorker);
  app.all('/:config/catalog/:type/:id.json', bridgeToWorker);
  app.all('/:config/catalog/:type/:id/:extra.json', bridgeToWorker);
  app.all('/:config/meta/:type/:id.json', bridgeToWorker);
  app.all('/:config/stream/:type/:id.json', bridgeToWorker);

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`XtreamBridge server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
