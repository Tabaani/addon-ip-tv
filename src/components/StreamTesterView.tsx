import React, { useState } from 'react';
import { Check, Copy, Loader2, Search } from 'lucide-react';

interface StremioStreamItem {
  name: string;
  title: string;
  url: string;
  behaviorHints?: {
    notWebReady?: boolean;
    bingeGroup?: string;
  };
}

interface StremioMetaItem {
  id: string;
  type: 'movie' | 'series';
  name: string;
  poster?: string;
  releaseInfo?: string;
  imdbRating?: string;
  description?: string;
}

interface StreamTesterViewProps {
  encodedConfig: string;
  isConfigValid: boolean;
  onGoConfigure: () => void;
}

const STREAM_PRESETS = [
  { label: 'Inception (2010)', type: 'movie' as const, imdbId: 'tt1375666', season: '1', episode: '1' },
  { label: 'Interstellar (2014)', type: 'movie' as const, imdbId: 'tt0816692', season: '1', episode: '1' },
  { label: 'Breaking Bad S01E02', type: 'series' as const, imdbId: 'tt0903747', season: '1', episode: '2' },
  { label: 'Game of Thrones S01E01', type: 'series' as const, imdbId: 'tt0944947', season: '1', episode: '1' },
];

export const StreamTesterView: React.FC<StreamTesterViewProps> = ({
  encodedConfig,
  isConfigValid,
  onGoConfigure,
}) => {
  const [mode, setMode] = useState<'stream' | 'catalog'>('stream');

  // Stream query state
  const [mediaType, setMediaType] = useState<'movie' | 'series'>('movie');
  const [imdbId, setImdbId] = useState('tt1375666');
  const [season, setSeason] = useState('1');
  const [episode, setEpisode] = useState('2');
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streams, setStreams] = useState<StremioStreamItem[] | null>(null);
  const [lastStreamPath, setLastStreamPath] = useState<string>('');
  const [showRawJson, setShowRawJson] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // Catalog query state
  const [catalogType, setCatalogType] = useState<'movie' | 'series'>('movie');
  const [searchQuery, setSearchQuery] = useState('');
  const [skip, setSkip] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [metas, setMetas] = useState<StremioMetaItem[] | null>(null);
  const [lastCatalogPath, setLastCatalogPath] = useState('');

  if (!isConfigValid) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center max-w-xl mx-auto">
        <h2 className="text-lg font-semibold text-slate-900">Configure an Xtream Codes account first</h2>
        <p className="mt-2 text-sm text-slate-600">
          Enter your Xtream Codes host URL, username, and password in Configure to run live Stremio stream
          and catalog queries directly against the addon endpoints.
        </p>
        <button
          type="button"
          onClick={onGoConfigure}
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          Go to Configure
        </button>
      </div>
    );
  }

  const runStreamLookup = async (override?: { type: 'movie' | 'series'; imdbId: string; season: string; episode: string }) => {
    const activeType = override?.type ?? mediaType;
    const activeImdb = (override?.imdbId ?? imdbId).trim();
    const activeSeason = (override?.season ?? season).trim();
    const activeEpisode = (override?.episode ?? episode).trim();

    if (!/^tt\d{5,10}$/i.test(activeImdb)) {
      setStreamError('Enter a valid IMDb ID starting with "tt" (for example tt1375666).');
      return;
    }

    const idParam =
      activeType === 'series'
        ? `${activeImdb}:${Number.parseInt(activeSeason, 10) || 1}:${Number.parseInt(activeEpisode, 10) || 1}`
        : activeImdb;

    const endpoint = `/${encodedConfig}/stream/${activeType}/${encodeURIComponent(idParam)}.json`;
    setLastStreamPath(endpoint);
    setStreamLoading(true);
    setStreamError(null);
    setStreams(null);

    try {
      const res = await fetch(endpoint);
      const data = (await res.json()) as { streams?: StremioStreamItem[]; error?: string };
      if (!res.ok) {
        setStreamError(data.error || `Request failed with HTTP ${res.status}`);
      } else {
        setStreams(Array.isArray(data.streams) ? data.streams : []);
      }
    } catch {
      setStreamError('Network error while querying /stream endpoint.');
    } finally {
      setStreamLoading(false);
    }
  };

  const runCatalogLookup = async (nextSkip = skip) => {
    const catalogId = catalogType === 'movie' ? 'iptv-movies' : 'iptv-series';
    const extraParts: string[] = [];
    if (searchQuery.trim()) {
      extraParts.push(`search=${encodeURIComponent(searchQuery.trim())}`);
    }
    if (nextSkip > 0) {
      extraParts.push(`skip=${nextSkip}`);
    }

    const endpoint =
      extraParts.length > 0
        ? `/${encodedConfig}/catalog/${catalogType}/${catalogId}/${extraParts.join('&')}.json`
        : `/${encodedConfig}/catalog/${catalogType}/${catalogId}.json`;

    setSkip(nextSkip);
    setLastCatalogPath(endpoint);
    setCatalogLoading(true);
    setCatalogError(null);

    try {
      const res = await fetch(endpoint);
      const data = (await res.json()) as { metas?: StremioMetaItem[]; error?: string };
      if (!res.ok) {
        setCatalogError(data.error || `Catalog request failed with HTTP ${res.status}`);
        setMetas([]);
      } else {
        setMetas(Array.isArray(data.metas) ? data.metas : []);
      }
    } catch {
      setCatalogError('Network error while querying /catalog endpoint.');
      setMetas([]);
    } finally {
      setCatalogLoading(false);
    }
  };

  const copyStreamUrl = async (url: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1600);
    } catch {
      setCopiedIdx(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Live Stremio Endpoint Tester</h1>
          <p className="mt-1 text-sm text-slate-600">
            Execute real requests against the running addon routes using your encoded configuration.
          </p>
        </div>

        <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setMode('stream')}
            className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'stream' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            IMDb Stream Resolver
          </button>
          <button
            type="button"
            onClick={() => setMode('catalog')}
            className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'catalog' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Catalog Browser
          </button>
        </div>
      </div>

      {mode === 'stream' ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Quick presets:</span>
            {STREAM_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setMediaType(preset.type);
                  setImdbId(preset.imdbId);
                  setSeason(preset.season);
                  setEpisode(preset.episode);
                  runStreamLookup(preset);
                }}
                className="text-blue-600 hover:text-blue-800 hover:underline font-medium px-1.5 py-0.5"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-3">
              <label htmlFor="stream-type" className="block text-sm font-medium text-slate-800">
                Type
              </label>
              <select
                id="stream-type"
                value={mediaType}
                onChange={(e) => setMediaType(e.target.value as 'movie' | 'series')}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              >
                <option value="movie">Movie</option>
                <option value="series">Series Episode</option>
              </select>
            </div>

            <div className={mediaType === 'series' ? 'md:col-span-4' : 'md:col-span-6'}>
              <label htmlFor="imdb-id" className="block text-sm font-medium text-slate-800">
                IMDb ID
              </label>
              <input
                id="imdb-id"
                type="text"
                value={imdbId}
                onChange={(e) => setImdbId(e.target.value)}
                placeholder="tt1375666"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>

            {mediaType === 'series' && (
              <>
                <div className="md:col-span-1">
                  <label htmlFor="season-num" className="block text-sm font-medium text-slate-800">
                    Season
                  </label>
                  <input
                    id="season-num"
                    type="number"
                    min={0}
                    value={season}
                    onChange={(e) => setSeason(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div className="md:col-span-1">
                  <label htmlFor="ep-num" className="block text-sm font-medium text-slate-800">
                    Episode
                  </label>
                  <input
                    id="ep-num"
                    type="number"
                    min={0}
                    value={episode}
                    onChange={(e) => setEpisode(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </>
            )}

            <div className="md:col-span-3">
              <button
                type="button"
                onClick={() => runStreamLookup()}
                disabled={streamLoading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {streamLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {streamLoading ? 'Resolving...' : 'Resolve streams'}
              </button>
            </div>
          </div>

          {streamError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {streamError}
            </div>
          )}

          {streams !== null && (
            <div className="pt-4 border-t border-slate-100 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-700">
                  <span className="font-semibold text-slate-900 tabular-nums">{streams.length}</span>{' '}
                  {streams.length === 1 ? 'stream matched' : 'streams matched'}
                  <span className="mx-2 text-slate-300">·</span>
                  <span className="font-mono text-xs text-slate-500 break-all">
                    GET {lastStreamPath.replace(/^\/[^/]+/, '/:config')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRawJson((prev) => !prev)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  {showRawJson ? 'Hide raw JSON' : 'Show raw JSON'}
                </button>
              </div>

              {showRawJson && (
                <pre className="rounded-lg bg-slate-950 p-4 font-mono text-xs text-slate-100 overflow-x-auto max-h-80">
                  {JSON.stringify({ streams }, null, 2)}
                </pre>
              )}

              {streams.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  No Xtream items crossed the 0.85 confidence threshold for this IMDb ID (or the provider does not carry this title/episode).
                </div>
              ) : (
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                  {streams.map((stream, idx) => (
                    <div key={`${stream.url}-${idx}`} className="p-4 bg-white hover:bg-slate-50/70 transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="font-mono text-xs font-semibold text-blue-700">
                            {stream.name.replace(/\n/g, ' · ')}
                          </div>
                          <div className="text-sm font-medium text-slate-900 whitespace-pre-line">
                            {stream.title}
                          </div>
                          <div className="font-mono text-xs text-slate-500 break-all pt-1">
                            {stream.url}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => copyStreamUrl(stream.url, idx)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                          >
                            {copiedIdx === idx ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            {copiedIdx === idx ? 'Copied' : 'Copy URL'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-3">
              <label htmlFor="cat-type" className="block text-sm font-medium text-slate-800">
                Catalog
              </label>
              <select
                id="cat-type"
                value={catalogType}
                onChange={(e) => {
                  setCatalogType(e.target.value as 'movie' | 'series');
                  setSkip(0);
                }}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                <option value="movie">IPTV 8K Movies (iptv-movies)</option>
                <option value="series">IPTV 8K Series (iptv-series)</option>
              </select>
            </div>

            <div className="md:col-span-6">
              <label htmlFor="cat-search" className="block text-sm font-medium text-slate-800">
                Search query <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <div className="relative mt-1.5">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="cat-search"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runCatalogLookup(0);
                  }}
                  placeholder="Filter by title (e.g. Inception, Dune, Breaking Bad)"
                  className="w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                />
              </div>
            </div>

            <div className="md:col-span-3">
              <button
                type="button"
                onClick={() => runCatalogLookup(0)}
                disabled={catalogLoading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {catalogLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {catalogLoading ? 'Fetching...' : 'Fetch catalog'}
              </button>
            </div>
          </div>

          {catalogError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {catalogError}
            </div>
          )}

          {metas !== null && (
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <div className="text-slate-600">
                  Showing <span className="font-semibold text-slate-900 tabular-nums">{metas.length}</span> items
                  (offset <span className="font-mono tabular-nums">{skip}</span>)
                  {lastCatalogPath && (
                    <>
                      <span className="mx-2 text-slate-300">·</span>
                      <span className="font-mono text-xs text-slate-500">
                        GET {lastCatalogPath.replace(/^\/[^/]+/, '/:config')}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={skip === 0 || catalogLoading}
                    onClick={() => runCatalogLookup(Math.max(0, skip - 100))}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Previous 100
                  </button>
                  <button
                    type="button"
                    disabled={metas.length < 100 || catalogLoading}
                    onClick={() => runCatalogLookup(skip + 100)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Next 100
                  </button>
                </div>
              </div>

              {metas.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  No catalog entries matched this query.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-4">Title</th>
                        <th className="py-2.5 px-4">Stremio ID</th>
                        <th className="py-2.5 px-4 text-right">Year</th>
                        <th className="py-2.5 px-4 text-right">Rating</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {metas.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/80">
                          <td className="py-2.5 px-4 font-medium text-slate-900">{item.name}</td>
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-600">{item.id}</td>
                          <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                            {item.releaseInfo || '—'}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                            {item.imdbRating || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
