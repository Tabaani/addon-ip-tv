/**
 * Title normalization, TMDB/IMDb exact matching, fuzzy similarity scoring
 * (Dice + Levenshtein + Token Jaccard), quality badge extraction, and
 * category/keyword filtering for Xtream Codes IPTV catalogs.
 */

export interface XtreamCategory {
  category_id: string | number;
  category_name: string;
  parent_id?: number;
}

export interface XtreamVodItem {
  num?: number;
  name: string;
  stream_type?: string;
  stream_id: number | string;
  stream_icon?: string;
  rating?: string | number;
  rating_5based?: number;
  added?: string;
  category_id?: string | number;
  category_ids?: Array<string | number>;
  container_extension?: string;
  custom_sid?: string;
  direct_source?: string;
  tmdb?: string | number | null;
  tmdb_id?: string | number | null;
  imdb_id?: string | null;
  year?: string | number | null;
  releaseDate?: string | null;
}

export interface XtreamSeriesItem {
  num?: number;
  name: string;
  series_id: number | string;
  cover?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  releaseDate?: string | null;
  release_date?: string | null;
  last_modified?: string;
  rating?: string | number;
  rating_5based?: number;
  category_id?: string | number;
  category_ids?: Array<string | number>;
  tmdb?: string | number | null;
  tmdb_id?: string | number | null;
  imdb_id?: string | null;
  year?: string | number | null;
}

export type XtreamCandidateInput = {
  name: string;
  category_id?: string | number;
  tmdb?: string | number | null;
  tmdb_id?: string | number | null;
  imdb_id?: string | null;
  year?: string | number | null;
  releaseDate?: string | null;
  release_date?: string | null;
};

export interface CanonicalMeta {
  imdbId: string;
  tmdbId?: string | null;
  title: string;
  year: number | null;
  aliases: string[];
}

export interface QualityInfo {
  label: string;
  rank: number;
  tags: string[];
}

export type MatchType = 'tmdb_id' | 'imdb_id' | 'exact_title' | 'fuzzy_title' | 'rejected';

export interface MatchDiagnostics {
  rawTitle: string;
  normalizedCandidate: string;
  matchedAgainst: string;
  candidateYear: number | null;
  yearDelta: number | null;
  dice: number;
  levenshtein: number;
  token: number;
  score: number;
  matchType: MatchType;
  quality: QualityInfo;
  languageTag: string | null;
  passed: boolean;
}

export interface MatchResult<T> {
  item: T;
  diagnostics: MatchDiagnostics;
}

export const DEFAULT_MATCH_THRESHOLD = 0.85;

// Common quality, codec, audio, and release tags stripped before comparison
const NOISE_TOKENS = new Set([
  '8k', '4k', 'uhd', 'fhd', 'hd', 'sd', 'hq', 'cam', 'hdcam', 'ts', 'hdts',
  '2160p', '4320p', '1080p', '1080i', '720p', '576p', '480p', '360p',
  'hevc', 'h265', 'x265', 'h264', 'x264', 'avc', 'av1', 'vp9', 'mpeg', 'divx', 'xvid',
  'hdr', 'hdr10', 'hdr10plus', 'dv', 'dolby', 'vision', 'atmos', 'dts', 'dtshd',
  'truehd', 'ac3', 'eac3', 'aac', 'ddp', 'dd5', '51', '71', '10bit', '8bit',
  'bluray', 'bdrip', 'brrip', 'webrip', 'webdl', 'web', 'remux', 'dvdrip', 'hdtv',
  'multi', 'dual', 'dub', 'dubbed', 'sub', 'subbed', 'subtitles', 'vostfr',
  'vf', 'vff', 'vfq', 'truefrench', 'french', 'english', 'arabic', 'spanish',
  'german', 'italian', 'turkish', 'hindi', 'portuguese', 'latino', 'castellano',
  'extended', 'unrated', 'remastered', 'imax', 'proper', 'repack', 'internal',
  'complete', 'vod', 'iptv', 'raw', 'vip', 'top', 'new', 'hot', 'cinema',
  '3d', 'sbs', 'hsbs', 'ou', 'nf', 'amzn', 'dsnp', 'hmax', 'atvp'
]);

