import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Search,
  Trash2,
  Tv,
  X,
} from 'lucide-react';
import {
  AddonConfig,
  LiveStreamFormat,
  encodeLiveTvConfig,
  validateAndNormalizeHost,
} from '../index';

interface LiveCategory {
  id: string;
  name: string;
  count: number;
}

export interface LiveChannelItem {
  id: number;
  name: string;
  categoryId: string;
  categoryName: string;
  icon?: string;
}

interface LiveChannelsResponse {
  ok: boolean;
  error?: string;
  normalizedHost?: string;
  totalChannels?: number;
  matchedCount?: number;
  truncated?: boolean;
  activeCategoryId?: string;
  categories?: LiveCategory[];
  channels?: LiveChannelItem[];
}

interface LiveTvBuilderViewProps {
  config: AddonConfig;
  onConfigChange: (next: AddonConfig) => void;
  baseDomain: string;
  onBaseDomainChange: (domain: string) => void;
  collectionName: string;
  onCollectionNameChange: (name: string) => void;
  streamFormat: LiveStreamFormat;
  onStreamFormatChange: (format: LiveStreamFormat) => void;
  selectedChannels: LiveChannelItem[];
  onSelectedChannelsChange: React.Dispatch<React.SetStateAction<LiveChannelItem[]>>;
  manifestUrl: string;
  stremioUrl: string;
  isLiveAddonReady: boolean;
}

const MAX_SELECTED = 500;

const ChannelLogo: React.FC<{ src?: string; name: string }> = ({ src, name }) => {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="w-8 h-8 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 text-slate-400">
        <Tv className="w-4 h-4" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="w-8 h-8 rounded-md bg-slate-100 border border-slate-200 object-contain p-0.5 shrink-0"
    />
  );
};

