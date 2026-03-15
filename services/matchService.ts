// services/matchService.ts
// Leest rechtstreeks van GitHub raw (sneller dan via Vercel proxy)

import { Match } from "../types";

const GITHUB_RAW = 'https://raw.githubusercontent.com/NIckpyamans/voetbalVoorspellingen/main/server_data.json';

type RawMatch = any;

function storageKey(dateISO: string) {
  return `footypredict_v3_${dateISO}`;
}

function readCache(dateISO: string, maxAgeMs: number): { matches: Match[], predictions: any[] } | null {
  try {
    const raw = localStorage.getItem(storageKey(dateISO));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || !Array.isArray(parsed?.matches)) return null;
    if (Date.now() - parsed.ts > maxAgeMs) return null;
    return { matches: parsed.matches, predictions: parsed.predictions || [] };
  } catch { return null; }
}

function writeCache(dateISO: string, matches: Match[], predictions: any[]) {
  try {
    localStorage.setItem(storageKey(dateISO), JSON.stringify({ ts: Date.now(), matches, predictions }));
  } catch {}
}

function mapToMatch(m: RawMatch): Match {
  return {
    id: m.id,
    date: m.date,
    kickoff: m.kickoff,
    league: m.league,
    homeTeamId: m.homeTeamId || '',
    awayTeamId: m.awayTeamId || '',
    homeTeamName: m.homeTeamName || 'Home',
    awayTeamName: m.awayTeamName || 'Away',
    homeLogo: m.homeLogo || '',
    awayLogo: m.awayLogo || '',
    status: m.status || 'NS',
    score: m.score || undefined,
    minute: m.minute || undefined,
    // Extra data doorgeven aan MatchCard
    ...(m.homeForm  ? { homeForm: m.homeForm }   : {}),
    ...(m.awayForm  ? { awayForm: m.awayForm }   : {}),
    ...(m.homeElo   ? { homeElo: m.homeElo }     : {}),
    ...(m.awayElo   ? { awayElo: m.awayElo }     : {}),
    ...(m.h2h       ? { h2h: m.h2h }             : {}),
    ...(m.homeSeasonStats ? { homeSeasonStats: m.homeSeasonStats } : {}),
    ...(m.awaySeasonStats ? { awaySeasonStats: m.awaySeasonStats } : {}),
  };
}

export interface MatchesAndPredictions {
  matches: Match[];
  predictions: Record<string, any>;
  lastRun: number | null;
}

// Hoofdfunctie: haalt matches + predictions in één keer op
export async function fetchMatchesAndPredictions(
  dateISO: string,
  signal?: AbortSignal
): Promise<MatchesAndPredictions> {
  const isToday = dateISO === new Date().toISOString().split('T')[0];
  // Vandaag: 2 minuten cache (live scores), andere dagen: 30 minuten
  const cacheAge = isToday ? 2 * 60 * 1000 : 30 * 60 * 1000;
  const cached = readCache(dateISO, cacheAge);

  if (cached) {
    const predMap: Record<string, any> = {};
    for (const p of cached.predictions) predMap[p.matchId] = p;
    return { matches: cached.matches, predictions: predMap, lastRun: null };
  }

  try {
    // Haal server_data.json op van GitHub (één request, alles erin)
    const res = await fetch(`${GITHUB_RAW}?t=${Date.now()}`, {
      signal,
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const store = await res.json();

    const rawMatches: RawMatch[] = store.matches?.[dateISO] || [];
    const rawPreds: any[] = store.predictions?.[dateISO] || [];

    // Merge H2H data van matches in predictions
    const matchH2H: Record<string, any> = {};
    for (const m of rawMatches) {
      if (m.h2h) matchH2H[m.id] = m.h2h;
    }

    const matches = rawMatches.map(mapToMatch);

    // Bouw predMap: matchId → prediction
    const predMap: Record<string, any> = {};
    for (const p of rawPreds) {
      predMap[p.matchId] = {
        ...p,
        // Voeg H2H toe aan prediction als beschikbaar
        ...(matchH2H[p.matchId] ? { h2h: matchH2H[p.matchId] } : {})
      };
    }

    // Fallback: als geen server predictions, gebruik default
    if (rawPreds.length === 0 && rawMatches.length > 0) {
      for (const m of rawMatches) {
        predMap[m.id] = {
          matchId: m.id,
          homeProb: 0.40, drawProb: 0.25, awayProb: 0.35,
          homeXG: 1.35, awayXG: 1.1,
          predHomeGoals: 1, predAwayGoals: 1,
          exactProb: 0.12, confidence: 0.12,
          over25: 0.50, over15: 0.70, over35: 0.25, btts: 0.48,
          homeForm: m.homeForm || '', awayForm: m.awayForm || '',
          homeElo: m.homeElo || 1500, awayElo: m.awayElo || 1500,
        };
      }
    }

    writeCache(dateISO, matches, rawPreds);

    return { matches, predictions: predMap, lastRun: store.lastRun };

  } catch (err) {
    console.error('[matchService]', err);
    return { matches: [], predictions: {}, lastRun: null };
  }
}

// Legacy export voor compatibiliteit
export async function fetchMatchesForDate(dateISO: string, signal?: AbortSignal): Promise<Match[]> {
  const { matches } = await fetchMatchesAndPredictions(dateISO, signal);
  return matches;
}
