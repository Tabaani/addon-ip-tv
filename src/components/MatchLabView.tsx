import React, { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  CanonicalMeta,
  DEFAULT_MATCH_THRESHOLD,
  scoreCandidate,
} from '../matcher';

interface SampleCandidate {
  id: string;
  name: string;
  tmdb_id: string;
  container: string;
}

interface LabPreset {
  label: string;
  isSeries: boolean;
  meta: {
    imdbId: string;
    tmdbId: string;
    title: string;
    year: string;
    aliases: string;
  };
  candidates: SampleCandidate[];
}

const LAB_PRESETS: LabPreset[] = [
  {
    label: 'Inception (2010)',
    isSeries: false,
    meta: {
      imdbId: 'tt1375666',
      tmdbId: '27205',
      title: 'Inception',
      year: '2010',
      aliases: 'El Origen',
    },
    candidates: [
      { id: '1', name: '|EN| Inception (2010) 4K UHD HEVC', tmdb_id: '27205', container: 'mkv' },
      { id: '2', name: '|AR| INCEPTION [2010] 8K HDR10', tmdb_id: '', container: 'mp4' },
      { id: '3', name: 'FR - Inception (2010) FHD MULTI', tmdb_id: '', container: 'mkv' },
      { id: '4', name: '|EN| El Origen (2010) 1080p', tmdb_id: '', container: 'mp4' },
      { id: '5', name: '|EN| Inception (2022) Documentary HD', tmdb_id: '', container: 'mp4' },
      { id: '6', name: '|EN| Deception (2010) FHD', tmdb_id: '', container: 'mkv' },
    ],
  },
  {
    label: 'Breaking Bad (Series)',
    isSeries: true,
    meta: {
      imdbId: 'tt0903747',
      tmdbId: '1396',
      title: 'Breaking Bad',
      year: '2008',
      aliases: '',
    },
    candidates: [
      { id: '1', name: 'AR - Breaking Bad S01-S05 4K HEVC', tmdb_id: '1396', container: 'mkv' },
      { id: '2', name: '|EN| Breaking Bad (2008) FHD', tmdb_id: '', container: 'mp4' },
      { id: '3', name: '[MULTI] Breaking Bad Season 1 8K DV', tmdb_id: '', container: 'mkv' },
      { id: '4', name: '|EN| El Camino: A Breaking Bad Movie (2019) 4K', tmdb_id: '', container: 'mkv' },
      { id: '5', name: '|EN| Baking Bread (2008) HD', tmdb_id: '', container: 'mp4' },
    ],
  },
  {
    label: 'The Lion King (Remake guard)',
    isSeries: false,
    meta: {
      imdbId: 'tt0110357',
      tmdbId: '8587',
      title: 'The Lion King',
      year: '1994',
      aliases: 'Le Roi Lion',
    },
    candidates: [
      { id: '1', name: '|EN| The Lion King (1994) 4K HDR', tmdb_id: '', container: 'mkv' },
      { id: '2', name: '|FR| Le Roi Lion [1994] FHD', tmdb_id: '', container: 'mkv' },
      { id: '3', name: '|EN| The Lion King (2019) 4K UHD', tmdb_id: '420818', container: 'mkv' },
      { id: '4', name: '|EN| Lion King (1994) 1080p', tmdb_id: '', container: 'mp4' },
    ],
  },
];

