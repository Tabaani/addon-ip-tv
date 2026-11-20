import { useMemo, useState } from 'react';
import { ConfigureView } from './components/ConfigureView';
import { DeployWorkerView } from './components/DeployWorkerView';
import { MatchLabView } from './components/MatchLabView';
import { StreamTesterView } from './components/StreamTesterView';
import { AddonConfig, encodeConfig, validateAndNormalizeHost } from './index';

type ActiveTab = 'configure' | 'tester' | 'lab' | 'deploy';

const INITIAL_CONFIG: AddonConfig = {
  host: '',
  username: '',
  password: '',
  tmdbKey: '',
  includeKeywords: '',
  excludeKeywords: 'XXX, 24/7, ADULT',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('configure');
  const [config, setConfig] = useState<AddonConfig>(INITIAL_CONFIG);
  const [baseDomain, setBaseDomain] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.origin : ''
  );

  const { isConfigValid, encodedConfig, manifestUrl, stremioUrl } = useMemo(() => {
    const hostCheck = validateAndNormalizeHost(config.host);
    const hasCreds = config.username.trim().length > 0 && config.password.trim().length > 0;
    const valid = hostCheck.ok && hasCreds;
    if (!valid) {
      return {
        isConfigValid: false,
        encodedConfig: '',
        manifestUrl: '',
        stremioUrl: '',
      };
    }

    const encoded = encodeConfig({
      ...config,
      host: hostCheck.host,
    });
    const rawOrigin = (baseDomain || window.location.origin).trim().replace(/\/+$/, '');
    const safeOrigin = /^https?:\/\/[^/\s]+/i.test(rawOrigin) ? rawOrigin : window.location.origin;
    const manifest = `${safeOrigin}/${encoded}/manifest.json`;
    const stremio = `stremio://${manifest.replace(/^https?:\/\//i, '')}`;

    return {
      isConfigValid: true,
      encodedConfig: encoded,
      manifestUrl: manifest,
      stremioUrl: stremio,
    };
  }, [config, baseDomain]);

  const handlePrimaryInstall = () => {
    if (isConfigValid && stremioUrl) {
      window.location.href = stremioUrl;
    } else {
      setActiveTab('configure');
      const hostInput = document.getElementById('xtream-host');
      if (hostInput) hostInput.focus();
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('configure');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            XtreamBridge
          </a>

          <nav className="flex items-center gap-6 overflow-x-auto text-sm font-medium">
            {(
              [
                ['configure', 'Configure'],
                ['tester', 'Stream Tester'],
                ['lab', 'Match Lab'],
                ['deploy', 'Deploy Worker'],
              ] as Array<[ActiveTab, string]>
            ).map(([tabId, label]) => {
              const active = activeTab === tabId;
              return (
                <button
                  key={tabId}
                  type="button"
                  onClick={() => setActiveTab(tabId)}
                  className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                    active
                      ? 'border-blue-600 text-slate-900'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handlePrimaryInstall}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
            >
              Install in Stremio
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
        {activeTab === 'configure' && (
          <ConfigureView
            config={config}
            onChange={setConfig}
            onReset={() => setConfig(INITIAL_CONFIG)}
            baseDomain={baseDomain}
            onBaseDomainChange={setBaseDomain}
            encodedConfig={encodedConfig}
            manifestUrl={manifestUrl}
            stremioUrl={stremioUrl}
            isConfigValid={isConfigValid}
            onNavigateToTester={() => setActiveTab('tester')}
          />
        )}

        {activeTab === 'tester' && (
          <StreamTesterView
            encodedConfig={encodedConfig}
            isConfigValid={isConfigValid}
            onGoConfigure={() => setActiveTab('configure')}
          />
        )}

        {activeTab === 'lab' && <MatchLabView />}

        {activeTab === 'deploy' && <DeployWorkerView />}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <span>XtreamBridge · Stateless Stremio Addon for Xtream Codes IPTV</span>
          <div className="flex items-center gap-4">
            <a href="/manifest.json" target="_blank" rel="noreferrer" className="hover:text-slate-800">
              Root Manifest
            </a>
            <span aria-hidden="true">·</span>
            <a href="/worker-ui" target="_blank" rel="noreferrer" className="hover:text-slate-800">
              Standalone Worker UI
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
