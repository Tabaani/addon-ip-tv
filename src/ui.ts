/**
 * Standalone, zero-dependency HTML configuration portal served directly by
 * Cloudflare Workers on GET / and GET /configure.
 */

export function renderConfigHtml(origin: string): string {
  const safeOrigin = origin.replace(/[<>"'`]/g, '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>XtreamBridge — Stremio Xtream Codes Addon</title>
  <style>
    :root {
      --bg: #f8fafc;
      --surface: #ffffff;
      --surface-alt: #f1f5f9;
      --border: #e2e8f0;
      --border-strong: #cbd5e1;
      --text: #0f172a;
      --muted: #475569;
      --subtle: #64748b;
      --accent: #2563eb;
      --accent-hover: #1d4ed8;
      --ok: #15803d;
      --ok-bg: #f0fdf4;
      --ok-border: #bbf7d0;
      --err: #b91c1c;
      --err-bg: #fef2f2;
      --err-border: #fecaca;
      --radius: 10px;
      --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--sans);
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
    }
    .header-inner {
      max-width: 1120px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }
    .brand {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text);
      text-decoration: none;
      white-space: nowrap;
    }
    .header-meta {
      font-size: 13px;
      color: var(--subtle);
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 36px 24px 64px;
    }
    .intro {
      margin-bottom: 28px;
    }
    .intro h1 {
      margin: 0 0 8px;
      font-size: clamp(1.75rem, 3vw, 2.25rem);
      font-weight: 700;
      letter-spacing: -0.025em;
      line-height: 1.15;
    }
    .intro p {
      margin: 0;
      max-width: 68ch;
      color: var(--muted);
      font-size: 15px;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      gap: 24px;
      align-items: start;
    }
    @media (max-width: 860px) {
      .grid { grid-template-columns: 1fr; }
    }
    .panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
    }
    .panel-title {
      margin: 0 0 4px;
      font-size: 16px;
      font-weight: 600;
    }
    .panel-desc {
      margin: 0 0 20px;
      font-size: 13px;
      color: var(--subtle);
    }
    .field {
      margin-bottom: 16px;
    }
    .field-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    @media (max-width: 560px) {
      .field-row { grid-template-columns: 1fr; }
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 6px;
      color: var(--text);
    }
    .hint {
      display: block;
      font-size: 12px;
      color: var(--subtle);
      margin-top: 4px;
    }
    input {
      width: 100%;
      padding: 10px 12px;
      font-size: 14px;
      font-family: inherit;
      color: var(--text);
      background: var(--surface);
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      transition: border-color 140ms ease, box-shadow 140ms ease;
    }
    input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
    }
    input.mono {
      font-family: var(--mono);
      font-size: 13px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 20px;
      padding-top: 18px;
      border-top: 1px solid var(--border);
    }
    button, .btn-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 18px;
      min-height: 42px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      text-decoration: none;
      white-space: nowrap;
      border: 1px solid transparent;
      transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
    }
    .btn-primary {
      background: var(--accent);
      color: #ffffff;
    }
    .btn-primary:hover:not(:disabled) {
      background: var(--accent-hover);
    }
    .btn-secondary {
      background: var(--surface);
      color: var(--text);
      border-color: var(--border-strong);
    }
    .btn-secondary:hover:not(:disabled) {
      background: var(--surface-alt);
    }
    button:disabled, .btn-link[aria-disabled="true"] {
      opacity: 0.45;
      pointer-events: none;
      cursor: not-allowed;
    }
    .status-box {
      margin-top: 18px;
      padding: 14px 16px;
      border-radius: 8px;
      font-size: 13px;
      display: none;
    }
    .status-box.ok {
      display: block;
      background: var(--ok-bg);
      border: 1px solid var(--ok-border);
      color: var(--ok);
    }
    .status-box.err {
      display: block;
      background: var(--err-bg);
      border: 1px solid var(--err-border);
      color: var(--err);
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--ok-border);
    }
    .metric-label {
      font-size: 11px;
      color: var(--muted);
    }
    .metric-value {
      font-family: var(--mono);
      font-variant-numeric: tabular-nums;
      font-size: 16px;
      font-weight: 700;
      color: var(--text);
    }
    .url-box {
      font-family: var(--mono);
      font-size: 12px;
      line-height: 1.5;
      word-break: break-all;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      color: var(--text);
      min-height: 68px;
    }
    .install-stack {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 16px;
    }
    .install-stack button,
    .install-stack .btn-link {
      width: 100%;
    }
    .endpoints {
      margin-top: 22px;
      padding-top: 18px;
      border-top: 1px solid var(--border);
    }
    .endpoints h3 {
      margin: 0 0 10px;
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
    }
    .ep-list {
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: 12px;
      font-family: var(--mono);
      color: var(--subtle);
    }
    .ep-list li {
      padding: 5px 0;
      border-bottom: 1px solid var(--border);
    }
    .ep-list li:last-child { border-bottom: none; }
  </style>
