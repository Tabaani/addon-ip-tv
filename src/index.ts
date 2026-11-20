/**
 * XtreamBridge — Cloudflare Workers Stremio Addon
 *
 * Native Web Fetch API implementation (zero Node-only HTTP server dependencies).
 * Bridges Xtream Codes IPTV 8K VOD movies and series to Stremio Cinemeta pages
 * using IMDb tt IDs, TMDB ID priority matching, and normalized fuzzy scoring.
 */

import {
  CanonicalMeta,
  DEFAULT_MATCH_THRESHOLD,
  XtreamCategory,
  XtreamSeriesItem,
  XtreamVodItem,
  extractQualityLabel,
  findBestMatches,
  normalizeTitle,
  parseKeywordList,
  passesCategoryAndKeywordFilter,
} from './matcher.js';
import { renderConfigHtml } from './ui.js';

export interface WorkerEnv {
  ADDON_BRAND?: string;
  MATCH_THRESHOLD?: string;
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface AddonConfig {
  host: string;
  username: string;
  password: string;
  tmdbKey?: string;
  includeKeywords?: string;
  excludeKeywords?: string;
}

interface XtreamAuthResponse {
  user_info?: {
    username?: string;
    status?: string;
    auth?: number | string;
    exp_date?: string | number | null;
    is_trial?: string | number;
    active_cons?: string | number;
    max_connections?: string | number;
    message?: string;
  };
  server_info?: {
    url?: string;
    port?: string;
    https_port?: string;
    server_protocol?: string;
    timezone?: string;
  };
}

interface XtreamSeriesEpisode {
  id: string | number;
  episode_num: string | number;
  title?: string;
  container_extension?: string;
  season?: string | number;
  info?: {
    duration?: string;
    plot?: string;
    releasedate?: string;
    release_date?: string;
    movie_image?: string;
    bitrate?: number;
  };
}

interface XtreamSeriesInfoResponse {
  info?: {
    name?: string;
    cover?: string;
    plot?: string;
    cast?: string;
    director?: string;
    genre?: string;
    rating?: string | number;
    backdrop_path?: string | string[];
    tmdb?: string | number;
    releaseDate?: string;
    release_date?: string;
  };
  episodes?: Record<string, XtreamSeriesEpisode[]> | XtreamSeriesEpisode[][];
}

interface XtreamVodInfoResponse {
  info?: {
    name?: string;
    o_name?: string;
    movie_image?: string;
    cover_big?: string;
    backdrop_path?: string | string[];
    plot?: string;
    description?: string;
    cast?: string;
    actors?: string;
    director?: string;
    genre?: string;
    releasedate?: string;
    release_date?: string;
    duration?: string;
    rating?: string | number;
    tmdb_id?: string | number;
    imdb_id?: string;
  };
  movie_data?: {
    stream_id?: number | string;
    name?: string;
    container_extension?: string;
  };
}

interface CinemetaResponse {
  meta?: {
    id?: string;
    imdb_id?: string;
    moviedb_id?: number | string;
    type?: string;
    name?: string;
    originalName?: string;
    year?: string | number;
    releaseInfo?: string;
    aliases?: string[];
  };
}

interface TmdbFindResponse {
  movie_results?: Array<{
    id: number;
    title?: string;
    original_title?: string;
    release_date?: string;
  }>;
  tv_results?: Array<{
    id: number;
    name?: string;
    original_name?: string;
    first_air_date?: string;
  }>;
}

interface StremioMetaPreview {
  id: string;
  type: 'movie' | 'series';
  name: string;
  poster?: string;
  posterShape?: 'poster';
  releaseInfo?: string;
  imdbRating?: string;
  description?: string;
}

interface StremioStream {
  name: string;
  title: string;
  url: string;
  behaviorHints: {
    notWebReady: true;
    bingeGroup?: string;
  };
}

const XTREAM_USER_AGENT = 'VLC/3.0.20 LibVLC/3.0.20';
const CATALOG_CACHE_TTL = 6 * 60 * 60; // 6 hours
const META_CACHE_TTL = 24 * 60 * 60; // 24 hours
const CATALOG_PAGE_SIZE = 100;
const UPSTREAM_TIMEOUT_MS = 18_000;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

// Bounded in-memory TTL fallback used when running outside Cloudflare Workers (e.g. Node dev)
interface MemoryCacheEntry {
  expiresAt: number;
  body: string;
}
const memoryCache = new Map<string, MemoryCacheEntry>();
const MEMORY_CACHE_MAX_ENTRIES = 80;

function getEdgeCache(): Cache | null {
  const g = globalThis as unknown as { caches?: { default?: Cache } };
  return g.caches?.default ?? null;
}

async function readCache<T>(cacheKeyUrl: string): Promise<T | null> {
  const edgeCache = getEdgeCache();
  if (edgeCache) {
    const cached = await edgeCache.match(new Request(cacheKeyUrl, { method: 'GET' }));
    if (cached) {
      try {
        return (await cached.json()) as T;
      } catch {
        return null;
      }
    }
    return null;
  }

  const entry = memoryCache.get(cacheKeyUrl);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(cacheKeyUrl);
    return null;
  }
  try {
    return JSON.parse(entry.body) as T;
  } catch {
    return null;
  }
}

async function writeCache(
  cacheKeyUrl: string,
  payload: unknown,
  ttlSeconds: number,
  ctx?: WorkerExecutionContext
): Promise<void> {
  const serialized = JSON.stringify(payload);
  const edgeCache = getEdgeCache();
  if (edgeCache) {
    const response = new Response(serialized, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${ttlSeconds}`,
      },
    });
    const putPromise = edgeCache.put(new Request(cacheKeyUrl, { method: 'GET' }), response);
    if (ctx) {
      ctx.waitUntil(putPromise);
    } else {
      await putPromise;
    }
    return;
  }

  if (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }
  memoryCache.set(cacheKeyUrl, {
    expiresAt: Date.now() + ttlSeconds * 1000,
    body: serialized,
  });
}

function jsonResponse(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...(extraHeaders ?? {}),
    },
  });
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

/**
 * Validate and normalize an Xtream Codes host URL.
 * Preserves exact http:// vs https:// protocol and removes trailing slashes.
 * Blocks loopback, private, and cloud metadata addresses to prevent SSRF.
 */
export function validateAndNormalizeHost(rawHost: string): { ok: true; host: string } | { ok: false; error: string } {
  if (!rawHost || typeof rawHost !== 'string') {
    return { ok: false, error: 'Xtream Codes host URL is required.' };
  }

  const trimmed = rawHost.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Invalid host URL format. Include http:// or https:// (e.g. http://example.com:8080).' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Host URL must start with http:// or https://.' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Do not embed credentials inside the host URL. Use the dedicated username and password fields.' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || isBlockedPrivateHost(hostname)) {
    return { ok: false, error: 'Host points to a restricted local or private network address.' };
  }

  // Preserve exact protocol (http:// vs https://) and optional port/subpath without trailing slash
  const cleanPath = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : '';
  return {
    ok: true,
    host: `${parsed.protocol}//${parsed.host}${cleanPath}`,
  };
}

function isBlockedPrivateHost(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === 'metadata.google.internal' ||
    hostname === 'metadata' ||
    hostname === '::1' ||
    hostname === '0:0:0:0:0:0:0:1'
  ) {
    return true;
  }

  // IPv6 unique local / link-local / loopback / IPv4-mapped
  if (hostname.includes(':')) {
    const lower = hostname.toLowerCase();
    if (
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80') ||
      lower.startsWith('::ffff:127.') ||
      lower.startsWith('::ffff:10.') ||
      lower.startsWith('::ffff:192.168.') ||
      lower.startsWith('::ffff:169.254.')
    ) {
      return true;
    }
  }

  // IPv4 literal checks
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }

  return false;
}

/**
 * URL-safe Base64 encoding/decoding compatible with Cloudflare Workers and Browsers.
 */
