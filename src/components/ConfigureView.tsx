import React, { useState } from 'react';
import { Check, Copy, Eye, EyeOff, ExternalLink, Loader2, RotateCcw } from 'lucide-react';
import type { AddonConfig } from '../index';

export interface ConnectionTestResult {
  ok: boolean;
  error?: string;
  normalizedHost?: string;
  account?: {
    status: string;
    activeConnections: number;
    maxConnections: number;
    expiresAt: string | null;
  };
  counts?: {
    movies: number;
    series: number;
    filteredMovies: number;
    filteredSeries: number;
    vodCategories: number;
    seriesCategories: number;
  };
  sampleCategories?: string[];
}

interface ConfigureViewProps {
  config: AddonConfig;
  onChange: (next: AddonConfig) => void;
  onReset: () => void;
  baseDomain: string;
  onBaseDomainChange: (domain: string) => void;
  encodedConfig: string;
  manifestUrl: string;
  stremioUrl: string;
  isConfigValid: boolean;
  onNavigateToTester: () => void;
}

export const ConfigureView: React.FC<ConfigureViewProps> = ({
  config,
  onChange,
  onReset,
  baseDomain,
  onBaseDomainChange,
  manifestUrl,
  stremioUrl,
  isConfigValid,
  onNavigateToTester,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [manifestPreview, setManifestPreview] = useState<string | null>(null);
  const [loadingManifest, setLoadingManifest] = useState(false);

  const updateField = <K extends keyof AddonConfig>(key: K, value: AddonConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const rawText = await response.text();
      let data: ConnectionTestResult;
      try {
        data = JSON.parse(rawText) as ConnectionTestResult;
      } catch {
        data = {
          ok: false,
          error: `Server returned HTTP ${response.status} (non-JSON response). Check deployment function logs.`,
        };
      }
      setTestResult(data);
      if (data.ok && data.normalizedHost && data.normalizedHost !== config.host) {
        onChange({ ...config, host: data.normalizedHost });
      }
    } catch {
      setTestResult({
        ok: false,
        error: 'Network error while reaching /api/test. Verify the server is running.',
      });
    } finally {
      setTesting(false);
    }
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
    if (!isConfigValid) return;
    if (manifestPreview) {
      setManifestPreview(null);
      return;
    }
    setLoadingManifest(true);
    try {
      const urlObj = new URL(manifestUrl);
      const localPath = urlObj.pathname;
      const res = await fetch(localPath);
      const data = await res.json();
      setManifestPreview(JSON.stringify(data, null, 2));
    } catch {
      setManifestPreview('Unable to fetch manifest JSON.');
    } finally {
      setLoadingManifest(false);
    }
  };

  const handleResetAll = () => {
    setTestResult(null);
    setManifestPreview(null);
    onReset();
  };

  const formatExpiry = (iso: string | null) => {
    if (!iso) return 'Unlimited';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? 'Unknown' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-8">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
          Configure your Xtream Codes Stremio addon
        </h1>
        <p className="mt-2 text-base text-slate-600 leading-relaxed">
          Enter your IPTV 8K Xtream Codes credentials to generate a stateless Base64 manifest URL.
          Streams match Cinemeta IMDb pages automatically via TMDB ID priority and normalized fuzzy scoring,
          with full HTTP preservation for edge CDN playback.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 columns: Provider Configuration Form */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
          <div className="pb-5 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900">Provider credentials & filters</h2>
            <p className="mt-1 text-sm text-slate-500">
              Stateless architecture — credentials are encoded only in your personal URL path and never stored in a database.
            </p>
          </div>

          <div className="mt-6 space-y-5">
            <div>
              <label htmlFor="xtream-host" className="block text-sm font-medium text-slate-800">
                Xtream Codes Host URL
              </label>
              <input
                id="xtream-host"
                type="url"
                value={config.host}
                onChange={(e) => updateField('host', e.target.value)}
                placeholder="http://line.example.com:8080"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Trailing slashes are normalized automatically. Exact <code className="text-slate-700">http://</code> or{' '}
                <code className="text-slate-700">https://</code> protocol is preserved on generated stream URLs.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="xtream-user" className="block text-sm font-medium text-slate-800">
                  Xtream Username
                </label>
                <input
                  id="xtream-user"
                  type="text"
                  autoComplete="off"
                  value={config.username}
                  onChange={(e) => updateField('username', e.target.value)}
                  placeholder="subscriber_user"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                />
              </div>

              <div>
                <label htmlFor="xtream-pass" className="block text-sm font-medium text-slate-800">
                  Xtream Password
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="xtream-pass"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="off"
                    value={config.password}
                    onChange={(e) => updateField('password', e.target.value)}
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

            <div>
              <label htmlFor="tmdb-key" className="block text-sm font-medium text-slate-800">
                TMDB API Key <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                id="tmdb-key"
                type="text"
                autoComplete="off"
                value={config.tmdbKey ?? ''}
                onChange={(e) => updateField('tmdbKey', e.target.value)}
                placeholder="Optional TMDB v3 API key for fallback metadata & TMDB ID lookup"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="include-kw" className="block text-sm font-medium text-slate-800">
                  Include keywords <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  id="include-kw"
                  type="text"
                  value={config.includeKeywords ?? ''}
                  onChange={(e) => updateField('includeKeywords', e.target.value)}
                  placeholder="e.g. EN, 4K, 8K, UK"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                />
                <p className="mt-1 text-xs text-slate-500">Comma-separated category or title matches.</p>
              </div>

              <div>
                <label htmlFor="exclude-kw" className="block text-sm font-medium text-slate-800">
                  Exclude keywords <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  id="exclude-kw"
                  type="text"
                  value={config.excludeKeywords ?? ''}
                  onChange={(e) => updateField('excludeKeywords', e.target.value)}
                  placeholder="e.g. XXX, 24/7, ADULT"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                />
                <p className="mt-1 text-xs text-slate-500">Hide adult, 24/7, or unwanted packs.</p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing || !isConfigValid}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
              >
                {testing && <Loader2 className="w-4 h-4 animate-spin" />}
                {testing ? 'Testing connection...' : 'Test connection'}
              </button>

              <button
                type="button"
                onClick={handleResetAll}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>

              {isConfigValid && (
                <button
                  type="button"
                  onClick={onNavigateToTester}
                  className="ml-auto text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors whitespace-nowrap shrink-0"
                >
                  Open in Stream Tester →
                </button>
              )}
            </div>

            {testResult && (
              <div
                role="status"
                className={`rounded-lg border p-4 text-sm ${
                  testResult.ok
                    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-950'
                    : 'border-red-200 bg-red-50/70 text-red-900'
                }`}
              >
                {!testResult.ok ? (
                  <div>
                    <div className="font-semibold text-red-800">Connection check failed</div>
                    <p className="mt-1 text-red-700">{testResult.error}</p>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-semibold text-emerald-900">
                        Authenticated via Xtream player_api.php
                      </span>
                      <span className="text-xs font-mono text-emerald-800">
                        Account: {testResult.account?.status ?? 'Active'} · Exp: {formatExpiry(testResult.account?.expiresAt ?? null)}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-emerald-200/70">
                      <div>
                        <div className="text-xs text-emerald-800/80">VOD Movies</div>
                        <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-slate-900">
                          {(testResult.counts?.movies ?? 0).toLocaleString()}
                        </div>
                        {testResult.counts && testResult.counts.filteredMovies !== testResult.counts.movies && (
                          <div className="text-xs text-slate-600 tabular-nums">
                            {testResult.counts.filteredMovies.toLocaleString()} after filter
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs text-emerald-800/80">TV Series</div>
                        <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-slate-900">
                          {(testResult.counts?.series ?? 0).toLocaleString()}
                        </div>
                        {testResult.counts && testResult.counts.filteredSeries !== testResult.counts.series && (
                          <div className="text-xs text-slate-600 tabular-nums">
                            {testResult.counts.filteredSeries.toLocaleString()} after filter
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs text-emerald-800/80">Categories</div>
                        <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-slate-900">
                          {((testResult.counts?.vodCategories ?? 0) + (testResult.counts?.seriesCategories ?? 0)).toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-emerald-800/80">Connections</div>
                        <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-slate-900">
                          {testResult.account?.activeConnections ?? 0} / {testResult.account?.maxConnections ?? 1}
                        </div>
                      </div>
                    </div>

                    {testResult.sampleCategories && testResult.sampleCategories.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-emerald-200/70 text-xs text-emerald-900/90">
                        <span className="font-medium">Sample VOD categories: </span>
                        {testResult.sampleCategories.join(' · ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Right 5 columns: Generated Manifest & Install */}
        <aside className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="pb-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900">Install in Stremio</h2>
            <p className="mt-1 text-sm text-slate-500">
              Use this running server immediately or switch the base URL to your deployed Cloudflare Worker domain.
            </p>
          </div>

          <div>
            <label htmlFor="worker-domain" className="block text-xs font-medium text-slate-600">
              Addon Host Domain
            </label>
            <input
              id="worker-domain"
              type="url"
              value={baseDomain}
              onChange={(e) => onBaseDomainChange(e.target.value)}
              placeholder="https://xtream-stremio-addon.yourname.workers.dev"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600">Generated Manifest URL</span>
              {isConfigValid && (
                <button
                  type="button"
                  onClick={handleInspectManifest}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  {loadingManifest ? 'Loading...' : manifestPreview ? 'Hide JSON' : 'Inspect JSON'}
                </button>
              )}
            </div>
            <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800 break-all min-h-[76px]">
              {isConfigValid
                ? manifestUrl
                : 'Enter a valid http:// or https:// Xtream host, username, and password to generate your Base64 manifest URL.'}
            </div>
          </div>

          {manifestPreview && (
            <pre className="rounded-lg border border-slate-200 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100 overflow-x-auto max-h-64">
              {manifestPreview}
            </pre>
          )}

          <div className="flex flex-col gap-2.5">
            <a
              href={isConfigValid ? stremioUrl : undefined}
              aria-disabled={!isConfigValid}
              onClick={(e) => {
                if (!isConfigValid) e.preventDefault();
              }}
              className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap ${
                isConfigValid
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              <ExternalLink className="w-4 h-4" />
              Install in Stremio
            </a>

            <button
              type="button"
              onClick={handleCopyManifest}
              disabled={!isConfigValid}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied Manifest URL' : 'Copy Manifest URL'}
            </button>
          </div>

          <div className="pt-4 border-t border-slate-100 space-y-3">
            <h3 className="text-xs font-semibold text-slate-700">Protocol guarantees</h3>
            <ul className="space-y-2 text-xs text-slate-600">
              <li className="flex items-start justify-between gap-3">
                <span>Cinemeta prefix binding</span>
                <span className="font-mono text-slate-800">idPrefixes: [&quot;tt&quot;]</span>
              </li>
              <li className="flex items-start justify-between gap-3">
                <span>Upstream User-Agent</span>
                <span className="font-mono text-slate-800">VLC/3.0.20</span>
              </li>
              <li className="flex items-start justify-between gap-3">
                <span>Edge Cache TTL</span>
                <span className="font-mono text-slate-800 tabular-nums">6h XC · 24h Meta</span>
              </li>
              <li className="flex items-start justify-between gap-3">
                <span>Native player hint</span>
                <span className="font-mono text-slate-800">notWebReady: true</span>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
};