</head>
<body>
  <header>
    <div class="header-inner">
      <a class="brand" href="/">XtreamBridge</a>
      <span class="header-meta">Stateless Stremio Xtream Codes Edge Addon</span>
    </div>
  </header>

  <main>
    <section class="intro">
      <h1>Connect Xtream Codes IPTV to Stremio</h1>
      <p>Encode your Xtream Codes credentials into a stateless Base64 manifest URL. Streams appear directly on Stremio Cinemeta movie and series pages via TMDB ID and normalized title matching, alongside searchable VOD catalogs.</p>
    </section>

    <div class="grid">
      <section class="panel">
        <h2 class="panel-title">Provider Configuration</h2>
        <p class="panel-desc">Credentials are encoded only inside your personal manifest URL and are never persisted on any server or database.</p>

        <form id="configForm" autocomplete="off">
          <div class="field">
            <label for="host">Xtream Codes Host URL</label>
            <input id="host" class="mono" type="url" placeholder="http://provider.example.com:8080" required />
            <span class="hint">Trailing slashes are removed automatically. Exact http:// or https:// scheme is preserved for CDN playback compatibility.</span>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="username">Xtream Username</label>
              <input id="username" class="mono" type="text" placeholder="username" required />
            </div>
            <div class="field">
              <label for="password">Xtream Password</label>
              <input id="password" class="mono" type="password" placeholder="password" required />
            </div>
          </div>

          <div class="field">
            <label for="tmdbKey">TMDB API Key (Optional)</label>
            <input id="tmdbKey" class="mono" type="text" placeholder="Optional v3 API key for metadata fallback" />
            <span class="hint">Used as a fallback when Cinemeta metadata is unavailable or lacks a TMDB ID.</span>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="includeKeywords">Include Keywords (Optional)</label>
              <input id="includeKeywords" type="text" placeholder="e.g. EN, 4K, 8K" />
              <span class="hint">Comma-separated category or title keywords to include.</span>
            </div>
            <div class="field">
              <label for="excludeKeywords">Exclude Keywords (Optional)</label>
              <input id="excludeKeywords" type="text" value="XXX, 24/7, ADULT" placeholder="e.g. XXX, 24/7" />
              <span class="hint">Comma-separated category or title keywords to hide.</span>
            </div>
          </div>

          <div class="actions">
            <button type="button" id="testBtn" class="btn-secondary">Test Connection</button>
            <button type="reset" id="resetBtn" class="btn-secondary">Reset</button>
          </div>
        </form>

        <div id="statusBox" class="status-box" role="status" aria-live="polite">
          <div id="statusMessage"></div>
          <div id="metricsGrid" class="metrics" style="display:none;">
            <div>
              <div class="metric-label">Status</div>
              <div class="metric-value" id="mStatus">-</div>
            </div>
            <div>
              <div class="metric-label">VOD Movies</div>
              <div class="metric-value" id="mMovies">0</div>
            </div>
            <div>
              <div class="metric-label">TV Series</div>
              <div class="metric-value" id="mSeries">0</div>
            </div>
          </div>
        </div>
      </section>

      <aside class="panel">
        <h2 class="panel-title">Install in Stremio</h2>
        <p class="panel-desc">Enter your host, username, and password to generate your personal manifest link.</p>

        <label for="manifestPreview">Manifest URL</label>
        <div id="manifestPreview" class="url-box">Enter Xtream host, username, and password to build your manifest URL.</div>

        <div class="install-stack">
          <a id="installBtn" class="btn-link btn-primary" href="#" aria-disabled="true">Install in Stremio</a>
          <button id="copyBtn" type="button" class="btn-secondary" disabled>Copy Manifest URL</button>
        </div>

        <div class="endpoints">
          <h3>Active Stremio Endpoints</h3>
          <ul class="ep-list">
            <li>GET /:config/manifest.json</li>
            <li>GET /:config/catalog/movie/iptv-movies.json</li>
            <li>GET /:config/catalog/series/iptv-series.json</li>
            <li>GET /:config/stream/:type/:imdbId.json</li>
          </ul>
        </div>
      </aside>
    </div>
  </main>

  <script>
    (function () {
      const ORIGIN = ${JSON.stringify(safeOrigin).replace(/</g, '\\u003c')} || window.location.origin;
      const hostEl = document.getElementById('host');
      const userEl = document.getElementById('username');
      const passEl = document.getElementById('password');
      const tmdbEl = document.getElementById('tmdbKey');
      const incEl = document.getElementById('includeKeywords');
      const excEl = document.getElementById('excludeKeywords');
      const previewEl = document.getElementById('manifestPreview');
      const installBtn = document.getElementById('installBtn');
      const copyBtn = document.getElementById('copyBtn');
      const testBtn = document.getElementById('testBtn');
      const formEl = document.getElementById('configForm');
      const statusBox = document.getElementById('statusBox');
      const statusMsg = document.getElementById('statusMessage');
      const metricsGrid = document.getElementById('metricsGrid');
      const mStatus = document.getElementById('mStatus');
      const mMovies = document.getElementById('mMovies');
      const mSeries = document.getElementById('mSeries');

      let currentManifestUrl = '';

      function normalizeHost(raw) {
        return raw.trim().replace(/\\/+$/, '');
      }

      function encodeBase64Url(obj) {
        const json = JSON.stringify(obj);
        const bytes = new TextEncoder().encode(json);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
      }

      function getConfigPayload() {
        const host = normalizeHost(hostEl.value);
        const username = userEl.value.trim();
        const password = passEl.value.trim();
        const tmdbKey = tmdbEl.value.trim();
        const includeKeywords = incEl.value.trim();
        const excludeKeywords = excEl.value.trim();
        const cfg = { host, username, password };
        if (tmdbKey) cfg.tmdbKey = tmdbKey;
        if (includeKeywords) cfg.includeKeywords = includeKeywords;
        if (excludeKeywords) cfg.excludeKeywords = excludeKeywords;
        return cfg;
      }

      function updateUrls() {
        const cfg = getConfigPayload();
        const validScheme = /^https?:\\/\\//i.test(cfg.host);
        if (!validScheme || !cfg.username || !cfg.password) {
          currentManifestUrl = '';
          previewEl.textContent = 'Enter a valid http:// or https:// Xtream host, username, and password to build your manifest URL.';
          installBtn.setAttribute('aria-disabled', 'true');
          installBtn.setAttribute('href', '#');
          copyBtn.disabled = true;
          return;
        }
        const encoded = encodeBase64Url(cfg);
        const manifestUrl = ORIGIN.replace(/\\/+$/, '') + '/' + encoded + '/manifest.json';
        const stremioUrl = 'stremio://' + manifestUrl.replace(/^https?:\\/\\//i, '');
        currentManifestUrl = manifestUrl;
        previewEl.textContent = manifestUrl;
        installBtn.setAttribute('href', stremioUrl);
        installBtn.setAttribute('aria-disabled', 'false');
        copyBtn.disabled = false;
      }

      [hostEl, userEl, passEl, tmdbEl, incEl, excEl].forEach(function (el) {
        el.addEventListener('input', updateUrls);
      });

      formEl.addEventListener('reset', function () {
        setTimeout(function () {
          statusBox.className = 'status-box';
          metricsGrid.style.display = 'none';
          updateUrls();
        }, 0);
      });

      copyBtn.addEventListener('click', async function () {
        if (!currentManifestUrl) return;
        try {
          await navigator.clipboard.writeText(currentManifestUrl);
          copyBtn.textContent = 'Copied Manifest URL';
          setTimeout(function () { copyBtn.textContent = 'Copy Manifest URL'; }, 1800);
        } catch (_err) {
          copyBtn.textContent = 'Copy failed';
          setTimeout(function () { copyBtn.textContent = 'Copy Manifest URL'; }, 1800);
        }
      });

      testBtn.addEventListener('click', async function () {
        const cfg = getConfigPayload();
        if (!/^https?:\\/\\//i.test(cfg.host) || !cfg.username || !cfg.password) {
          statusBox.className = 'status-box err';
          statusMsg.textContent = 'Please provide a valid http:// or https:// host URL, username, and password.';
          metricsGrid.style.display = 'none';
          return;
        }

        testBtn.disabled = true;
        testBtn.textContent = 'Testing...';
        statusBox.className = 'status-box';
        metricsGrid.style.display = 'none';

        try {
          const res = await fetch('/api/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cfg)
          });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            statusBox.className = 'status-box err';
            statusMsg.textContent = data.error || 'Connection test failed.';
            metricsGrid.style.display = 'none';
          } else {
            statusBox.className = 'status-box ok';
            statusMsg.textContent = 'Connected to Xtream Codes server successfully.';
            mStatus.textContent = data.account && data.account.status ? String(data.account.status) : 'Active';
            mMovies.textContent = String(data.counts ? data.counts.movies : 0);
            mSeries.textContent = String(data.counts ? data.counts.series : 0);
            metricsGrid.style.display = 'grid';
          }
        } catch (err) {
          statusBox.className = 'status-box err';
          statusMsg.textContent = 'Network error while testing Xtream connection.';
          metricsGrid.style.display = 'none';
        } finally {
          testBtn.disabled = false;
          testBtn.textContent = 'Test Connection';
        }
      });

      updateUrls();
    })();
  </script>
</body>
</html>`;
}