export function encodeConfig(config: AddonConfig): string {
  const payload: AddonConfig = {
    host: config.host.trim().replace(/\/+$/, ''),
    username: config.username.trim(),
    password: config.password.trim(),
  };
  if (config.tmdbKey?.trim()) payload.tmdbKey = config.tmdbKey.trim();
  if (config.includeKeywords?.trim()) payload.includeKeywords = config.includeKeywords.trim();
  if (config.excludeKeywords?.trim()) payload.excludeKeywords = config.excludeKeywords.trim();

  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeConfig(encoded: string): { ok: true; config: AddonConfig } | { ok: false; error: string } {
  try {
    if (!encoded || encoded.length > 4096) {
      return { ok: false, error: 'Configuration token is missing or invalid.' };
    }
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (base64.length % 4)) % 4;
    const padded = base64 + '='.repeat(padLength);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<AddonConfig>;

    const hostCheck = validateAndNormalizeHost(parsed.host ?? '');
    if (!hostCheck.ok) {
      return { ok: false, error: hostCheck.error };
    }

    const username = typeof parsed.username === 'string' ? parsed.username.trim() : '';
    const password = typeof parsed.password === 'string' ? parsed.password.trim() : '';
    if (!username || !password) {
      return { ok: false, error: 'Xtream username and password are required in configuration.' };
    }

    return {
      ok: true,
      config: {
        host: hostCheck.host,
        username,
        password,
        tmdbKey: typeof parsed.tmdbKey === 'string' ? parsed.tmdbKey.trim() || undefined : undefined,
        includeKeywords:
          typeof parsed.includeKeywords === 'string' ? parsed.includeKeywords.trim() || undefined : undefined,
        excludeKeywords:
          typeof parsed.excludeKeywords === 'string' ? parsed.excludeKeywords.trim() || undefined : undefined,
      },
    };
  } catch {
    return { ok: false, error: 'Failed to decode Base64 addon configuration.' };
  }
}

/**
 * Deterministic short hash used strictly for non-reversible cache keys (never puts passwords in cache URLs).
 */
async function hashKey(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function fetchJsonWithTimeout<T>(
  url: string,
  headers: Record<string, string>,
  enforcePublicHost = false
): Promise<T> {
  let currentUrl = url;
  const maxRedirects = 3;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const res = await fetch(currentUrl, {
        method: 'GET',
        headers,
        redirect: enforcePublicHost ? 'manual' : 'follow',
        signal: controller.signal,
      });

      if (enforcePublicHost && res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location || hop === maxRedirects) {
          throw new Error(`Upstream redirect blocked (HTTP ${res.status})`);
        }
        const resolved = new URL(location, currentUrl).toString();
        const hostCheck = validateAndNormalizeHost(resolved);
        if (!hostCheck.ok) {
          throw new Error('Upstream redirect target is not allowed.');
        }
        currentUrl = resolved;
        continue;
      }

      if (!res.ok) {
        throw new Error(`Upstream HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('Too many upstream redirects.');
}

async function fetchXtreamAction<T>(
  config: AddonConfig,
  action: string | null,
  extraParams: Record<string, string> = {},
  cacheTtlSeconds = 0,
  ctx?: WorkerExecutionContext
): Promise<T> {
  const params = new URLSearchParams({
    username: config.username,
    password: config.password,
  });
  if (action) params.set('action', action);
  for (const [k, v] of Object.entries(extraParams)) {
    params.set(k, v);
  }

  const upstreamUrl = `${config.host}/player_api.php?${params.toString()}`;
  const cacheNamespace = action ?? 'auth';
  const extraSig = Object.entries(extraParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  let cacheKeyUrl = '';
  if (cacheTtlSeconds > 0) {
    const fingerprint = await hashKey(`${config.host}|${config.username}|${config.password}|${cacheNamespace}|${extraSig}`);
    cacheKeyUrl = `https://xtream-cache.internal/${cacheNamespace}/${fingerprint}.json`;
    const cached = await readCache<T>(cacheKeyUrl);
    if (cached !== null) {
      return cached;
    }
  }

  const data = await fetchJsonWithTimeout<T>(
    upstreamUrl,
    {
      'User-Agent': XTREAM_USER_AGENT,
      Accept: 'application/json, text/plain, */*',
    },
    true
  );

  if (cacheTtlSeconds > 0 && cacheKeyUrl) {
    await writeCache(cacheKeyUrl, data, cacheTtlSeconds, ctx);
  }

  return data;
}

async function fetchCategoryMap(
  config: AddonConfig,
  type: 'movie' | 'series',
  ctx?: WorkerExecutionContext
): Promise<Map<string, string>> {
  const action = type === 'movie' ? 'get_vod_categories' : 'get_series_categories';
  try {
    const raw = await fetchXtreamAction<XtreamCategory[]>(config, action, {}, CATALOG_CACHE_TTL, ctx);
    const map = new Map<string, string>();
    if (Array.isArray(raw)) {
      for (const cat of raw) {
        if (cat && cat.category_id !== undefined && cat.category_name) {
          map.set(String(cat.category_id), String(cat.category_name));
        }
      }
    }
    return map;
  } catch {
    return new Map<string, string>();
  }
}

/**
 * Step 1: Fetch canonical title, release year, aliases, and TMDB ID from Cinemeta (24h cache),
 * falling back to or enriching from TMDB API when an optional TMDB key is configured.
 */
async function resolveCanonicalMeta(
  type: 'movie' | 'series',
  imdbId: string,
  tmdbKey: string | undefined,
  ctx?: WorkerExecutionContext
): Promise<CanonicalMeta | null> {
  const cinemetaCacheKey = `https://cinemeta-cache.internal/meta/${type}/${encodeURIComponent(imdbId)}.json`;
  let cinemeta = await readCache<CinemetaResponse>(cinemetaCacheKey);

  if (!cinemeta) {
    try {
      const url = `https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(imdbId)}.json`;
      cinemeta = await fetchJsonWithTimeout<CinemetaResponse>(url, {
        'User-Agent': 'Stremio-XtreamBridge/1.0',
        Accept: 'application/json',
      });
      if (cinemeta?.meta?.name) {
        await writeCache(cinemetaCacheKey, cinemeta, META_CACHE_TTL, ctx);
      }
    } catch {
      cinemeta = null;
    }
  }

  let title = cinemeta?.meta?.name?.trim() ?? '';
  let tmdbId =
    cinemeta?.meta?.moviedb_id !== undefined && cinemeta?.meta?.moviedb_id !== null
      ? String(cinemeta.meta.moviedb_id)
      : null;

  const yearSource = cinemeta?.meta?.year ?? cinemeta?.meta?.releaseInfo ?? '';
  const yearMatch = String(yearSource).match(/\b((?:19|20)\d{2})\b/);
  let year = yearMatch ? Number.parseInt(yearMatch[1], 10) : null;

  const aliases = new Set<string>();
  if (cinemeta?.meta?.originalName && cinemeta.meta.originalName !== title) {
    aliases.add(cinemeta.meta.originalName.trim());
  }
  if (Array.isArray(cinemeta?.meta?.aliases)) {
    for (const alias of cinemeta.meta.aliases) {
      if (typeof alias === 'string' && alias.trim()) {
        aliases.add(alias.trim());
      }
    }
  }

  // Fallback or TMDB ID enrichment if user provided a TMDB key and Cinemeta failed or missed TMDB ID
  if (tmdbKey && (!title || !tmdbId)) {
    const tmdbKeyHash = await hashKey(tmdbKey);
    const tmdbCacheKey = `https://tmdb-cache.internal/find/${type}/${encodeURIComponent(imdbId)}/${tmdbKeyHash}.json`;
    let tmdbData = await readCache<TmdbFindResponse>(tmdbCacheKey);

    if (!tmdbData) {
      try {
        const tmdbUrl = `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${encodeURIComponent(tmdbKey)}&external_source=imdb_id`;
        tmdbData = await fetchJsonWithTimeout<TmdbFindResponse>(tmdbUrl, {
          Accept: 'application/json',
        });
        await writeCache(tmdbCacheKey, tmdbData, META_CACHE_TTL, ctx);
      } catch {
        tmdbData = null;
      }
    }

    if (tmdbData) {
      const result = type === 'movie' ? tmdbData.movie_results?.[0] : tmdbData.tv_results?.[0];
      if (result) {
        if (!tmdbId && result.id) tmdbId = String(result.id);
        const tmdbTitle = type === 'movie' ? (result as { title?: string }).title : (result as { name?: string }).name;
        const tmdbOrig =
          type === 'movie'
            ? (result as { original_title?: string }).original_title
            : (result as { original_name?: string }).original_name;
        const tmdbDate =
          type === 'movie'
            ? (result as { release_date?: string }).release_date
            : (result as { first_air_date?: string }).first_air_date;

        if (!title && tmdbTitle) title = tmdbTitle.trim();
        else if (tmdbTitle && tmdbTitle.trim() !== title) aliases.add(tmdbTitle.trim());

        if (tmdbOrig && tmdbOrig.trim() !== title) aliases.add(tmdbOrig.trim());

        if (year === null && tmdbDate) {
          const dm = tmdbDate.match(/^((?:19|20)\d{2})/);
          if (dm) year = Number.parseInt(dm[1], 10);
        }
      }
    }
  }

  if (!title) return null;

  return {
    imdbId,
    tmdbId,
    title,
    year,
    aliases: Array.from(aliases),
  };
}

function buildManifest(configured: boolean, brand = 'IPTV 8K') {
  return {
    id: 'org.custom.xtream.vod',
    version: '1.1.0',
    name: `${brand} VOD & Series`,
    description:
      'Streams Xtream Codes IPTV VOD movies and series episodes directly on Stremio Cinemeta pages via IMDb & TMDB matching, plus searchable catalogs with full metadata.',
    resources: [
      'catalog',
      {
        name: 'meta',
        types: ['movie', 'series'],
        idPrefixes: ['xtream:'],
      },
      {
        name: 'stream',
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'xtream:'],
      },
    ],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'xtream:'],
    catalogs: [
      {
        type: 'movie',
        id: 'iptv-movies',
        name: `${brand} Movies`,
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false },
        ],
      },
      {
        type: 'series',
        id: 'iptv-series',
        name: `${brand} Series`,
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false },
        ],
      },
    ],
    behaviorHints: {
      configurable: true,
      configurationRequired: !configured,
    },
  };
}