// Leading language / country codes commonly prefixed by IPTV providers
const LEADING_REGION_PREFIX_RE =
  /^\s*(?:(?:\|[^|]{1,24}\|\s*)|(?:\[[^\]]{1,24}\]\s*)|(?:\([A-Z]{2,8}(?:[\s/-][A-Z0-9]{1,6})?\)\s*)|(?:【[^】]{1,24}】\s*)|(?:[A-Z]{2,6}\s*[-:|/]\s+))+/i;

const TRAILING_BRACKET_META_RE =
  /\s*(?:\[(?:[^\]\d]*|\d{3,4}p|4k|8k|uhd|fhd|hd|hevc|multi|sub|dub|en|ar|fr|es|de|uk|us|tr|it|pt|nl)[^\]]*\]|\((?:4k|8k|uhd|fhd|hd|hevc|multi|sub|dub|en|ar|fr|es|de|uk|us|tr|it|pt|nl|extended|unrated|imax|remastered|cam|ts)\))+/gi;

/**
 * Extract leading provider country/language indicator (e.g., "|EN|", "AR -", "[MULTI]")
 */
export function extractLanguageTag(raw: string): string | null {
  const pipeMatch = raw.match(/^\s*\|\s*([A-Za-z0-9\s/-]{2,12})\s*\|/);
  if (pipeMatch) return pipeMatch[1].trim().toUpperCase();

  const bracketMatch = raw.match(/^\s*\[\s*([A-Za-z]{2,8})\s*\]/);
  if (bracketMatch) return bracketMatch[1].trim().toUpperCase();

  const dashMatch = raw.match(/^\s*([A-Z]{2,5})\s*[-:|]\s+/);
  if (dashMatch) return dashMatch[1].trim().toUpperCase();

  return null;
}

/**
 * Extract video quality badge and ranking weight from a raw Xtream title
 */
export function extractQualityLabel(raw: string): QualityInfo {
  const upper = raw.toUpperCase();
  const tags: string[] = [];
  let baseLabel = 'VOD';
  let rank = 10;

  if (/\b(8K|4320P)\b/.test(upper)) {
    baseLabel = '8K';
    rank = 100;
    tags.push('8K');
  } else if (/\b(4K|2160P|UHD)\b/.test(upper)) {
    baseLabel = '4K';
    rank = 85;
    tags.push('4K');
  } else if (/\b(FHD|1080P|1080I|BLURAY|BLU-RAY|REMUX)\b/.test(upper)) {
    baseLabel = 'FHD';
    rank = 65;
    tags.push('FHD');
  } else if (/\b(HD|720P|WEBRIP|WEB-DL)\b/.test(upper)) {
    baseLabel = 'HD';
    rank = 45;
    tags.push('HD');
  } else if (/\b(SD|480P|576P|DVDRIP)\b/.test(upper)) {
    baseLabel = 'SD';
    rank = 25;
    tags.push('SD');
  } else if (/\b(CAM|HDCAM|TS|HDTS)\b/.test(upper)) {
    baseLabel = 'CAM';
    rank = 5;
    tags.push('CAM');
  }

  if (/\b(HDR10\+|HDR10|HDR)\b/.test(upper)) {
    tags.push('HDR');
    rank += 4;
  }
  if (/\b(DV|DOLBY\s*VISION)\b/.test(upper)) {
    tags.push('DV');
    rank += 5;
  }
  if (/\b(HEVC|H\.?265|X265)\b/.test(upper)) {
    tags.push('HEVC');
    rank += 3;
  }
  if (/\b(ATMOS|DTS-?HD|TRUEHD)\b/.test(upper)) {
    tags.push('ATMOS');
    rank += 2;
  }

  const label = tags.length > 0 ? tags.slice(0, 2).join(' ') : baseLabel;
  return { label, rank, tags };
}