export const MatchLabView: React.FC = () => {
  const [isSeries, setIsSeries] = useState(false);
  const [imdbId, setImdbId] = useState(LAB_PRESETS[0].meta.imdbId);
  const [tmdbId, setTmdbId] = useState(LAB_PRESETS[0].meta.tmdbId);
  const [title, setTitle] = useState(LAB_PRESETS[0].meta.title);
  const [year, setYear] = useState(LAB_PRESETS[0].meta.year);
  const [aliases, setAliases] = useState(LAB_PRESETS[0].meta.aliases);
  const [threshold, setThreshold] = useState(DEFAULT_MATCH_THRESHOLD);
  const [candidates, setCandidates] = useState<SampleCandidate[]>(LAB_PRESETS[0].candidates);
  const [newRawTitle, setNewRawTitle] = useState('');
  const [newTmdbId, setNewTmdbId] = useState('');

  const applyPreset = (preset: LabPreset) => {
    setIsSeries(preset.isSeries);
    setImdbId(preset.meta.imdbId);
    setTmdbId(preset.meta.tmdbId);
    setTitle(preset.meta.title);
    setYear(preset.meta.year);
    setAliases(preset.meta.aliases);
    setCandidates(preset.candidates);
  };

  const evaluated = useMemo(() => {
    const parsedYear = Number.parseInt(year, 10);
    const meta: CanonicalMeta = {
      imdbId: imdbId.trim() || 'tt0000000',
      tmdbId: tmdbId.trim() || null,
      title: title.trim(),
      year: Number.isFinite(parsedYear) ? parsedYear : null,
      aliases: aliases
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };

    return candidates
      .map((cand) => ({
        cand,
        diag: scoreCandidate(
          meta,
          {
            name: cand.name,
            tmdb_id: cand.tmdb_id.trim() || null,
          },
          isSeries,
          threshold
        ),
      }))
      .sort((a, b) => {
        if (b.diag.score !== a.diag.score) return b.diag.score - a.diag.score;
        return b.diag.quality.rank - a.diag.quality.rank;
      });
  }, [imdbId, tmdbId, title, year, aliases, candidates, isSeries, threshold]);

  const handleAddCandidate = () => {
    if (!newRawTitle.trim()) return;
    setCandidates((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        name: newRawTitle.trim(),
        tmdb_id: newTmdbId.trim(),
        container: 'mkv',
      },
    ]);
    setNewRawTitle('');
    setNewTmdbId('');
  };

  const removeCandidate = (id: string) => {
    setCandidates((prev) => prev.filter((c) => c.id !== id));
  };

  const matchTypeLabel = (type: string) => {
    switch (type) {
      case 'tmdb_id':
        return 'Exact TMDB ID';
      case 'imdb_id':
        return 'Exact IMDb ID';
      case 'exact_title':
        return 'Exact normalized';
      case 'fuzzy_title':
        return 'Fuzzy pass';
      default:
        return 'Rejected';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            IMDb-to-Xtream Normalization & Match Lab
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Runs the exact <code className="text-slate-800">src/matcher.ts</code> engine live in your browser to inspect
            noisy IPTV title cleanup, TMDB priority matching, year-delta remake protection, and confidence scores.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">Presets:</span>
          {LAB_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyPreset(preset)}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cinemeta Target Configuration */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Target Cinemeta Metadata</h2>
          <div className="flex items-center gap-4 text-xs">
            <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isSeries}
                onChange={(e) => setIsSeries(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              Series mode (strip S01/Season tags)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Threshold:</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">{threshold.toFixed(2)}</span>
              <input
                type="range"
                min={0.65}
                max={0.98}
                step={0.01}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-24 accent-blue-600"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-slate-600">Canonical Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Release Year</label>
            <input
              type="text"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">TMDB ID</label>
            <input
              type="text"
              value={tmdbId}
              onChange={(e) => setTmdbId(e.target.value)}
              placeholder="27205"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Aliases (comma-sep)</label>
            <input
              type="text"
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="El Origen"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* Scoring Matrix Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <label htmlFor="add-raw-title" className="block text-xs font-medium text-slate-600">
              Add noisy IPTV provider title to test
            </label>
            <input
              id="add-raw-title"
              type="text"
              value={newRawTitle}
              onChange={(e) => setNewRawTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddCandidate();
              }}
              placeholder="|UK| Inception (2010) 4K HDR10 HEVC"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <div className="sm:w-36">
            <label htmlFor="add-tmdb-id" className="block text-xs font-medium text-slate-600">
              Item tmdb_id
            </label>
            <input
              id="add-tmdb-id"
              type="text"
              value={newTmdbId}
              onChange={(e) => setNewTmdbId(e.target.value)}
              placeholder="optional"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={handleAddCandidate}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add candidate
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Raw IPTV Provider Title</th>
                <th className="py-3 px-4">Normalized</th>
                <th className="py-3 px-4">Quality</th>
                <th className="py-3 px-4 text-right">Year</th>
                <th className="py-3 px-4 text-right">Dice / Lev / Tok</th>
                <th className="py-3 px-4 text-right">Score</th>
                <th className="py-3 px-4">Verdict</th>
                <th className="py-3 px-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {evaluated.map(({ cand, diag }) => (
                <tr key={cand.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4">
                    <div className="font-mono text-xs text-slate-900">{cand.name}</div>
                    {cand.tmdb_id && (
                      <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                        tmdb_id: {cand.tmdb_id}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-700">
                    {diag.normalizedCandidate || '—'}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                    [{diag.quality.label}]
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-700 whitespace-nowrap">
                    {diag.candidateYear ?? '—'}
                    {diag.yearDelta !== null && diag.yearDelta > 0 && (
                      <span className={diag.yearDelta >= 2 ? 'text-red-600 ml-1' : 'text-slate-400 ml-1'}>
                        (±{diag.yearDelta})
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
                    {diag.dice.toFixed(2)} / {diag.levenshtein.toFixed(2)} / {diag.token.toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-sm font-semibold tabular-nums whitespace-nowrap">
                    <span className={diag.passed ? 'text-emerald-700' : 'text-red-700'}>
                      {diag.score.toFixed(3)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-xs font-medium whitespace-nowrap">
                    <span className={diag.passed ? 'text-emerald-700' : 'text-red-700'}>
                      {matchTypeLabel(diag.matchType)}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => removeCandidate(cand.id)}
                      aria-label={`Remove ${cand.name}`}
                      className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