function parseExtraParams(extraSegment?: string): { search: string; skip: number } {
  let search = '';
  let skip = 0;
  if (!extraSegment) return { search, skip };

  const cleaned = extraSegment.replace(/\.json$/i, '');
  const pairs = cleaned.split('&');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = decodeURIComponent(pair.slice(0, eqIdx));
    const val = decodeURIComponent(pair.slice(eqIdx + 1));
    if (key === 'search') {
      search = val.trim();
    } else if (key === 'skip') {
      const parsedSkip = Number.parseInt(val, 10);
      if (Number.isFinite(parsedSkip) && parsedSkip >= 0) {
        skip = parsedSkip;
      }
    }
  }
  return { search, skip };
}

function findEpisodeInSeriesInfo(
  seriesInfo: XtreamSeriesInfoResponse,
  season: number,
  episode: number
): XtreamSeriesEpisode | null {
  const episodesContainer = seriesInfo?.episodes;
  if (!episodesContainer) return null;

  // Try direct season keys: "1", "01", etc.
  const candidateLists: XtreamSeriesEpisode[][] = [];

  if (Array.isArray(episodesContainer)) {
    for (const list of episodesContainer) {
      if (Array.isArray(list)) candidateLists.push(list);
    }
  } else {
    const directKeys = [String(season), String(season).padStart(2, '0')];
    for (const key of directKeys) {
      const list = episodesContainer[key];
      if (Array.isArray(list)) {
        candidateLists.push(list);
      }
    }
    // Fallback: inspect numeric-equivalent keys
    if (candidateLists.length === 0) {
      for (const [key, list] of Object.entries(episodesContainer)) {
        if (Number.parseInt(key, 10) === season && Array.isArray(list)) {
          candidateLists.push(list);
        }
      }
    }
  }

  for (const list of candidateLists) {
    const found = list.find((ep) => Number.parseInt(String(ep.episode_num), 10) === episode);
    if (found && found.id !== undefined && found.id !== null) {
      return found;
    }
  }

  return null;
}