/**
 * Extract 4-digit release year from raw title or explicit provider metadata fields.
 */
export function extractYear(
  raw: string,
  fallback?: string | number | null
): number | null {
  // 1. Prefer bracketed/parenthesized year like (2010) or [2024]
  const bracketMatches = [...raw.matchAll(/[([]((?:19|20)\d{2})[)\]]/g)];
  if (bracketMatches.length > 0) {
    const last = bracketMatches[bracketMatches.length - 1];
    const parsed = Number.parseInt(last[1], 10);
    if (parsed >= 1900 && parsed <= 2035) return parsed;
  }

  // 2. Fallback metadata field (e.g., releaseDate: "2010-07-16" or year: "2010")
  if (fallback !== undefined && fallback !== null && String(fallback).trim() !== '') {
    const fbMatch = String(fallback).match(/\b((?:19|20)\d{2})\b/);
    if (fbMatch) {
      const parsed = Number.parseInt(fbMatch[1], 10);
      if (parsed >= 1900 && parsed <= 2035) return parsed;
    }
  }

  // 3. Trailing standalone year (e.g. "Inception 2010 4K") - skip if the whole title is just a year like "1917"
  const cleanedForTrailing = raw.replace(LEADING_REGION_PREFIX_RE, '').trim();
  const trailingMatch = cleanedForTrailing.match(/\s+((?:19|20)\d{2})(?:\s|$|[-–—|])/);
  if (trailingMatch) {
    const parsed = Number.parseInt(trailingMatch[1], 10);
    if (parsed >= 1900 && parsed <= 2035) return parsed;
  }

  return null;
}

/**
 * Normalize a Cinemeta or IPTV provider title into a clean canonical form for matching.
 */
export function normalizeTitle(raw: string, isSeries = false): string {
  if (!raw) return '';

  // Remove diacritics and normalize Unicode
  let text = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Strip repeated leading IPTV region/country tags: |EN|, |AR|, EN -, [MULTI], (FR)
  let previous = '';
  while (previous !== text) {
    previous = text;
    text = text.replace(LEADING_REGION_PREFIX_RE, '');
  }

  // Strip trailing metadata tags in brackets/parens
  text = text.replace(TRAILING_BRACKET_META_RE, ' ');

  // Remove bracketed/parenthesized years e.g. (2010), [2024], (2008-2013)
  text = text.replace(/[([](?:19|20)\d{2}(?:\s*[-–]\s*(?:(?:19|20)\d{2})?)?[)\]]/g, ' ');

  // For series, strip season/episode range markers like S01, S01-S05, Season 1, S1E02
  if (isSeries) {
    text = text
      .replace(/\bS\d{1,2}\s*[-–to]+\s*S?\d{1,2}\b/gi, ' ')
      .replace(/\bS\d{1,2}(?:E\d{1,3})?\b/gi, ' ')
      .replace(/\bSeason\s+\d{1,2}(?:\s*[-–]\s*\d{1,2})?\b/gi, ' ')
      .replace(/\bComplete\s+Series\b/gi, ' ');
  }

  // Replace ampersands with "and" before stripping punctuation
  text = text.replace(/&/g, ' and ');

  // Strip codec patterns with dots (H.265, H.264, 5.1, 7.1, WEB-DL, Blu-Ray)
  text = text
    .replace(/\bH\.?26[45]\b/gi, ' ')
    .replace(/\bWEB[-\s]?DL\b/gi, ' ')
    .replace(/\bBLU[-\s]?RAY\b/gi, ' ')
    .replace(/\bHDR10\+?\b/gi, ' ')
    .replace(/\b[57]\.1\b/g, ' ')
    .replace(/\bDIRECTOR'?S\s+CUT\b/gi, ' ');

  // Lowercase and replace non-alphanumeric chars (keeping apostrophes collapsed)
  text = text
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9\u0600-\u06ff\u0400-\u04ff\u3040-\u30ff\u4e00-\u9fff]+/g, ' ')
    .trim();

  // Filter noise tokens, but never wipe out all tokens if the title itself is short
  const tokens = text.split(/\s+/).filter(Boolean);
  const filtered: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    // Strip trailing release year token if there is already a real title token before it
    if (i > 0 && /^(19|20)\d{2}$/.test(tok) && tokens.length >= 2) {
      // Preserve known year titles when it's the final word of e.g. "Blade Runner 2049"
      if (Number.parseInt(tok, 10) <= 2030 && i === tokens.length - 1 && filtered.length >= 1) {
        continue;
      }
    }
    if (NOISE_TOKENS.has(tok)) {
      continue;
    }
    filtered.push(tok);
  }

  const result = (filtered.length > 0 ? filtered : tokens).join(' ').trim();
  return result;
}

