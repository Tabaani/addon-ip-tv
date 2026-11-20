import React, { useMemo, useState } from 'react';
import { Check, CheckCircle2, Copy, Film, Loader2, Play, Search, Tv, XCircle } from 'lucide-react';

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

interface StremioVideoItem {
  id: string;
  title: string;
  season: number;
  episode: number;
  released?: string;
  thumbnail?: string;
  overview?: string;
}

interface StremioMetaDetail {
  id: string;
  type: 'movie' | 'series';
  name: string;
  poster?: string;
  background?: string;
  description?: string;
  releaseInfo?: string;
  runtime?: string;
  imdbRating?: string;
  genres?: string[];
  director?: string[];
  cast?: string[];
  videos?: StremioVideoItem[];
}

interface MetaVerificationState {
  item: StremioMetaItem;
  metaEndpoint: string;
  metaSource: 'addon' | 'cinemeta';
  metaHttpStatus: number;
  meta: StremioMetaDetail | null;
  metaError: string | null;
  manifestHasMeta: boolean | null;
  streamEndpoint: string | null;
  streams: StremioStreamItem[] | null;
  streamError: string | null;
  testingStreamForId: string | null;
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

const PosterThumb: React.FC<{ src?: string; alt: string; type: 'movie' | 'series'; large?: boolean }> = ({
  src,
  alt,
  type,
  large = false,
}) => {
  const [failed, setFailed] = useState(false);
  const sizeClass = large ? 'w-28 h-40' : 'w-10 h-14';

  if (!src || failed) {
    return (
      <div
        className={`${sizeClass} rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 text-slate-400`}
      >
        {type === 'series' ? <Tv className={large ? 'w-7 h-7' : 'w-4 h-4'} /> : <Film className={large ? 'w-7 h-7' : 'w-4 h-4'} />}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${sizeClass} rounded-md bg-slate-100 border border-slate-200 object-cover shrink-0`}
    />
  );
};

export const StreamTesterView: React.FC<StreamTesterViewProps> = ({
  encodedConfig,
  isConfigValid,
  onGoConfigure,
}) => {
  const [mode, setMode] = useState<'meta' | 'stream' | 'catalog'>('meta');

  // Name -> Meta + Stream verifier state
  const [metaSearchType, setMetaSearchType] = useState<'movie' | 'series'>('series');
  const [metaQuery, setMetaQuery] = useState('');
  const [metaSearching, setMetaSearching] = useState(false);
  const [metaSearchError, setMetaSearchError] = useState<string | null>(null);
  const [metaCandidates, setMetaCandidates] = useState<StremioMetaItem[] | null>(null);
  const [inspectingMeta, setInspectingMeta] = useState(false);
  const [verification, setVerification] = useState<MetaVerificationState | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [showRawMetaJson, setShowRawMetaJson] = useState(false);
  const [copiedMetaStreamIdx, setCopiedMetaStreamIdx] = useState<number | null>(null);

  // IMDb stream query state
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

  const availableSeasons = useMemo(() => {
    const videos = verification?.meta?.videos;
    if (!videos || videos.length === 0) return [];
    return Array.from(new Set(videos.map((v) => v.season))).sort((a, b) => a - b);
  }, [verification]);

  const seasonEpisodes = useMemo(() => {
    const videos = verification?.meta?.videos;
    if (!videos || videos.length === 0) return [];
    const targetSeason = selectedSeason ?? availableSeasons[0];
    return videos.filter((v) => v.season === targetSeason);
  }, [verification, selectedSeason, availableSeasons]);

  if (!isConfigValid) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center max-w-xl mx-auto">
        <h2 className="text-lg font-semibold text-slate-900">Configure an Xtream Codes account first</h2>
        <p className="mt-2 text-sm text-slate-600">
          Enter your Xtream Codes host URL, username, and password in VOD Addon to search movies or series by name
          and verify that metadata and playable streams load properly for Stremio and Nuvio.
        </p>
        <button
          type="button"
          onClick={onGoConfigure}
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          Go to VOD Addon
        </button>
      </div>
    );
  }

  const testStreamForMetaItem = async (
    targetType: 'movie' | 'series',
    targetId: string,
    currentState: MetaVerificationState
  ) => {
    const endpoint = `/${encodedConfig}/stream/${targetType}/${encodeURIComponent(targetId)}.json`;
    setVerification({
      ...currentState,
      streamEndpoint: endpoint,
      testingStreamForId: targetId,
      streamError: null,
    });

    try {
      const res = await fetch(endpoint);
      const text = await res.text();
      let parsed: { streams?: StremioStreamItem[]; error?: string };
      try {
        parsed = JSON.parse(text) as { streams?: StremioStreamItem[]; error?: string };
      } catch {
        parsed = { error: `HTTP ${res.status} non-JSON response` };
      }

      setVerification((prev) =>
        prev
          ? {
              ...prev,
              streamEndpoint: endpoint,
              testingStreamForId: null,
              streams: res.ok && Array.isArray(parsed.streams) ? parsed.streams : [],
              streamError: !res.ok ? parsed.error || `HTTP ${res.status}` : null,
            }
          : prev
      );
    } catch {
      setVerification((prev) =>
        prev
          ? {
              ...prev,
              streamEndpoint: endpoint,
              testingStreamForId: null,
              streams: [],
              streamError: 'Network error while resolving playable stream.',
            }
          : prev
      );
    }
  };

  const inspectCatalogItemMeta = async (item: StremioMetaItem) => {
    setInspectingMeta(true);
    setShowRawMetaJson(false);
    setSelectedSeason(null);

    const isXtreamId = item.id.startsWith('xtream:');
    const metaSource: 'addon' | 'cinemeta' = isXtreamId ? 'addon' : 'cinemeta';
    const metaEndpoint = isXtreamId
      ? `/${encodedConfig}/meta/${item.type}/${encodeURIComponent(item.id)}.json`
      : `https://v3-cinemeta.strem.io/meta/${item.type}/${encodeURIComponent(item.id)}.json`;

    try {
      // Check manifest meta support + fetch item metadata in parallel
      const [manifestRes, metaRes] = await Promise.all([
        fetch(`/${encodedConfig}/manifest.json`).catch(() => null),
        fetch(metaEndpoint),
      ]);

      let manifestHasMeta: boolean | null = null;
      if (manifestRes && manifestRes.ok) {
        try {
          const manifestData = (await manifestRes.json()) as {
            resources?: Array<string | { name?: string; idPrefixes?: string[] }>;
          };
          manifestHasMeta = Array.isArray(manifestData.resources)
            ? manifestData.resources.some((r) =>
                typeof r === 'string' ? r === 'meta' : r?.name === 'meta'
              )
            : false;
        } catch {
          manifestHasMeta = null;
        }
      }

      const rawText = await metaRes.text();
      let parsed: { meta?: StremioMetaDetail | null; error?: string };
      try {
        parsed = JSON.parse(rawText) as { meta?: StremioMetaDetail | null; error?: string };
      } catch {
        parsed = { meta: null, error: `Meta endpoint returned HTTP ${metaRes.status} (non-JSON).` };
      }

      const metaObj = parsed.meta && parsed.meta.id && parsed.meta.name ? parsed.meta : null;
      const nextState: MetaVerificationState = {
        item,
        metaEndpoint,
        metaSource,
        metaHttpStatus: metaRes.status,
        meta: metaObj,
        metaError:
          !metaRes.ok || !metaObj
            ? parsed.error || 'No metadata returned for this item (Stremio/Nuvio would show "No addon provides meta").'
            : null,
        manifestHasMeta,
        streamEndpoint: null,
        streams: null,
        streamError: null,
        testingStreamForId: null,
      };

      setVerification(nextState);
      if (metaObj?.videos && metaObj.videos.length > 0) {
        const seasons = Array.from(new Set(metaObj.videos.map((v) => v.season))).sort((a, b) => a - b);
        setSelectedSeason(seasons[0] ?? null);
      }

      // Automatically verify stream playback for movies (or first episode of a series)
      if (metaObj) {
        if (item.type === 'movie') {
          await testStreamForMetaItem('movie', metaObj.id, nextState);
        } else if (metaObj.videos && metaObj.videos.length > 0) {
          await testStreamForMetaItem('series', metaObj.videos[0].id, nextState);
        }
      }
    } catch {
      setVerification({
        item,
        metaEndpoint,
        metaSource,
        metaHttpStatus: 0,
        meta: null,
        metaError: 'Network error while requesting metadata endpoint.',
        manifestHasMeta: null,
        streamEndpoint: null,
        streams: null,
        streamError: null,
        testingStreamForId: null,
      });
    } finally {
      setInspectingMeta(false);
    }
  };

  const runNameMetaSearch = async () => {
    const trimmed = metaQuery.trim();
    if (!trimmed) {
      setMetaSearchError('Enter a movie or series name to search your IPTV catalog.');
      return;
    }

    const catalogId = metaSearchType === 'movie' ? 'iptv-movies' : 'iptv-series';
    const endpoint = `/${encodedConfig}/catalog/${metaSearchType}/${catalogId}/search=${encodeURIComponent(trimmed)}.json`;

    setMetaSearching(true);
    setMetaSearchError(null);
    setMetaCandidates(null);
    setVerification(null);

    try {
      const res = await fetch(endpoint);
      const rawText = await res.text();
      let data: { metas?: StremioMetaItem[]; error?: string };
      try {
        data = JSON.parse(rawText) as { metas?: StremioMetaItem[]; error?: string };
      } catch {
        data = { error: `Catalog search returned HTTP ${res.status} (non-JSON).` };
      }

      if (!res.ok) {
        setMetaSearchError(data.error || `Catalog search failed (HTTP ${res.status}).`);
        return;
      }

      const found = Array.isArray(data.metas) ? data.metas.slice(0, 25) : [];
      setMetaCandidates(found);

      // Automatically verify metadata on the first match
      if (found.length > 0) {
        await inspectCatalogItemMeta(found[0]);
      }
    } catch {
      setMetaSearchError('Network error while searching your IPTV catalog.');
    } finally {
      setMetaSearching(false);
    }
  };

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

  const copyUrl = async (url: string, idx: number, target: 'imdb' | 'meta') => {
    try {
      await navigator.clipboard.writeText(url);
      if (target === 'imdb') {
        setCopiedIdx(idx);
        setTimeout(() => setCopiedIdx(null), 1600);
      } else {
        setCopiedMetaStreamIdx(idx);
        setTimeout(() => setCopiedMetaStreamIdx(null), 1600);
      }
    } catch {
      // Ignore clipboard failure
    }
  };

  const metaReady = Boolean(
    verification?.meta &&
      verification.metaHttpStatus === 200 &&
      (verification.metaSource === 'cinemeta' || verification.manifestHasMeta !== false)
  );
  const seriesHasEpisodes =
    verification?.item.type !== 'series' ||
    Boolean(verification?.meta?.videos && verification.meta.videos.length > 0);
  const streamReady = Boolean(verification?.streams && verification.streams.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Stremio & Nuvio Addon Tester
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Search any movie or series by name to verify metadata, episodes, and playable streams before opening Stremio or Nuvio.
          </p>
        </div>

        <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg self-start overflow-x-auto">
          <button
            type="button"
            onClick={() => setMode('meta')}
            className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'meta' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Meta Verifier (By Name)
          </button>
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

      {mode === 'meta' && (
        <div className="space-y-6">
          {/* Name Search Bar */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
              <div className="md:col-span-3">
                <label htmlFor="meta-type" className="block text-sm font-medium text-slate-800">
                  Content Type
                </label>
                <select
                  id="meta-type"
                  value={metaSearchType}
                  onChange={(e) => setMetaSearchType(e.target.value as 'movie' | 'series')}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                >
                  <option value="series">Series</option>
                  <option value="movie">Movie</option>
                </select>
              </div>

              <div className="md:col-span-6">
                <label htmlFor="meta-name-query" className="block text-sm font-medium text-slate-800">
                  Movie or Series Name
                </label>
                <div className="relative mt-1.5">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="meta-name-query"
                    type="text"
                    value={metaQuery}
                    onChange={(e) => setMetaQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') runNameMetaSearch();
                    }}
                    placeholder={metaSearchType === 'series' ? 'e.g. Breaking Bad, Game of Thrones, Squid Game' : 'e.g. Inception, Interstellar, Dune'}
                    className="w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                  />
                </div>
              </div>

              <div className="md:col-span-3">
                <button
                  type="button"
                  onClick={runNameMetaSearch}
                  disabled={metaSearching}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {metaSearching && <Loader2 className="w-4 h-4 animate-spin" />}
                  {metaSearching ? 'Searching...' : 'Test Metadata'}
                </button>
              </div>
            </div>

            {metaSearchError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {metaSearchError}
              </div>
            )}
          </section>

          {/* Results Split View: Matching Catalog Titles (left) + Live Meta & Stream Proof (right) */}
          {metaCandidates !== null && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left 4 columns: Catalog Matches */}
              <section className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">
                    Catalog matches ({metaCandidates.length})
                  </span>
                  <span className="text-xs text-slate-500">Click to inspect meta</span>
                </div>

                {metaCandidates.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    No {metaSearchType === 'series' ? 'series' : 'movies'} matched &ldquo;{metaQuery}&rdquo; in your IPTV catalog.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                    {metaCandidates.map((cand) => {
                      const active = verification?.item.id === cand.id;
                      return (
                        <button
                          key={cand.id}
                          type="button"
                          onClick={() => inspectCatalogItemMeta(cand)}
                          className={`w-full text-left p-3 flex items-start gap-3 transition-colors ${
                            active ? 'bg-blue-50/70' : 'bg-white hover:bg-slate-50'
                          }`}
                        >
                          <PosterThumb src={cand.poster} alt={cand.name} type={cand.type} />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-900 line-clamp-2">{cand.name}</div>
                            <div className="mt-1 font-mono text-[11px] text-slate-500 truncate">
                              {cand.id}
                              {cand.releaseInfo ? ` · ${cand.releaseInfo}` : ''}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Right 8 columns: Live Meta & Stream Inspection */}
              <section className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
                {inspectingMeta ? (
                  <div className="py-16 flex items-center justify-center gap-2 text-sm text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Fetching live metadata and verifying Stremio / Nuvio compatibility...
                  </div>
                ) : !verification ? (
                  <div className="py-16 text-center text-sm text-slate-500">
                    Select a result on the left to inspect its metadata and playable stream.
                  </div>
                ) : (
                  <>
                    {/* Readiness Verdict Banner */}
                    <div
                      className={`rounded-lg border p-4 ${
                        metaReady && seriesHasEpisodes
                          ? 'border-emerald-200 bg-emerald-50/70 text-emerald-950'
                          : 'border-red-200 bg-red-50/70 text-red-900'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-semibold text-sm">
                          {metaReady && seriesHasEpisodes ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-700 shrink-0" />
                          )}
                          {metaReady && seriesHasEpisodes
                            ? 'Ready for Stremio & Nuvio — Metadata verified'
                            : 'Metadata issue detected — Stremio & Nuvio will fail to open this item'}
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowRawMetaJson((prev) => !prev)}
                          className="text-xs font-medium underline underline-offset-2"
                        >
                          {showRawMetaJson ? 'Hide raw Meta JSON' : 'Show raw Meta JSON'}
                        </button>
                      </div>

                      <div className="mt-3 pt-3 border-t border-black/10 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div>
                          <div className="opacity-75">Meta Provider</div>
                          <div className="font-mono font-semibold mt-0.5">
                            {verification.metaSource === 'addon' ? 'Addon /meta (xtream:)' : 'Cinemeta (tt)'} · HTTP{' '}
                            {verification.metaHttpStatus || 'ERR'}
                          </div>
                        </div>
                        <div>
                          <div className="opacity-75">
                            {verification.item.type === 'series' ? 'Episodes Loaded' : 'Manifest Meta Resource'}
                          </div>
                          <div className="font-mono font-semibold mt-0.5 tabular-nums">
                            {verification.item.type === 'series'
                              ? `${verification.meta?.videos?.length ?? 0} episodes (${availableSeasons.length} seasons)`
                              : verification.manifestHasMeta
                                ? 'Declared (v1.1.0+)'
                                : 'Missing in manifest'}
                          </div>
                        </div>
                        <div>
                          <div className="opacity-75">Playable Stream Check</div>
                          <div className="font-mono font-semibold mt-0.5">
                            {verification.testingStreamForId
                              ? 'Testing...'
                              : streamReady
                                ? `Pass (${verification.streams?.length} stream${verification.streams?.length === 1 ? '' : 's'})`
                                : verification.streamError || 'No stream returned'}
                          </div>
                        </div>
                      </div>

                      {verification.metaError && (
                        <p className="mt-3 text-xs font-medium text-red-800">{verification.metaError}</p>
                      )}
                    </div>

                    {showRawMetaJson && (
                      <pre className="rounded-lg bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-slate-100 overflow-x-auto max-h-72">
                        {JSON.stringify({ meta: verification.meta }, null, 2)}
                      </pre>
                    )}

                    {/* Rendered Metadata Card (What Stremio / Nuvio Displays) */}
                    {verification.meta && (
                      <div className="flex flex-col sm:flex-row gap-5">
                        <PosterThumb
                          src={verification.meta.poster}
                          alt={verification.meta.name}
                          type={verification.meta.type}
                          large
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <h2 className="text-lg font-bold text-slate-900">{verification.meta.name}</h2>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                            <span className="font-mono text-slate-700">{verification.meta.id}</span>
                            {verification.meta.releaseInfo && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="tabular-nums">{verification.meta.releaseInfo}</span>
                              </>
                            )}
                            {verification.meta.runtime && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{verification.meta.runtime}</span>
                              </>
                            )}
                            {verification.meta.imdbRating && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="tabular-nums">Rating {verification.meta.imdbRating}</span>
                              </>
                            )}
                          </div>

                          {verification.meta.genres && verification.meta.genres.length > 0 && (
                            <div className="text-xs text-slate-600">
                              {verification.meta.genres.join(' · ')}
                            </div>
                          )}

                          <p className="text-sm text-slate-600 leading-relaxed">
                            {verification.meta.description || 'No plot synopsis provided by the IPTV panel (title will still load and play normally).'}
                          </p>

                          <div className="pt-1 font-mono text-[11px] text-slate-400 break-all">
                            GET {verification.metaEndpoint.replace(/^\/[^/]+/, '/:config')}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Series Episodes Browser */}
                    {verification.meta?.type === 'series' && (
                      <div className="pt-4 border-t border-slate-100 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-slate-900">
                            Series Episodes ({verification.meta.videos?.length ?? 0})
                          </h3>
                          {availableSeasons.length > 1 && (
                            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
                              {availableSeasons.map((sNum) => (
                                <button
                                  key={sNum}
                                  type="button"
                                  onClick={() => setSelectedSeason(sNum)}
                                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors tabular-nums ${
                                    (selectedSeason ?? availableSeasons[0]) === sNum
                                      ? 'bg-white text-slate-900 shadow-xs'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                >
                                  S{String(sNum).padStart(2, '0')}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {seasonEpisodes.length === 0 ? (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                            This series returned metadata, but the IPTV panel returned 0 episodes in <code className="font-mono">get_series_info</code>.
                          </div>
                        ) : (
                          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-60 overflow-y-auto">
                            {seasonEpisodes.map((ep) => {
                              const isTesting = verification.testingStreamForId === ep.id;
                              return (
                                <div
                                  key={ep.id}
                                  className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50"
                                >
                                  <div className="min-w-0">
                                    <div className="text-xs font-medium text-slate-900 truncate">
                                      <span className="font-mono text-slate-500 mr-2 tabular-nums">
                                        S{String(ep.season).padStart(2, '0')}E{String(ep.episode).padStart(2, '0')}
                                      </span>
                                      {ep.title}
                                    </div>
                                    <div className="font-mono text-[11px] text-slate-400 truncate">{ep.id}</div>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={isTesting}
                                    onClick={() => testStreamForMetaItem('series', ep.id, verification)}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                                  >
                                    {isTesting ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Play className="w-3 h-3" />
                                    )}
                                    Test stream
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Resolved Stream Preview */}
                    {verification.streams !== null && (
                      <div className="pt-4 border-t border-slate-100 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-slate-900">
                            Playable Stream Verification ({verification.streams.length})
                          </h3>
                          {verification.streamEndpoint && (
                            <span className="font-mono text-[11px] text-slate-400 break-all">
                              GET {verification.streamEndpoint.replace(/^\/[^/]+/, '/:config')}
                            </span>
                          )}
                        </div>

                        {verification.streams.length === 0 ? (
                          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
                            {verification.streamError || 'No stream URL was returned for this item.'}
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                            {verification.streams.map((st, idx) => (
                              <div key={`${st.url}-${idx}`} className="p-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                                <div className="min-w-0 space-y-1">
                                  <div className="font-mono text-xs font-semibold text-blue-700">
                                    {st.name.replace(/\n/g, ' · ')}
                                  </div>
                                  <div className="text-xs font-medium text-slate-900 whitespace-pre-line">
                                    {st.title}
                                  </div>
                                  <div className="font-mono text-[11px] text-slate-500 break-all">{st.url}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => copyUrl(st.url, idx, 'meta')}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                                >
                                  {copiedMetaStreamIdx === idx ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                  {copiedMetaStreamIdx === idx ? 'Copied' : 'Copy URL'}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      )}

      {mode === 'stream' && (
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
                            onClick={() => copyUrl(stream.url, idx, 'imdb')}
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
      )}

      {mode === 'catalog' && (
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
                        <th className="py-2.5 px-4 text-right">Action</th>
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
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setMode('meta');
                                setMetaSearchType(item.type);
                                setMetaQuery(item.name);
                                setMetaCandidates([item]);
                                inspectCatalogItemMeta(item);
                              }}
                              className="text-xs font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap"
                            >
                              Verify Meta →
                            </button>
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