export const LiveTvBuilderView: React.FC<LiveTvBuilderViewProps> = ({
  config,
  onConfigChange,
  baseDomain,
  onBaseDomainChange,
  collectionName,
  onCollectionNameChange,
  streamFormat,
  onStreamFormatChange,
  selectedChannels,
  onSelectedChannelsChange,
  manifestUrl,
  stremioUrl,
  isLiveAddonReady,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [totalChannels, setTotalChannels] = useState(0);
  const [matchedCount, setMatchedCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [categories, setCategories] = useState<LiveCategory[]>([]);
  const [channels, setChannels] = useState<LiveChannelItem[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [channelSearch, setChannelSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [manifestJson, setManifestJson] = useState<string | null>(null);
  const [loadingManifest, setLoadingManifest] = useState(false);

  const selectedIdSet = useMemo(() => new Set(selectedChannels.map((c) => c.id)), [selectedChannels]);

  const hostValid = validateAndNormalizeHost(config.host).ok;
  const credsReady = hostValid && config.username.trim().length > 0 && config.password.trim().length > 0;

  const filteredCategories = useMemo(() => {
    const q = categoryFilter.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, categoryFilter]);

  const fetchChannels = async (opts?: { categoryId?: string; search?: string }) => {
    if (!credsReady) {
      setError('Enter a valid http:// or https:// Xtream host, username, and password first.');
      return;
    }

    const nextCategoryId = opts?.categoryId !== undefined ? opts.categoryId : activeCategoryId;
    const nextSearch = opts?.search !== undefined ? opts.search : channelSearch;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/live-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: config.host,
          username: config.username,
          password: config.password,
          categoryId: nextCategoryId || undefined,
          search: nextSearch.trim() || undefined,
        }),
      });

      const rawText = await response.text();
      let data: LiveChannelsResponse;
      try {
        data = JSON.parse(rawText) as LiveChannelsResponse;
      } catch {
        data = {
          ok: false,
          error: `Server returned HTTP ${response.status} while fetching Live TV channels.`,
        };
      }

      if (!response.ok || !data.ok) {
        setError(data.error || 'Unable to load Live TV channels.');
        return;
      }

      if (data.normalizedHost && data.normalizedHost !== config.host) {
        onConfigChange({ ...config, host: data.normalizedHost });
      }

      setHasLoaded(true);
      setTotalChannels(data.totalChannels ?? 0);
      setMatchedCount(data.matchedCount ?? 0);
      setTruncated(Boolean(data.truncated));
      setCategories(Array.isArray(data.categories) ? data.categories : []);
      setChannels(Array.isArray(data.channels) ? data.channels : []);
      setActiveCategoryId(data.activeCategoryId ?? 'all');
    } catch {
      setError('Network error while fetching Live TV channels.');
    } finally {
      setLoading(false);
    }
  };

  const toggleChannel = (channel: LiveChannelItem) => {
    onSelectedChannelsChange((prev) => {
      if (prev.some((c) => c.id === channel.id)) {
        return prev.filter((c) => c.id !== channel.id);
      }
      if (prev.length >= MAX_SELECTED) {
        return prev;
      }
      return [...prev, channel];
    });
  };

  const selectAllVisible = () => {
    onSelectedChannelsChange((prev) => {
      const existing = new Set(prev.map((c) => c.id));
      const next = [...prev];
      for (const ch of channels) {
        if (!existing.has(ch.id)) {
          if (next.length >= MAX_SELECTED) break;
          existing.add(ch.id);
          next.push(ch);
        }
      }
      return next;
    });
  };

  const deselectAllVisible = () => {
    const visibleSet = new Set(channels.map((c) => c.id));
    onSelectedChannelsChange((prev) => prev.filter((c) => !visibleSet.has(c.id)));
  };

  const moveChannel = (index: number, delta: -1 | 1) => {
    onSelectedChannelsChange((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  };

  const removeChannel = (id: number) => {
    onSelectedChannelsChange((prev) => prev.filter((c) => c.id !== id));
  };

  const handleCopyManifest = async () => {
    if (!manifestUrl) return;
    try {
      await navigator.clipboard.writeText(manifestUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const handleInspectManifest = async () => {
    if (!isLiveAddonReady) return;
    if (manifestJson) {
      setManifestJson(null);
      return;
    }
    setLoadingManifest(true);
    try {
      const parsed = new URL(manifestUrl);
      const res = await fetch(parsed.pathname);
      const data = await res.json();
      setManifestJson(JSON.stringify(data, null, 2));
    } catch {
      setManifestJson('Unable to fetch Live TV manifest JSON.');
    } finally {
      setLoadingManifest(false);
    }
  };

  // Compute live encoded token length for user visibility on very large collections
  const encodedPreviewLength = useMemo(() => {
    if (!isLiveAddonReady) return 0;
    const hostCheck = validateAndNormalizeHost(config.host);
    if (!hostCheck.ok) return 0;
    return encodeLiveTvConfig({
      host: hostCheck.host,
      username: config.username,
      password: config.password,
      name: collectionName,
      format: streamFormat,
      channelIds: selectedChannels.map((c) => c.id),
    }).length;
  }, [isLiveAddonReady, config, collectionName, streamFormat, selectedChannels]);

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
          Build a custom Live TV channel collection addon
        </h1>
        <p className="mt-2 text-base text-slate-600 leading-relaxed">
          Create a separate Stremio Live TV addon containing only the exact TV channels you pick.
          Give each collection its own name so you can install multiple curated channel packs side-by-side in Stremio.
        </p>
      </div>

      {/* Credentials & Collection Settings Panel */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-5">
            <label htmlFor="tv-host" className="block text-sm font-medium text-slate-800">
              Xtream Codes Host URL
            </label>
            <input
              id="tv-host"
              type="url"
              value={config.host}
              onChange={(e) => onConfigChange({ ...config, host: e.target.value })}
              placeholder="http://line.example.com:8080"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          <div className="md:col-span-3">
            <label htmlFor="tv-user" className="block text-sm font-medium text-slate-800">
              Xtream Username
            </label>
            <input
              id="tv-user"
              type="text"
              autoComplete="off"
              value={config.username}
              onChange={(e) => onConfigChange({ ...config, username: e.target.value })}
              placeholder="subscriber_user"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          <div className="md:col-span-4">
            <label htmlFor="tv-pass" className="block text-sm font-medium text-slate-800">
              Xtream Password
            </label>
            <div className="relative mt-1.5">
              <input
                id="tv-pass"
                type={showPassword ? 'text' : 'password'}
                autoComplete="off"
                value={config.password}
                onChange={(e) => onConfigChange({ ...config, password: e.target.value })}
                placeholder="subscriber_pass"
                className="w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-10 py-2.5 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-700"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end pt-4 border-t border-slate-100">
          <div className="md:col-span-5">
            <label htmlFor="tv-collection-name" className="block text-sm font-medium text-slate-800">
              Collection Addon Name
            </label>
            <input
              id="tv-collection-name"
              type="text"
              maxLength={60}
              value={collectionName}
              onChange={(e) => onCollectionNameChange(e.target.value)}
              placeholder="e.g. Sports & News TV"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          <div className="md:col-span-4">
            <label htmlFor="tv-format" className="block text-sm font-medium text-slate-800">
              Stream Format
            </label>
            <select
              id="tv-format"
              value={streamFormat}
              onChange={(e) => onStreamFormatChange(e.target.value as LiveStreamFormat)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            >
              <option value="both">MPEG-TS + HLS (Recommended)</option>
              <option value="ts">MPEG-TS (.ts) only</option>
              <option value="m3u8">HLS (.m3u8) only</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <button
              type="button"
              onClick={() => fetchChannels({ categoryId: '', search: '' })}
              disabled={loading || !credsReady}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Loading channels...' : hasLoaded ? 'Refresh TV channels' : 'Load TV channels'}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {hasLoaded && !error && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 pt-1">
            <span>
              Provider library: <strong className="font-mono text-slate-900 tabular-nums">{totalChannels.toLocaleString()}</strong> live channels
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <strong className="font-mono text-slate-900 tabular-nums">{categories.length.toLocaleString()}</strong> categories
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Selected in collection: <strong className="font-mono text-blue-700 tabular-nums">{selectedChannels.length}</strong> / {MAX_SELECTED}
            </span>
          </div>
        )}
      </section>

      {/* Main Channel Picker + Collection Export Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 columns: Category Rail + Channel Table */}
        <section className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          {!hasLoaded ? (
            <div className="p-12 text-center">
              <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto text-slate-500">
                <Tv className="w-5 h-5" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-slate-900">Load your IPTV Live TV catalog</h2>
              <p className="mt-1.5 text-sm text-slate-500 max-w-md mx-auto">
                Click <strong>Load TV channels</strong> above to browse categories, search across all channels,
                and pick the exact channels you want in this Stremio Live TV addon.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-12 min-h-[560px]">
              {/* Categories Sidebar */}
              <div className="md:col-span-4 border-b md:border-b-0 md:border-r border-slate-200 flex flex-col">
                <div className="p-3 border-b border-slate-100">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      placeholder="Filter categories..."
                      className="w-full rounded-md border border-slate-200 bg-slate-50 pl-8 pr-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                <div className="overflow-y-auto max-h-[260px] md:max-h-[520px] divide-y divide-slate-100">
                  <button
                    type="button"
                    onClick={() => fetchChannels({ categoryId: 'all' })}
                    className={`w-full text-left px-3.5 py-2.5 text-xs flex items-center justify-between gap-2 transition-colors ${
                      activeCategoryId === 'all'
                        ? 'bg-blue-50 text-blue-900 font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="truncate">All categories</span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                      {totalChannels.toLocaleString()}
                    </span>
                  </button>

                  {filteredCategories.map((cat) => {
                    const active = activeCategoryId === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => fetchChannels({ categoryId: cat.id })}
                        className={`w-full text-left px-3.5 py-2.5 text-xs flex items-center justify-between gap-2 transition-colors ${
                          active
                            ? 'bg-blue-50 text-blue-900 font-semibold'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="truncate">{cat.name}</span>
                        <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                          {cat.count.toLocaleString()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Channel Selector List */}
              <div className="md:col-span-8 flex flex-col">
                <div className="p-3 border-b border-slate-200 space-y-2.5 bg-slate-50/60">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={channelSearch}
                        onChange={(e) => setChannelSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            fetchChannels({ categoryId: activeCategoryId || 'all', search: channelSearch });
                          }
                        }}
                        placeholder="Search channels (e.g. beIN, ESPN, HBO, Sky)..."
                        className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-8 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                      />
                      {channelSearch && (
                        <button
                          type="button"
                          onClick={() => {
                            setChannelSearch('');
                            fetchChannels({ categoryId: activeCategoryId || 'all', search: '' });
                          }}
                          aria-label="Clear search"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => fetchChannels({ categoryId: activeCategoryId || 'all', search: channelSearch })}
                      disabled={loading}
                      className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      Search
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                    <span>
                      Showing <strong className="font-mono text-slate-900 tabular-nums">{channels.length}</strong> of{' '}
                      <strong className="font-mono text-slate-900 tabular-nums">{matchedCount.toLocaleString()}</strong>
                      {truncated ? ' (refine search to view more)' : ''}
                    </span>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={selectAllVisible}
                        disabled={channels.length === 0 || selectedChannels.length >= MAX_SELECTED}
                        className="font-medium text-blue-600 hover:text-blue-800 disabled:opacity-40 whitespace-nowrap"
                      >
                        Select shown
                      </button>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <button
                        type="button"
                        onClick={deselectAllVisible}
                        disabled={channels.length === 0}
                        className="font-medium text-slate-600 hover:text-slate-900 disabled:opacity-40 whitespace-nowrap"
                      >
                        Deselect shown
                      </button>
                    </div>
                  </div>
                </div>

                <div className="overflow-y-auto max-h-[470px] divide-y divide-slate-100">
                  {loading ? (
                    <div className="py-16 flex items-center justify-center gap-2 text-sm text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading channels...
                    </div>
                  ) : channels.length === 0 ? (
                    <div className="py-16 text-center text-sm text-slate-500">
                      No TV channels matched this category or search query.
                    </div>
                  ) : (
                    channels.map((ch) => {
                      const checked = selectedIdSet.has(ch.id);
                      const disabled = !checked && selectedChannels.length >= MAX_SELECTED;
                      return (
                        <label
                          key={ch.id}
                          className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                            checked ? 'bg-blue-50/50' : 'hover:bg-slate-50'
                          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleChannel(ch)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 shrink-0"
                          />
                          <ChannelLogo src={ch.icon} name={ch.name} />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-900 truncate">{ch.name}</div>
                            <div className="text-xs text-slate-500 truncate">
                              {ch.categoryName} · <span className="font-mono tabular-nums">#{ch.id}</span>
                            </div>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Right 4 columns: Chosen Collection & Install Panel */}
        <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Your TV Collection</h2>
              <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                {selectedChannels.length} / {MAX_SELECTED} channels selected
              </p>
            </div>
            {selectedChannels.length > 0 && (
              <button
                type="button"
                onClick={() => onSelectedChannelsChange([])}
                className="text-xs font-medium text-red-600 hover:text-red-800 whitespace-nowrap"
              >
                Clear all
              </button>
            )}
          </div>

          {selectedChannels.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg px-4">
              Check channels from the list to add them to this separate Stremio Live TV addon.
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {selectedChannels.map((ch, idx) => (
                <div key={ch.id} className="px-3 py-2 flex items-center gap-2 text-xs bg-white hover:bg-slate-50">
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums w-5 text-right shrink-0">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900 truncate">{ch.name}</div>
                    <div className="text-[11px] text-slate-500 truncate">{ch.categoryName}</div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveChannel(idx, -1)}
                      disabled={idx === 0}
                      aria-label={`Move ${ch.name} up`}
                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveChannel(idx, 1)}
                      disabled={idx === selectedChannels.length - 1}
                      aria-label={`Move ${ch.name} down`}
                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeChannel(ch.id)}
                      aria-label={`Remove ${ch.name}`}
                      className="p-1 text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div>
              <label htmlFor="tv-addon-domain" className="block text-xs font-medium text-slate-600">
                Addon Host Domain
              </label>
              <input
                id="tv-addon-domain"
                type="url"
                value={baseDomain}
                onChange={(e) => onBaseDomainChange(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 focus:border-blue-600 focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-600">Live TV Manifest URL</span>
                {isLiveAddonReady && (
                  <button
                    type="button"
                    onClick={handleInspectManifest}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    {loadingManifest ? 'Loading...' : manifestJson ? 'Hide JSON' : 'Inspect JSON'}
                  </button>
                )}
              </div>
              <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800 break-all min-h-[64px]">
                {isLiveAddonReady
                  ? manifestUrl
                  : 'Enter Xtream credentials and select at least 1 TV channel to generate your Live TV addon manifest URL.'}
              </div>
              {isLiveAddonReady && (
                <p className="mt-1 text-[11px] text-slate-500 font-mono tabular-nums">
                  Token length: {encodedPreviewLength.toLocaleString()} chars · Separate addon ID
                </p>
              )}
            </div>

            {manifestJson && (
              <pre className="rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100 overflow-x-auto max-h-56">
                {manifestJson}
              </pre>
            )}

            <div className="flex flex-col gap-2">
              <a
                href={isLiveAddonReady ? stremioUrl : undefined}
                aria-disabled={!isLiveAddonReady}
                onClick={(e) => {
                  if (!isLiveAddonReady) e.preventDefault();
                }}
                className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap ${
                  isLiveAddonReady
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <ExternalLink className="w-4 h-4" />
                Install Live TV Addon
              </a>

              <button
                type="button"
                onClick={handleCopyManifest}
                disabled={!isLiveAddonReady}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied Manifest URL' : 'Copy Manifest URL'}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
