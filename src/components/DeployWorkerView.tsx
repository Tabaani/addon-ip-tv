import React, { useEffect, useState } from 'react';
import { Check, Copy, Download, ExternalLink, FileCode2, Loader2 } from 'lucide-react';

interface WorkerSourceFile {
  filename: string;
  language: string;
  description: string;
  content: string;
  lines: number;
}

export const DeployWorkerView: React.FC = () => {
  const [files, setFiles] = useState<WorkerSourceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilename, setActiveFilename] = useState('wrangler.toml');
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch('/api/worker-source')
      .then((res) => res.json())
      .then((data: { ok?: boolean; files?: WorkerSourceFile[]; error?: string }) => {
        if (!mounted) return;
        if (!data.ok || !Array.isArray(data.files)) {
          setError(data.error || 'Could not load worker source files.');
        } else {
          setFiles(data.files);
          if (data.files.length > 0) {
            setActiveFilename(data.files[0].filename);
          }
        }
      })
      .catch(() => {
        if (mounted) setError('Network error while loading worker source files.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const activeFile = files.find((f) => f.filename === activeFilename) ?? files[0];

  const handleCopy = async (file: WorkerSourceFile) => {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopiedFile(file.filename);
      setTimeout(() => setCopiedFile(null), 1600);
    } catch {
      setCopiedFile(null);
    }
  };

  const handleDownload = (file: WorkerSourceFile) => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename.split('/').pop() || file.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Cloudflare Workers Edge Bundle
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Complete, zero-dependency TypeScript project ready for <code className="text-slate-800">wrangler deploy</code>.
            Every file below is read directly from the active codebase.
          </p>
        </div>

        <a
          href="/worker-ui"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap self-start"
        >
          <ExternalLink className="w-4 h-4" />
          Preview Worker HTML UI
        </a>
      </div>

      {/* 3-Step Deploy Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white border border-slate-200 rounded-xl p-5">
        <div>
          <div className="text-xs font-semibold text-slate-500">01. Create project directory</div>
          <code className="mt-1.5 block rounded-md bg-slate-950 px-3 py-2 text-xs text-slate-100 overflow-x-auto">
            mkdir xtream-addon && cd xtream-addon
          </code>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-500">02. Save files & install Wrangler</div>
          <code className="mt-1.5 block rounded-md bg-slate-950 px-3 py-2 text-xs text-slate-100 overflow-x-auto">
            npm install
          </code>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-500">03. Deploy to Cloudflare Edge</div>
          <code className="mt-1.5 block rounded-md bg-slate-950 px-3 py-2 text-xs text-slate-100 overflow-x-auto">
            npx wrangler deploy
          </code>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 flex items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading Worker source files...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{error}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* File Explorer Rail */}
          <nav className="lg:col-span-3 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
            {files.map((file) => {
              const isActive = activeFile?.filename === file.filename;
              return (
                <button
                  key={file.filename}
                  type="button"
                  onClick={() => setActiveFilename(file.filename)}
                  className={`w-full text-left px-4 py-3.5 transition-colors flex items-start justify-between gap-2 ${
                    isActive ? 'bg-blue-50/70 text-blue-950' : 'bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-mono text-xs font-semibold">
                      <FileCode2 className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                      <span className="truncate">{file.filename}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 line-clamp-2">{file.description}</p>
                  </div>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                    {file.lines}L
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Source Code Viewer */}
          {activeFile && (
            <section className="lg:col-span-9 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-900/80">
                <div>
                  <div className="font-mono text-xs font-semibold text-slate-100">{activeFile.filename}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{activeFile.description}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(activeFile)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 whitespace-nowrap"
                  >
                    {copiedFile === activeFile.filename ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copiedFile === activeFile.filename ? 'Copied' : 'Copy file'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownload(activeFile)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </button>
                </div>
              </div>

              <pre className="p-4 text-xs leading-relaxed font-mono text-slate-200 overflow-x-auto max-h-[640px]">
                <code>{activeFile.content}</code>
              </pre>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