/**
 * Strip leading English articles ("the", "a", "an") for secondary comparison
 */
function stripLeadingArticle(normalized: string): string {
  return normalized.replace(/^(?:the|a|an)\s+/i, '').trim();
}

/**
 * Sørensen–Dice coefficient on character bigrams (0.0 to 1.0)
 */
export function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) ?? 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigramsA.get(bg) ?? 0;
    if (count > 0) {
      bigramsA.set(bg, count - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

/**
 * Normalized Levenshtein similarity (0.0 to 1.0)
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  // Fast reject when length gap alone makes high similarity impossible
  if (Math.abs(a.length - b.length) / maxLen > 0.6) {
    return Math.max(0, 1 - Math.abs(a.length - b.length) / maxLen);
  }

  const prev = new Int32Array(b.length + 1);
  const curr = new Int32Array(b.length + 1);

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const chA = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = chA === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }

  return 1 - prev[b.length] / maxLen;
}

/**
 * Token-level Sørensen–Dice similarity (0.0 to 1.0)
 */
export function tokenSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const setA = new Set(a.split(/\s+/).filter(Boolean));
  const setB = new Set(b.split(/\s+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;

  let overlap = 0;
  for (const tok of setA) {
    if (setB.has(tok)) overlap++;
  }

  return (2 * overlap) / (setA.size + setB.size);
}

/**
 * Parse comma-separated keyword filters cleanly
 */
export function parseKeywordList(input?: string): string[] {
  if (!input) return [];
  return input
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * Check whether an Xtream item passes user-defined include/exclude keyword filters.
 */
export function passesCategoryAndKeywordFilter(
  rawTitle: string,
  categoryName: string | undefined,
  includeKeywords: string[],
  excludeKeywords: string[]
): boolean {
  const haystack = `${categoryName ?? ''} ${rawTitle}`.toLowerCase();

  if (excludeKeywords.length > 0) {
    for (const kw of excludeKeywords) {
      if (haystack.includes(kw)) return false;
    }
  }

  if (includeKeywords.length > 0) {
    let matched = false;
    for (const kw of includeKeywords) {
      if (haystack.includes(kw)) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }

  return true;
}

function normalizeNumericId(val?: string | number | null): string | null {
  if (val === undefined || val === null) return null;
  const cleaned = String(val).trim();
  if (!cleaned || cleaned === '0') return null;
  const digits = cleaned.match(/^\d+$/) ? cleaned : null;
  return digits;
}

/**
 * Score a single Xtream Codes candidate against a Cinemeta/TMDB CanonicalMeta object.
 */
export function scoreCandidate(
  meta: CanonicalMeta,
  item: XtreamCandidateInput,
  isSeries: boolean,
  threshold = DEFAULT_MATCH_THRESHOLD
): MatchDiagnostics {
  const quality = extractQualityLabel(item.name);
  const languageTag = extractLanguageTag(item.name);
  const normalizedCandidate = normalizeTitle(item.name, isSeries);
  const candidateYear = extractYear(item.name, item.year ?? item.releaseDate ?? item.release_date);
  const yearDelta =
    meta.year !== null && candidateYear !== null
      ? Math.abs(meta.year - candidateYear)
      : null;

  // Priority 1: Exact TMDB ID match on Xtream item
  const itemTmdbId = normalizeNumericId(item.tmdb_id ?? item.tmdb);
  const metaTmdbId = normalizeNumericId(meta.tmdbId);
  if (itemTmdbId && metaTmdbId && itemTmdbId === metaTmdbId) {
    return {
      rawTitle: item.name,
      normalizedCandidate,
      matchedAgainst: `TMDB #${metaTmdbId}`,
      candidateYear,
      yearDelta,
      dice: 1,
      levenshtein: 1,
      token: 1,
      score: 1,
      matchType: 'tmdb_id',
      quality,
      languageTag,
      passed: true,
    };
  }

  // Priority 2: Exact IMDb ID match on Xtream item
  const itemImdbId = typeof item.imdb_id === 'string' ? item.imdb_id.trim().toLowerCase() : '';
  if (itemImdbId && itemImdbId === meta.imdbId.toLowerCase()) {
    return {
      rawTitle: item.name,
      normalizedCandidate,
      matchedAgainst: meta.imdbId,
      candidateYear,
      yearDelta,
      dice: 1,
      levenshtein: 1,
      token: 1,
      score: 1,
      matchType: 'imdb_id',
      quality,
      languageTag,
      passed: true,
    };
  }

  // Priority 3 & 4: Compare against canonical title + all aliases
  const targetTitles = Array.from(
    new Set(
      [meta.title, ...meta.aliases]
        .map((t) => normalizeTitle(t, isSeries))
        .filter((t) => t.length > 0)
    )
  );

  let bestScore = 0;
  let bestDice = 0;
  let bestLev = 0;
  let bestToken = 0;
  let bestTarget = targetTitles[0] ?? '';
  let isExactTitle = false;

  const candNoArticle = stripLeadingArticle(normalizedCandidate);

  for (const target of targetTitles) {
    const targetNoArticle = stripLeadingArticle(target);

    if (normalizedCandidate === target || (candNoArticle && candNoArticle === targetNoArticle)) {
      bestDice = 1;
      bestLev = 1;
      bestToken = 1;
      bestTarget = target;
      isExactTitle = true;
      bestScore = 0.98;
      break;
    }

    const dice = Math.max(
      diceCoefficient(normalizedCandidate, target),
      diceCoefficient(candNoArticle, targetNoArticle)
    );
    const lev = Math.max(
      levenshteinSimilarity(normalizedCandidate, target),
      levenshteinSimilarity(candNoArticle, targetNoArticle)
    );
    const tok = Math.max(
      tokenSimilarity(normalizedCandidate, target),
      tokenSimilarity(candNoArticle, targetNoArticle)
    );

    const blended = 0.4 * dice + 0.35 * lev + 0.25 * tok;
    if (blended > bestScore) {
      bestScore = blended;
      bestDice = dice;
      bestLev = lev;
      bestToken = tok;
      bestTarget = target;
    }
  }

  // Apply year tolerance (±1 year allowed; >= 2 years strongly penalized to prevent remake false positives)
  let adjustedScore = bestScore;
  if (yearDelta !== null) {
    if (yearDelta === 0) {
      adjustedScore = Math.min(1, adjustedScore + 0.03);
    } else if (yearDelta === 1) {
      adjustedScore = Math.min(1, adjustedScore + 0.01);
    } else if (yearDelta === 2) {
      adjustedScore = Math.max(0, adjustedScore - 0.18);
    } else {
      adjustedScore = Math.max(0, adjustedScore - 0.35);
    }
  } else if (isExactTitle && meta.year !== null && !isSeries) {
    // Exact title match without provider year still passes cleanly
    adjustedScore = Math.min(0.96, adjustedScore);
  }

  const roundedScore = Math.round(adjustedScore * 1000) / 1000;
  const passed = roundedScore >= threshold;

  return {
    rawTitle: item.name,
    normalizedCandidate,
    matchedAgainst: bestTarget,
    candidateYear,
    yearDelta,
    dice: Math.round(bestDice * 1000) / 1000,
    levenshtein: Math.round(bestLev * 1000) / 1000,
    token: Math.round(bestToken * 1000) / 1000,
    score: roundedScore,
    matchType: passed ? (isExactTitle ? 'exact_title' : 'fuzzy_title') : 'rejected',
    quality,
    languageTag,
    passed,
  };
}

/**
 * Find and rank top matching Xtream Codes items for a given Cinemeta/TMDB title.
 */
export function findBestMatches<T extends XtreamCandidateInput>(
  meta: CanonicalMeta,
  items: T[],
  options: {
    isSeries: boolean;
    threshold?: number;
    maxResults?: number;
    categoryMap?: Map<string, string>;
    includeKeywords?: string[];
    excludeKeywords?: string[];
  }
): MatchResult<T>[] {
  const threshold = options.threshold ?? DEFAULT_MATCH_THRESHOLD;
  const maxResults = options.maxResults ?? 12;
  const includeKeywords = options.includeKeywords ?? [];
  const excludeKeywords = options.excludeKeywords ?? [];
  const categoryMap = options.categoryMap;

  const matches: MatchResult<T>[] = [];

  // Precompute normalized target first-character/tokens for fast filtering on large 80k+ IPTV lists
  const metaTmdbId = normalizeNumericId(meta.tmdbId);
  const metaImdbLower = meta.imdbId.toLowerCase();
  const targetNormalized = [meta.title, ...meta.aliases]
    .map((t) => normalizeTitle(t, options.isSeries))
    .filter(Boolean);
  const targetTokens = new Set(
    targetNormalized.flatMap((t) => t.split(/\s+/).filter((w) => w.length >= 2))
  );

  for (const item of items) {
    if (!item || typeof item.name !== 'string') continue;

    if (includeKeywords.length > 0 || excludeKeywords.length > 0) {
      const catName =
        categoryMap && item.category_id !== undefined
          ? categoryMap.get(String(item.category_id))
          : undefined;
      if (!passesCategoryAndKeywordFilter(item.name, catName, includeKeywords, excludeKeywords)) {
        continue;
      }
    }

    // Fast path: check exact TMDB or IMDb ID before doing string normalization
    const itemTmdb = normalizeNumericId(item.tmdb_id ?? item.tmdb);
    const itemImdb = typeof item.imdb_id === 'string' ? item.imdb_id.trim().toLowerCase() : '';
    const hasIdMatch =
      (itemTmdb !== null && metaTmdbId !== null && itemTmdb === metaTmdbId) ||
      (itemImdb !== '' && itemImdb === metaImdbLower);

    if (!hasIdMatch && targetTokens.size > 0) {
      // Quick pre-filter: require at least one 2+ char token overlap OR short title fallback
      const lowerName = item.name.toLowerCase();
      let quickHit = false;
      for (const tok of targetTokens) {
        if (lowerName.includes(tok)) {
          quickHit = true;
          break;
        }
      }
      if (!quickHit && targetNormalized.every((t) => t.length > 4)) {
        continue;
      }
    }

    const diagnostics = scoreCandidate(meta, item, options.isSeries, threshold);
    if (diagnostics.passed) {
      matches.push({ item, diagnostics });
    }
  }

  // Sort by: 1) ID exact match, 2) Match score descending, 3) Video quality rank descending
  matches.sort((a, b) => {
    const aIsId = a.diagnostics.matchType === 'tmdb_id' || a.diagnostics.matchType === 'imdb_id' ? 1 : 0;
    const bIsId = b.diagnostics.matchType === 'tmdb_id' || b.diagnostics.matchType === 'imdb_id' ? 1 : 0;
    if (bIsId !== aIsId) return bIsId - aIsId;

    if (Math.abs(b.diagnostics.score - a.diagnostics.score) > 0.015) {
      return b.diagnostics.score - a.diagnostics.score;
    }

    return b.diagnostics.quality.rank - a.diagnostics.quality.rank;
  });

  return matches.slice(0, maxResults);
}