async function handleTestConnection(request: Request): Promise<Response> {
  let body: Partial<AddonConfig>;
  try {
    body = (await request.json()) as Partial<AddonConfig>;
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON request payload.' }, 400);
  }

  const hostCheck = validateAndNormalizeHost(body.host ?? '');
  if (!hostCheck.ok) {
    return jsonResponse({ ok: false, error: hostCheck.error }, 400);
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password.trim() : '';
  if (!username || !password) {
    return jsonResponse({ ok: false, error: 'Xtream username and password are required.' }, 400);
  }

  const config: AddonConfig = {
    host: hostCheck.host,
    username,
    password,
    tmdbKey: typeof body.tmdbKey === 'string' ? body.tmdbKey.trim() || undefined : undefined,
    includeKeywords: typeof body.includeKeywords === 'string' ? body.includeKeywords.trim() || undefined : undefined,
    excludeKeywords: typeof body.excludeKeywords === 'string' ? body.excludeKeywords.trim() || undefined : undefined,
  };

  try {
    const auth = await fetchXtreamAction<XtreamAuthResponse>(config, null);
    const isAuthed =
      auth?.user_info &&
      (auth.user_info.auth === 1 || auth.user_info.auth === '1' || auth.user_info.status?.toLowerCase() === 'active');

    if (!isAuthed) {
      return jsonResponse(
        {
          ok: false,
          error: auth?.user_info?.message || 'Xtream Codes authentication rejected. Verify username and password.',
        },
        401
      );
    }

    const [vodRaw, seriesRaw, vodCats, seriesCats] = await Promise.all([
      fetchXtreamAction<XtreamVodItem[]>(config, 'get_vod_streams').catch(() => []),
      fetchXtreamAction<XtreamSeriesItem[]>(config, 'get_series').catch(() => []),
      fetchXtreamAction<XtreamCategory[]>(config, 'get_vod_categories').catch(() => []),
      fetchXtreamAction<XtreamCategory[]>(config, 'get_series_categories').catch(() => []),
    ]);

    const movies = Array.isArray(vodRaw) ? vodRaw : [];
    const series = Array.isArray(seriesRaw) ? seriesRaw : [];
    const includeKw = parseKeywordList(config.includeKeywords);
    const excludeKw = parseKeywordList(config.excludeKeywords);

    const vodCatMap = new Map<string, string>(
      (Array.isArray(vodCats) ? vodCats : []).map((c) => [String(c.category_id), String(c.category_name)])
    );
    const seriesCatMap = new Map<string, string>(
      (Array.isArray(seriesCats) ? seriesCats : []).map((c) => [String(c.category_id), String(c.category_name)])
    );

    const filteredMovies =
      includeKw.length || excludeKw.length
        ? movies.filter((m) =>
            passesCategoryAndKeywordFilter(m.name ?? '', vodCatMap.get(String(m.category_id)), includeKw, excludeKw)
          ).length
        : movies.length;

    const filteredSeries =
      includeKw.length || excludeKw.length
        ? series.filter((s) =>
            passesCategoryAndKeywordFilter(s.name ?? '', seriesCatMap.get(String(s.category_id)), includeKw, excludeKw)
          ).length
        : series.length;

    let expiresAt: string | null = null;
    if (auth.user_info?.exp_date) {
      const ts = Number(auth.user_info.exp_date);
      if (Number.isFinite(ts) && ts > 0) {
        expiresAt = new Date(ts * 1000).toISOString();
      }
    }

    return jsonResponse({
      ok: true,
      normalizedHost: config.host,
      account: {
        status: auth.user_info?.status ?? 'Active',
        activeConnections: Number(auth.user_info?.active_cons ?? 0),
        maxConnections: Number(auth.user_info?.max_connections ?? 1),
        expiresAt,
      },
      counts: {
        movies: movies.length,
        series: series.length,
        filteredMovies,
        filteredSeries,
        vodCategories: vodCatMap.size,
        seriesCategories: seriesCatMap.size,
      },
      sampleCategories: Array.from(vodCatMap.values()).slice(0, 8),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to reach Xtream Codes server.';
    return jsonResponse(
      {
        ok: false,
        error: `Failed to connect to Xtream host (${message}). Confirm the protocol (http:// vs https://) and port.`,
      },
      502
    );
  }
}

async function handleCatalog(
  config: AddonConfig,
  type: 'movie' | 'series',
  catalogId: string,
  extraSegment: string | undefined,
  ctx?: WorkerExecutionContext
): Promise<Response> {
  if ((type === 'movie' && catalogId !== 'iptv-movies') || (type === 'series' && catalogId !== 'iptv-series')) {
    return jsonResponse({ metas: [] });
  }

  const { search, skip } = parseExtraParams(extraSegment);
  const includeKw = parseKeywordList(config.includeKeywords);
  const excludeKw = parseKeywordList(config.excludeKeywords);
  const needsCategories = includeKw.length > 0 || excludeKw.length > 0;

  try {
    const [itemsRaw, categoryMap] = await Promise.all([
      type === 'movie'
        ? fetchXtreamAction<XtreamVodItem[]>(config, 'get_vod_streams', {}, CATALOG_CACHE_TTL, ctx)
        : fetchXtreamAction<XtreamSeriesItem[]>(config, 'get_series', {}, CATALOG_CACHE_TTL, ctx),
      needsCategories ? fetchCategoryMap(config, type, ctx) : Promise.resolve(new Map<string, string>()),
    ]);

    const items = Array.isArray(itemsRaw) ? itemsRaw : [];
    const normalizedSearch = search ? normalizeTitle(search, type === 'series') : '';
    const lowerSearch = search.toLowerCase();

    const filtered = items.filter((item) => {
      if (!item || typeof item.name !== 'string') return false;

      if (needsCategories) {
        const catName = categoryMap.get(String(item.category_id));
        if (!passesCategoryAndKeywordFilter(item.name, catName, includeKw, excludeKw)) {
          return false;
        }
      }

      if (lowerSearch) {
        const rawLower = item.name.toLowerCase();
        if (rawLower.includes(lowerSearch)) return true;
        if (normalizedSearch && normalizeTitle(item.name, type === 'series').includes(normalizedSearch)) {
          return true;
        }
        return false;
      }

      return true;
    });

    const page = filtered.slice(skip, skip + CATALOG_PAGE_SIZE);
    const metas: StremioMetaPreview[] = page.map((entry) => {
      const imdbCandidate =
        typeof entry.imdb_id === 'string' && /^tt\d{5,10}$/i.test(entry.imdb_id.trim())
          ? entry.imdb_id.trim().toLowerCase()
          : null;

      if (type === 'movie') {
        const vod = entry as XtreamVodItem;
        const yearMatch = String(vod.year ?? vod.releaseDate ?? vod.name).match(/\b((?:19|20)\d{2})\b/);
        return {
          id: imdbCandidate ?? `xtream:movie:${vod.stream_id}`,
          type: 'movie',
          name: vod.name,
          poster: vod.stream_icon && /^https?:\/\//i.test(vod.stream_icon) ? vod.stream_icon : undefined,
          posterShape: 'poster',
          releaseInfo: yearMatch ? yearMatch[1] : undefined,
          imdbRating: vod.rating ? String(vod.rating) : undefined,
        };
      }

      const ser = entry as XtreamSeriesItem;
      const yearMatch = String(ser.year ?? ser.releaseDate ?? ser.release_date ?? ser.name).match(/\b((?:19|20)\d{2})\b/);
      return {
        id: imdbCandidate ?? `xtream:series:${ser.series_id}`,
        type: 'series',
        name: ser.name,
        poster: ser.cover && /^https?:\/\//i.test(ser.cover) ? ser.cover : undefined,
        posterShape: 'poster',
        releaseInfo: yearMatch ? yearMatch[1] : undefined,
        imdbRating: ser.rating ? String(ser.rating) : undefined,
        description: ser.plot || undefined,
      };
    });

    return jsonResponse({ metas }, 200, {
      'Cache-Control': 'public, max-age=300',
    });
  } catch {
    return jsonResponse({ metas: [] }, 200);
  }
}

function extractValidImageUrl(val?: string | string[] | null): string | undefined {
  if (!val) return undefined;
  const candidate = Array.isArray(val) ? val.find((v) => typeof v === 'string' && /^https?:\/\//i.test(v.trim())) : val;
  if (typeof candidate !== 'string') return undefined;
  const trimmed = candidate.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

function splitCsvField(val?: string | null): string[] | undefined {
  if (!val || typeof val !== 'string') return undefined;
  const parts = val
    .split(/[,/|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function toIsoDateOrFallback(rawDate: string | undefined, season: number, episode: number): string {
  if (rawDate) {
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  const safeSeason = Math.max(0, Math.min(99, season));
  const safeEp = Math.max(1, Math.min(365, episode));
  return new Date(Date.UTC(2000 + safeSeason, 0, safeEp)).toISOString();
}

function safeDecodeStremioId(rawId: string): string {
  let out = rawId;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out.replace(/\.json$/i, '').trim();
}

async function handleMeta(
  config: AddonConfig,
  type: 'movie' | 'series',
  rawId: string,
  ctx?: WorkerExecutionContext
): Promise<Response> {
  const decodedId = safeDecodeStremioId(rawId);

  if (type === 'movie') {
    const movieMatch = decodedId.match(/^xtream:movie:(\d+)$/);
    if (!movieMatch) {
      return jsonResponse({ meta: null }, 404);
    }
    const streamId = movieMatch[1];

    try {
      const [vodInfo, vodListRaw] = await Promise.all([
        fetchXtreamAction<XtreamVodInfoResponse>(
          config,
          'get_vod_info',
          { vod_id: streamId },
          CATALOG_CACHE_TTL,
          ctx
        ).catch(() => null),
        fetchXtreamAction<XtreamVodItem[]>(config, 'get_vod_streams', {}, CATALOG_CACHE_TTL, ctx).catch(() => []),
      ]);

      const listItem = Array.isArray(vodListRaw)
        ? vodListRaw.find((v) => String(v?.stream_id) === streamId)
        : undefined;

      const info = vodInfo?.info;
      const name = info?.name || vodInfo?.movie_data?.name || listItem?.name;
      if (!name) {
        return jsonResponse({ meta: null }, 404);
      }

      const poster =
        extractValidImageUrl(info?.cover_big) ??
        extractValidImageUrl(info?.movie_image) ??
        extractValidImageUrl(listItem?.stream_icon);
      const background = extractValidImageUrl(info?.backdrop_path) ?? poster;
      const yearSource = info?.releasedate ?? info?.release_date ?? listItem?.year ?? listItem?.releaseDate ?? name;
      const yearMatch = String(yearSource).match(/\b((?:19|20)\d{2})\b/);
      const rating = info?.rating ?? listItem?.rating;

      return jsonResponse(
        {
          meta: {
            id: `xtream:movie:${streamId}`,
            type: 'movie',
            name,
            poster,
            background,
            posterShape: 'poster',
            description: info?.plot || info?.description || undefined,
            releaseInfo: yearMatch ? yearMatch[1] : undefined,
            runtime: info?.duration || undefined,
            imdbRating: rating ? String(rating) : undefined,
            genres: splitCsvField(info?.genre),
            director: splitCsvField(info?.director),
            cast: splitCsvField(info?.cast ?? info?.actors),
          },
        },
        200,
        { 'Cache-Control': 'public, max-age=300' }
      );
    } catch {
      return jsonResponse({ meta: null }, 200);
    }
  }

  // Series metadata + full episode list for Stremio & Nuvio
  const seriesMatch = decodedId.match(/^xtream:series:(\d+)$/);
  if (!seriesMatch) {
    return jsonResponse({ meta: null }, 404);
  }
  const seriesId = seriesMatch[1];

  try {
    const [seriesInfo, seriesListRaw] = await Promise.all([
      fetchXtreamAction<XtreamSeriesInfoResponse>(
        config,
        'get_series_info',
        { series_id: seriesId },
        CATALOG_CACHE_TTL,
        ctx
      ).catch(() => null),
      fetchXtreamAction<XtreamSeriesItem[]>(config, 'get_series', {}, CATALOG_CACHE_TTL, ctx).catch(() => []),
    ]);

    const listItem = Array.isArray(seriesListRaw)
      ? seriesListRaw.find((s) => String(s?.series_id) === seriesId)
      : undefined;

    const info = seriesInfo?.info;
    const name = info?.name || listItem?.name;
    if (!name) {
      return jsonResponse({ meta: null }, 404);
    }

    const poster = extractValidImageUrl(info?.cover) ?? extractValidImageUrl(listItem?.cover);
    const background = extractValidImageUrl(info?.backdrop_path) ?? poster;
    const yearSource =
      info?.releaseDate ?? info?.release_date ?? listItem?.year ?? listItem?.releaseDate ?? listItem?.release_date ?? name;
    const yearMatch = String(yearSource).match(/\b((?:19|20)\d{2})\b/);
    const rating = info?.rating ?? listItem?.rating;

    // Flatten episodes across all seasons into Stremio's `videos` array
    const videos: Array<{
      id: string;
      title: string;
      season: number;
      episode: number;
      released: string;
      thumbnail?: string;
      overview?: string;
    }> = [];

    const episodesContainer = seriesInfo?.episodes;
    if (episodesContainer) {
      const seasonEntries: Array<[number, XtreamSeriesEpisode[]]> = Array.isArray(episodesContainer)
        ? episodesContainer.map((list, idx) => [idx + 1, Array.isArray(list) ? list : []])
        : Object.entries(episodesContainer).map(([k, list]) => [
            Number.parseInt(k, 10) || 1,
            Array.isArray(list) ? list : [],
          ]);

      for (const [seasonNum, epList] of seasonEntries) {
        for (const ep of epList) {
          if (!ep || ep.id === undefined || ep.id === null) continue;
          const epNum = Number.parseInt(String(ep.episode_num), 10);
          if (!Number.isFinite(epNum) || epNum < 0) continue;

          const resolvedSeason = ep.season !== undefined ? Number.parseInt(String(ep.season), 10) || seasonNum : seasonNum;
          const thumb = extractValidImageUrl(ep.info?.movie_image) ?? poster;

          videos.push({
            id: `xtream:series:${seriesId}:${resolvedSeason}:${epNum}`,
            title: ep.title?.trim() || `Episode ${epNum}`,
            season: resolvedSeason,
            episode: epNum,
            released: toIsoDateOrFallback(ep.info?.releasedate ?? ep.info?.release_date, resolvedSeason, epNum),
            thumbnail: thumb,
            overview: ep.info?.plot || undefined,
          });
        }
      }
    }

    videos.sort((a, b) => (a.season !== b.season ? a.season - b.season : a.episode - b.episode));

    return jsonResponse(
      {
        meta: {
          id: `xtream:series:${seriesId}`,
          type: 'series',
          name,
          poster,
          background,
          posterShape: 'poster',
          description: info?.plot || listItem?.plot || undefined,
          releaseInfo: yearMatch ? yearMatch[1] : undefined,
          imdbRating: rating ? String(rating) : undefined,
          genres: splitCsvField(info?.genre ?? listItem?.genre),
          director: splitCsvField(info?.director ?? listItem?.director),
          cast: splitCsvField(info?.cast ?? listItem?.cast),
          videos,
        },
      },
      200,
      { 'Cache-Control': 'public, max-age=300' }
    );
  } catch {
    return jsonResponse({ meta: null }, 200);
  }
}

async function handleStream(
  config: AddonConfig,
  type: 'movie' | 'series',
  rawId: string,
  env?: WorkerEnv,
  ctx?: WorkerExecutionContext
): Promise<Response> {
  const decodedId = safeDecodeStremioId(rawId);
  const brand = env?.ADDON_BRAND?.trim() || 'IPTV 8K';
  const threshold = Number.parseFloat(env?.MATCH_THRESHOLD ?? '') || DEFAULT_MATCH_THRESHOLD;

  // Fast direct playback path for items opened from our custom IPTV catalogs (xtream:movie:... / xtream:series:...)
  if (decodedId.startsWith('xtream:')) {
    const encodedUser = encodeURIComponent(config.username);
    const encodedPass = encodeURIComponent(config.password);

    if (type === 'movie') {
      const m = decodedId.match(/^xtream:movie:(\d+)$/);
      if (!m) return jsonResponse({ streams: [] });
      const streamId = m[1];

      try {
        const [vodInfo, vodListRaw] = await Promise.all([
          fetchXtreamAction<XtreamVodInfoResponse>(
            config,
            'get_vod_info',
            { vod_id: streamId },
            CATALOG_CACHE_TTL,
            ctx
          ).catch(() => null),
          fetchXtreamAction<XtreamVodItem[]>(config, 'get_vod_streams', {}, CATALOG_CACHE_TTL, ctx).catch(() => []),
        ]);

        const listItem = Array.isArray(vodListRaw)
          ? vodListRaw.find((v) => String(v?.stream_id) === streamId)
          : undefined;
        const name = vodInfo?.movie_data?.name || vodInfo?.info?.name || listItem?.name || `VOD #${streamId}`;
        const ext = (vodInfo?.movie_data?.container_extension || listItem?.container_extension || 'mp4').replace(/^\.+/, '');
        const quality = extractQualityLabel(name);

        return jsonResponse(
          {
            streams: [
              {
                name: `${brand}\n[${quality.label}]`,
                title: `${name}\n${ext.toUpperCase()} · Direct Catalog Stream`,
                url: `${config.host}/movie/${encodedUser}/${encodedPass}/${streamId}.${ext}`,
                behaviorHints: { notWebReady: true },
              },
            ],
          },
          200,
          { 'Cache-Control': 'public, max-age=300' }
        );
      } catch {
        return jsonResponse({ streams: [] }, 200);
      }
    }

    // Direct series episode playback: xtream:series:<seriesId>:<season>:<episode>
    const s = decodedId.match(/^xtream:series:(\d+):(\d+):(\d+)$/);
    if (!s) return jsonResponse({ streams: [] });
    const seriesId = s[1];
    const season = Number.parseInt(s[2], 10);
    const episode = Number.parseInt(s[3], 10);

    try {
      const seriesInfo = await fetchXtreamAction<XtreamSeriesInfoResponse>(
        config,
        'get_series_info',
        { series_id: seriesId },
        CATALOG_CACHE_TTL,
        ctx
      );
      const ep = findEpisodeInSeriesInfo(seriesInfo, season, episode);
      if (!ep) return jsonResponse({ streams: [] }, 200);

      const ext = (ep.container_extension || 'mp4').replace(/^\.+/, '');
      const seriesName = seriesInfo?.info?.name || `Series #${seriesId}`;
      const epCode = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
      const epTitle = ep.title?.trim() || `${seriesName} ${epCode}`;
      const quality = extractQualityLabel(seriesName);

      return jsonResponse(
        {
          streams: [
            {
              name: `${brand}\n[${quality.label}]`,
              title: `${epTitle}\n${seriesName} · ${epCode} · ${ext.toUpperCase()} · Direct Catalog Stream`,
              url: `${config.host}/series/${encodedUser}/${encodedPass}/${ep.id}.${ext}`,
              behaviorHints: {
                notWebReady: true,
                bingeGroup: `xtream-series-${seriesId}-${quality.label}`,
              },
            },
          ],
        },
        200,
        { 'Cache-Control': 'public, max-age=300' }
      );
    } catch {
      return jsonResponse({ streams: [] }, 200);
    }
  }

  // Standard Cinemeta IMDb ID path (tt1375666 or tt0903747:1:2)
  const idParts = decodedId.split(':');
  const imdbId = idParts[0];

  if (!/^tt\d{5,10}$/i.test(imdbId)) {
    return jsonResponse({ streams: [] });
  }

  let season = 0;
  let episode = 0;
  if (type === 'series') {
    season = Number.parseInt(idParts[1] ?? '', 10);
    episode = Number.parseInt(idParts[2] ?? '', 10);
    if (!Number.isFinite(season) || season < 0 || !Number.isFinite(episode) || episode < 0) {
      return jsonResponse({ streams: [] });
    }
  }

  // Step 1: Resolve canonical title, year, aliases, and TMDB ID via Cinemeta (+ optional TMDB fallback)
  const meta = await resolveCanonicalMeta(type, imdbId, config.tmdbKey, ctx);
  if (!meta) {
    return jsonResponse({ streams: [] });
  }

  const includeKw = parseKeywordList(config.includeKeywords);
  const excludeKw = parseKeywordList(config.excludeKeywords);
  const needsCategories = includeKw.length > 0 || excludeKw.length > 0;

  try {
    if (type === 'movie') {
      // Step 2: Retrieve cached VOD list
      const [vodListRaw, categoryMap] = await Promise.all([
        fetchXtreamAction<XtreamVodItem[]>(config, 'get_vod_streams', {}, CATALOG_CACHE_TTL, ctx),
        needsCategories ? fetchCategoryMap(config, 'movie', ctx) : Promise.resolve(new Map<string, string>()),
      ]);

      const vodList = Array.isArray(vodListRaw) ? vodListRaw : [];

      // Step 3: Score & filter above strict threshold
      const matches = findBestMatches(meta, vodList, {
        isSeries: false,
        threshold,
        maxResults: 10,
        categoryMap,
        includeKeywords: includeKw,
        excludeKeywords: excludeKw,
      });

      // Step 4: Construct playable movie stream URLs preserving exact HTTP/HTTPS scheme
      const encodedUser = encodeURIComponent(config.username);
      const encodedPass = encodeURIComponent(config.password);

      const streams: StremioStream[] = matches.map(({ item, diagnostics }) => {
        const ext = (item.container_extension || 'mp4').replace(/^\.+/, '');
        const streamUrl = `${config.host}/movie/${encodedUser}/${encodedPass}/${item.stream_id}.${ext}`;
        const matchNote =
          diagnostics.matchType === 'tmdb_id'
            ? 'Exact TMDB ID'
            : diagnostics.matchType === 'imdb_id'
              ? 'Exact IMDb ID'
              : `Match ${Math.round(diagnostics.score * 100)}%`;

        return {
          name: `${brand}\n[${diagnostics.quality.label}]`,
          title: `${item.name}\n${ext.toUpperCase()} · ${matchNote}`,
          url: streamUrl,
          behaviorHints: {
            notWebReady: true,
          },
        };
      });

      return jsonResponse({ streams }, 200, {
        'Cache-Control': 'public, max-age=300',
      });
    }

    // Series flow
    const [seriesListRaw, categoryMap] = await Promise.all([
      fetchXtreamAction<XtreamSeriesItem[]>(config, 'get_series', {}, CATALOG_CACHE_TTL, ctx),
      needsCategories ? fetchCategoryMap(config, 'series', ctx) : Promise.resolve(new Map<string, string>()),
    ]);

    const seriesList = Array.isArray(seriesListRaw) ? seriesListRaw : [];
    const matchedSeries = findBestMatches(meta, seriesList, {
      isSeries: true,
      threshold,
      maxResults: 5,
      categoryMap,
      includeKeywords: includeKw,
      excludeKeywords: excludeKw,
    });

    if (matchedSeries.length === 0) {
      return jsonResponse({ streams: [] });
    }

    // Fetch episode listings for top matched series candidates (6-hour cache)
    const seriesInfos = await Promise.all(
      matchedSeries.map(async (match) => {
        try {
          const info = await fetchXtreamAction<XtreamSeriesInfoResponse>(
            config,
            'get_series_info',
            { series_id: String(match.item.series_id) },
            CATALOG_CACHE_TTL,
            ctx
          );
          return { match, info };
        } catch {
          return { match, info: null };
        }
      })
    );

    const encodedUser = encodeURIComponent(config.username);
    const encodedPass = encodeURIComponent(config.password);
    const streams: StremioStream[] = [];

    for (const { match, info } of seriesInfos) {
      if (!info) continue;
      const ep = findEpisodeInSeriesInfo(info, season, episode);
      if (!ep) continue;

      const ext = (ep.container_extension || 'mp4').replace(/^\.+/, '');
      const streamUrl = `${config.host}/series/${encodedUser}/${encodedPass}/${ep.id}.${ext}`;
      const epCode = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
      const epTitle = ep.title ? `${ep.title}` : `${match.item.name} ${epCode}`;
      const matchNote =
        match.diagnostics.matchType === 'tmdb_id'
          ? 'Exact TMDB ID'
          : match.diagnostics.matchType === 'imdb_id'
            ? 'Exact IMDb ID'
            : `Match ${Math.round(match.diagnostics.score * 100)}%`;

      streams.push({
        name: `${brand}\n[${match.diagnostics.quality.label}]`,
        title: `${epTitle}\n${match.item.name} · ${epCode} · ${ext.toUpperCase()} · ${matchNote}`,
        url: streamUrl,
        behaviorHints: {
          notWebReady: true,
          bingeGroup: `xtream-series-${match.item.series_id}-${match.diagnostics.quality.label}`,
        },
      });
    }

    return jsonResponse({ streams }, 200, {
      'Cache-Control': 'public, max-age=300',
    });
  } catch {
    return jsonResponse({ streams: [] }, 200);
  }
}

/* ============================================================================
 * Separate Live TV Channel Collection Addon (/tv/:config/...)
 * ========================================================================== */

export type LiveStreamFormat = 'both' | 'ts' | 'm3u8';

export interface LiveTvAddonConfig {
  host: string;
  username: string;
  password: string;
  name: string;
  format: LiveStreamFormat;
  channelIds: number[];
}

interface XtreamLiveChannel {
  num?: number;
  name: string;
  stream_type?: string;
  stream_id: number | string;
  stream_icon?: string;
  epg_channel_id?: string | null;
  added?: string;
  category_id?: string | number;
  tv_archive?: number;
}

interface CompactLiveTvPayload {
  h: string;
  u: string;
  p: string;
  n?: string;
  f?: LiveStreamFormat;
  c: string;
}

const MAX_SELECTED_CHANNELS = 500;
const LIVE_SEARCH_RESULT_CAP = 800;

export function encodeLiveTvConfig(config: LiveTvAddonConfig): string {
  const uniqueIds: number[] = [];
  const seen = new Set<number>();
  for (const rawId of config.channelIds) {
    const num = Number(rawId);
    if (Number.isInteger(num) && num > 0 && !seen.has(num)) {
      seen.add(num);
      uniqueIds.push(num);
      if (uniqueIds.length >= MAX_SELECTED_CHANNELS) break;
    }
  }

  const payload: CompactLiveTvPayload = {
    h: config.host.trim().replace(/\/+$/, ''),
    u: config.username.trim(),
    p: config.password.trim(),
    n: (config.name || 'My Live TV').trim().slice(0, 60),
    f: config.format === 'ts' || config.format === 'm3u8' ? config.format : 'both',
    c: uniqueIds.join(','),
  };

  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeLiveTvConfig(
  encoded: string
): { ok: true; config: LiveTvAddonConfig } | { ok: false; error: string } {
  try {
    if (!encoded || encoded.length > 16384) {
      return { ok: false, error: 'Live TV configuration token is missing or exceeds size limit.' };
    }
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (base64.length % 4)) % 4;
    const padded = base64 + '='.repeat(padLength);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CompactLiveTvPayload>;
    const hostCheck = validateAndNormalizeHost(parsed.h ?? '');
    if (!hostCheck.ok) {
      return { ok: false, error: hostCheck.error };
    }

    const username = typeof parsed.u === 'string' ? parsed.u.trim() : '';
    const password = typeof parsed.p === 'string' ? parsed.p.trim() : '';
    if (!username || !password) {
      return { ok: false, error: 'Xtream username and password are required in Live TV configuration.' };
    }

    const channelIds: number[] = [];
    const seen = new Set<number>();
    if (typeof parsed.c === 'string' && parsed.c.trim()) {
      for (const part of parsed.c.split(',')) {
        const id = Number.parseInt(part.trim(), 10);
        if (Number.isInteger(id) && id > 0 && !seen.has(id)) {
          seen.add(id);
          channelIds.push(id);
          if (channelIds.length >= MAX_SELECTED_CHANNELS) break;
        }
      }
    }

    if (channelIds.length === 0) {
      return { ok: false, error: 'Select at least one TV channel to build a Live TV collection addon.' };
    }

    const rawName = typeof parsed.n === 'string' ? parsed.n.trim() : '';
    const name = rawName ? rawName.slice(0, 60) : 'My Live TV';
    const format: LiveStreamFormat =
      parsed.f === 'ts' || parsed.f === 'm3u8' || parsed.f === 'both' ? parsed.f : 'both';

    return {
      ok: true,
      config: {
        host: hostCheck.host,
        username,
        password,
        name,
        format,
        channelIds,
      },
    };
  } catch {
    return { ok: false, error: 'Failed to decode Live TV Base64 configuration.' };
  }
}

function slugifyCollectionName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  return slug || 'collection';
}

function buildLiveTvManifest(config: LiveTvAddonConfig) {
  const slug = slugifyCollectionName(config.name);
  return {
    id: `org.custom.xtream.livetv.${slug}`,
    version: '1.0.0',
    name: config.name,
    description: `Custom Live TV channel collection (${config.channelIds.length} hand-picked channels) from your Xtream Codes subscription.`,
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    idPrefixes: ['xtv:'],
    catalogs: [
      {
        type: 'tv',
        id: 'iptv-live-collection',
        name: config.name,
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false },
        ],
      },
    ],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
    },
  };
}

async function handleFetchLiveChannels(
  request: Request,
  ctx?: WorkerExecutionContext
): Promise<Response> {
  let body: {
    host?: string;
    username?: string;
    password?: string;
    categoryId?: string;
    search?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON request payload.' }, 400);
  }

  const hostCheck = validateAndNormalizeHost(body.host ?? '');
  if (!hostCheck.ok) {
    return jsonResponse({ ok: false, error: hostCheck.error }, 400);
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password.trim() : '';
  if (!username || !password) {
    return jsonResponse({ ok: false, error: 'Xtream username and password are required.' }, 400);
  }

  const baseConfig: AddonConfig = {
    host: hostCheck.host,
    username,
    password,
  };

  try {
    const [categoriesRaw, streamsRaw] = await Promise.all([
      fetchXtreamAction<XtreamCategory[]>(baseConfig, 'get_live_categories', {}, CATALOG_CACHE_TTL, ctx).catch(
        () => []
      ),
      fetchXtreamAction<XtreamLiveChannel[]>(baseConfig, 'get_live_streams', {}, CATALOG_CACHE_TTL, ctx),
    ]);

    const streams = Array.isArray(streamsRaw) ? streamsRaw : [];
    const categoriesList = Array.isArray(categoriesRaw) ? categoriesRaw : [];

    // Count channels per category and build lookup map
    const categoryNameMap = new Map<string, string>();
    const categoryCountMap = new Map<string, number>();

    for (const cat of categoriesList) {
      if (cat && cat.category_id !== undefined) {
        categoryNameMap.set(String(cat.category_id), String(cat.category_name ?? 'Uncategorized'));
      }
    }

    for (const ch of streams) {
      if (!ch) continue;
      const cid = String(ch.category_id ?? 'uncategorized');
      categoryCountMap.set(cid, (categoryCountMap.get(cid) ?? 0) + 1);
    }

    const categories = categoriesList
      .map((cat) => {
        const id = String(cat.category_id);
        return {
          id,
          name: String(cat.category_name ?? 'Uncategorized'),
          count: categoryCountMap.get(id) ?? 0,
        };
      })
      .filter((c) => c.count > 0);

    const requestedSearch = typeof body.search === 'string' ? body.search.trim().toLowerCase() : '';
    let activeCategoryId = typeof body.categoryId === 'string' ? body.categoryId.trim() : '';

    // When no search and no explicit category, default to the first non-empty category to keep payload fast & small
    if (!requestedSearch && !activeCategoryId && categories.length > 0) {
      activeCategoryId = categories[0].id;
    }

    const filtered: Array<{
      id: number;
      name: string;
      categoryId: string;
      categoryName: string;
      icon?: string;
    }> = [];
    let matchedCount = 0;

    for (const ch of streams) {
      if (!ch || !ch.name) continue;
      const streamId = Number.parseInt(String(ch.stream_id), 10);
      if (!Number.isInteger(streamId) || streamId <= 0) continue;

      const cid = String(ch.category_id ?? 'uncategorized');
      if (activeCategoryId && activeCategoryId !== 'all' && cid !== activeCategoryId) {
        continue;
      }

      const catName = categoryNameMap.get(cid) ?? 'Uncategorized';
      if (requestedSearch) {
        const inName = ch.name.toLowerCase().includes(requestedSearch);
        const inCat = catName.toLowerCase().includes(requestedSearch);
        if (!inName && !inCat) continue;
      }

      matchedCount++;
      if (filtered.length < LIVE_SEARCH_RESULT_CAP) {
        const icon =
          typeof ch.stream_icon === 'string' && /^https?:\/\//i.test(ch.stream_icon.trim())
            ? ch.stream_icon.trim()
            : undefined;
        filtered.push({
          id: streamId,
          name: ch.name.trim(),
          categoryId: cid,
          categoryName: catName,
          ...(icon ? { icon } : {}),
        });
      }
    }

    return jsonResponse({
      ok: true,
      normalizedHost: hostCheck.host,
      totalChannels: streams.length,
      matchedCount,
      truncated: matchedCount > LIVE_SEARCH_RESULT_CAP,
      activeCategoryId: activeCategoryId || 'all',
      categories,
      channels: filtered,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to fetch Live TV channels.';
    return jsonResponse(
      {
        ok: false,
        error: `Failed to fetch Live TV channels (${message}). Confirm credentials and host protocol.`,
      },
      502
    );
  }
}

async function getSelectedLiveChannels(
  config: LiveTvAddonConfig,
  ctx?: WorkerExecutionContext
): Promise<{ channels: XtreamLiveChannel[]; categoryMap: Map<string, string> }> {
  const baseConfig: AddonConfig = {
    host: config.host,
    username: config.username,
    password: config.password,
  };

  const [streamsRaw, categoriesRaw] = await Promise.all([
    fetchXtreamAction<XtreamLiveChannel[]>(baseConfig, 'get_live_streams', {}, CATALOG_CACHE_TTL, ctx),
    fetchXtreamAction<XtreamCategory[]>(baseConfig, 'get_live_categories', {}, CATALOG_CACHE_TTL, ctx).catch(
      () => []
    ),
  ]);

  const categoryMap = new Map<string, string>();
  if (Array.isArray(categoriesRaw)) {
    for (const cat of categoriesRaw) {
      if (cat && cat.category_id !== undefined) {
        categoryMap.set(String(cat.category_id), String(cat.category_name ?? 'Live TV'));
      }
    }
  }

  const byId = new Map<number, XtreamLiveChannel>();
  if (Array.isArray(streamsRaw)) {
    for (const ch of streamsRaw) {
      if (!ch) continue;
      const id = Number.parseInt(String(ch.stream_id), 10);
      if (Number.isInteger(id) && id > 0) {
        byId.set(id, ch);
      }
    }
  }

  // Preserve the exact channel order selected by the user
  const ordered: XtreamLiveChannel[] = [];
  for (const id of config.channelIds) {
    const found = byId.get(id);
    if (found) ordered.push(found);
  }

  return { channels: ordered, categoryMap };
}

async function handleLiveTvCatalog(
  config: LiveTvAddonConfig,
  catalogId: string,
  extraSegment: string | undefined,
  ctx?: WorkerExecutionContext
): Promise<Response> {
  if (catalogId !== 'iptv-live-collection') {
    return jsonResponse({ metas: [] });
  }

  const { search, skip } = parseExtraParams(extraSegment);
  const lowerSearch = search.toLowerCase();

  try {
    const { channels, categoryMap } = await getSelectedLiveChannels(config, ctx);
    const filtered = lowerSearch
      ? channels.filter((ch) => {
          const catName = categoryMap.get(String(ch.category_id ?? '')) ?? '';
          return ch.name.toLowerCase().includes(lowerSearch) || catName.toLowerCase().includes(lowerSearch);
        })
      : channels;

    const page = filtered.slice(skip, skip + CATALOG_PAGE_SIZE);
    const metas = page.map((ch) => {
      const catName = categoryMap.get(String(ch.category_id ?? ''));
      const poster =
        typeof ch.stream_icon === 'string' && /^https?:\/\//i.test(ch.stream_icon.trim())
          ? ch.stream_icon.trim()
          : undefined;

      return {
        id: `xtv:${ch.stream_id}`,
        type: 'tv' as const,
        name: ch.name,
        poster,
        logo: poster,
        posterShape: 'square' as const,
        genres: catName ? [catName] : ['Live TV'],
        description: catName ? `${ch.name} · ${catName}` : ch.name,
      };
    });

    return jsonResponse({ metas }, 200, {
      'Cache-Control': 'public, max-age=300',
    });
  } catch {
    return jsonResponse({ metas: [] }, 200);
  }
}

async function handleLiveTvMeta(
  config: LiveTvAddonConfig,
  rawId: string,
  ctx?: WorkerExecutionContext
): Promise<Response> {
  const decodedId = safeDecodeStremioId(rawId);
  const match = decodedId.match(/^xtv:(\d+)$/);
  if (!match) {
    return jsonResponse({ meta: null }, 404);
  }

  const streamId = Number.parseInt(match[1], 10);
  if (!config.channelIds.includes(streamId)) {
    return jsonResponse({ meta: null }, 404);
  }

  try {
    const { channels, categoryMap } = await getSelectedLiveChannels(config, ctx);
    const ch = channels.find((item) => Number.parseInt(String(item.stream_id), 10) === streamId);
    if (!ch) {
      return jsonResponse({ meta: null }, 404);
    }

    const catName = categoryMap.get(String(ch.category_id ?? ''));
    const poster =
      typeof ch.stream_icon === 'string' && /^https?:\/\//i.test(ch.stream_icon.trim())
        ? ch.stream_icon.trim()
        : undefined;

    return jsonResponse(
      {
        meta: {
          id: `xtv:${streamId}`,
          type: 'tv',
          name: ch.name,
          poster,
          logo: poster,
          background: poster,
          posterShape: 'square',
          genres: catName ? [catName] : ['Live TV'],
          description: catName
            ? `Live TV stream from ${config.name} (${catName}).`
            : `Live TV stream from ${config.name}.`,
        },
      },
      200,
      { 'Cache-Control': 'public, max-age=300' }
    );
  } catch {
    return jsonResponse({ meta: null }, 200);
  }
}

async function handleLiveTvStream(
  config: LiveTvAddonConfig,
  rawId: string,
  ctx?: WorkerExecutionContext
): Promise<Response> {
  const decodedId = safeDecodeStremioId(rawId);
  const match = decodedId.match(/^xtv:(\d+)$/);
  if (!match) {
    return jsonResponse({ streams: [] });
  }

  const streamId = Number.parseInt(match[1], 10);
  if (!config.channelIds.includes(streamId)) {
    return jsonResponse({ streams: [] });
  }

  let channelName = `Channel #${streamId}`;
  try {
    const { channels } = await getSelectedLiveChannels(config, ctx);
    const found = channels.find((item) => Number.parseInt(String(item.stream_id), 10) === streamId);
    if (found?.name) channelName = found.name;
  } catch {
    // Fallback to stream ID label if catalog metadata lookup fails
  }

  const encodedUser = encodeURIComponent(config.username);
  const encodedPass = encodeURIComponent(config.password);
  const streams: StremioStream[] = [];

  if (config.format === 'both' || config.format === 'ts') {
    streams.push({
      name: `${config.name}\n[Live TS]`,
      title: `${channelName}\nMPEG-TS Direct Stream (Recommended for ExoPlayer / MPV)`,
      url: `${config.host}/live/${encodedUser}/${encodedPass}/${streamId}.ts`,
      behaviorHints: {
        notWebReady: true,
      },
    });
  }

  if (config.format === 'both' || config.format === 'm3u8') {
    streams.push({
      name: `${config.name}\n[Live HLS]`,
      title: `${channelName}\nHLS Adaptive Stream (.m3u8)`,
      url: `${config.host}/live/${encodedUser}/${encodedPass}/${streamId}.m3u8`,
      behaviorHints: {
        notWebReady: true,
      },
    });
  }

  return jsonResponse({ streams }, 200, {
    'Cache-Control': 'public, max-age=120',
  });
}

/**
 * Main Web Fetch API router (used natively by Cloudflare Workers and mounted by Express / Vercel).
 */
export async function handleWorkerRequest(
  request: Request,
  env: WorkerEnv = {},
  ctx?: WorkerExecutionContext
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const brand = env.ADDON_BRAND?.trim() || 'IPTV 8K';

  // Configuration UI routes
  if (request.method === 'GET' && (path === '/' || path === '/configure' || path === '/worker-ui')) {
    return htmlResponse(renderConfigHtml(url.origin));
  }

  // Test Xtream credentials endpoint
  if (request.method === 'POST' && path === '/api/test') {
    return handleTestConnection(request);
  }

  // Fetch Xtream Live TV categories and channels for collection builder
  if (request.method === 'POST' && path === '/api/live-channels') {
    return handleFetchLiveChannels(request, ctx);
  }

  // Unconfigured root manifest (prompts Stremio to open /configure)
  if (request.method === 'GET' && path === '/manifest.json') {
    return jsonResponse(buildManifest(false, brand));
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  /* ---- Live TV Collection Addon routes (/tv/:config/...) ---- */
  const tvConfigureMatch = path.match(/^\/tv\/([^/]+)\/configure\/?$/);
  if (tvConfigureMatch) {
    return htmlResponse(renderConfigHtml(url.origin));
  }

  const tvManifestMatch = path.match(/^\/tv\/([^/]+)\/manifest\.json$/);
  if (tvManifestMatch) {
    const decoded = decodeLiveTvConfig(tvManifestMatch[1]);
    if (!decoded.ok) {
      return jsonResponse({ error: decoded.error }, 400);
    }
    return jsonResponse(buildLiveTvManifest(decoded.config));
  }

  const tvCatalogMatch = path.match(/^\/tv\/([^/]+)\/catalog\/tv\/([^/]+?)(?:\/([^/]+))?\.json$/);
  if (tvCatalogMatch) {
    const decoded = decodeLiveTvConfig(tvCatalogMatch[1]);
    if (!decoded.ok) {
      return jsonResponse({ metas: [], error: decoded.error }, 400);
    }
    return handleLiveTvCatalog(decoded.config, tvCatalogMatch[2], tvCatalogMatch[3], ctx);
  }

  const tvMetaMatch = path.match(/^\/tv\/([^/]+)\/meta\/tv\/([^/]+)\.json$/);
  if (tvMetaMatch) {
    const decoded = decodeLiveTvConfig(tvMetaMatch[1]);
    if (!decoded.ok) {
      return jsonResponse({ meta: null, error: decoded.error }, 400);
    }
    return handleLiveTvMeta(decoded.config, tvMetaMatch[2], ctx);
  }

  const tvStreamMatch = path.match(/^\/tv\/([^/]+)\/stream\/tv\/([^/]+)\.json$/);
  if (tvStreamMatch) {
    const decoded = decodeLiveTvConfig(tvStreamMatch[1]);
    if (!decoded.ok) {
      return jsonResponse({ streams: [], error: decoded.error }, 400);
    }
    return handleLiveTvStream(decoded.config, tvStreamMatch[2], ctx);
  }

  /* ---- VOD Movies & Series Addon routes (/:config/...) ---- */
  // 1) GET /:config/configure
  const configureMatch = path.match(/^\/([^/]+)\/configure\/?$/);
  if (configureMatch) {
    return htmlResponse(renderConfigHtml(url.origin));
  }

  // 2) GET /:config/manifest.json
  const manifestMatch = path.match(/^\/([^/]+)\/manifest\.json$/);
  if (manifestMatch) {
    const decoded = decodeConfig(manifestMatch[1]);
    if (!decoded.ok) {
      return jsonResponse({ error: decoded.error }, 400);
    }
    return jsonResponse(buildManifest(true, brand));
  }

  // 3) GET /:config/catalog/:type/:id.json
  //    GET /:config/catalog/:type/:id/:extra.json
  const catalogMatch = path.match(/^\/([^/]+)\/catalog\/(movie|series)\/([^/]+?)(?:\/([^/]+))?\.json$/);
  if (catalogMatch) {
    const decoded = decodeConfig(catalogMatch[1]);
    if (!decoded.ok) {
      return jsonResponse({ metas: [], error: decoded.error }, 400);
    }
    const type = catalogMatch[2] as 'movie' | 'series';
    const catalogId = catalogMatch[3];
    const extra = catalogMatch[4];
    return handleCatalog(decoded.config, type, catalogId, extra, ctx);
  }

  // 4) GET /:config/meta/:type/:id.json
  const metaMatch = path.match(/^\/([^/]+)\/meta\/(movie|series)\/([^/]+)\.json$/);
  if (metaMatch) {
    const decoded = decodeConfig(metaMatch[1]);
    if (!decoded.ok) {
      return jsonResponse({ meta: null, error: decoded.error }, 400);
    }
    const type = metaMatch[2] as 'movie' | 'series';
    const id = metaMatch[3];
    return handleMeta(decoded.config, type, id, ctx);
  }

  // 5) GET /:config/stream/:type/:id.json
  const streamMatch = path.match(/^\/([^/]+)\/stream\/(movie|series)\/([^/]+)\.json$/);
  if (streamMatch) {
    const decoded = decodeConfig(streamMatch[1]);
    if (!decoded.ok) {
      return jsonResponse({ streams: [], error: decoded.error }, 400);
    }
    const type = streamMatch[2] as 'movie' | 'series';
    const id = streamMatch[3];
    return handleStream(decoded.config, type, id, env, ctx);
  }

  return jsonResponse({ error: 'Route not found' }, 404);
}

// Cloudflare Workers default module export
export default {
  async fetch(request: Request, env: WorkerEnv, ctx: WorkerExecutionContext): Promise<Response> {
    return handleWorkerRequest(request, env, ctx);
  },
};
