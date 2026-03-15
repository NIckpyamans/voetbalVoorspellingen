// services/matchService.ts
// Leest van GitHub raw — ondersteunt zowel oud als nieuw server_data.json formaat

import { Match } from "../types";

const GITHUB_RAW = 'https://raw.githubusercontent.com/NIckpyamans/voetbalVoorspellingen/main/server_data.json';

function cacheKey(dateISO: string) { return `footypredict_v4_${dateISO}`; }

function readCache(dateISO: string, maxAgeMs: number) {
  try {
    const raw = localStorage.getItem(cacheKey(dateISO));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p?.ts) return null;
    if (Date.now() - p.ts > maxAgeMs) return null;
    return p;
  } catch { return null; }
}

function writeCache(dateISO: string, data: any) {
  try { localStorage.setItem(cacheKey(dateISO), JSON.stringify({ ts: Date.now(), ...data })); } catch {}
}

// Bouw een Match object vanuit een stored match of vanuit een prediction
function buildMatch(raw: any): Match {
  return {
    id:            raw.id       || raw.matchId || `ss-${raw.homeTeam}-${raw.awayTeam}`,
    date:          raw.date     || '',
    kickoff:       raw.kickoff  || null,
    league:        raw.league   || '',
    homeTeamId:    raw.homeTeamId || '',
    awayTeamId:    raw.awayTeamId || '',
    homeTeamName:  raw.homeTeamName || raw.homeTeam || 'Home',
    awayTeamName:  raw.awayTeamName || raw.awayTeam || 'Away',
    homeLogo:      raw.homeLogo  || (raw.homeTeamId ? `https://api.sofascore.app/api/v1/team/${raw.homeTeamId}/image` : ''),
    awayLogo:      raw.awayLogo  || (raw.awayTeamId ? `https://api.sofascore.app/api/v1/team/${raw.awayTeamId}/image` : ''),
    status:        raw.status   || 'NS',
    score:         raw.score    || undefined,
    minute:        raw.minute   || undefined,
    ...(raw.homeForm        ? { homeForm: raw.homeForm }               : {}),
    ...(raw.awayForm        ? { awayForm: raw.awayForm }               : {}),
    ...(raw.homeElo         ? { homeElo: raw.homeElo }                 : {}),
    ...(raw.awayElo         ? { awayElo: raw.awayElo }                 : {}),
    ...(raw.h2h             ? { h2h: raw.h2h }                         : {}),
    ...(raw.homeSeasonStats ? { homeSeasonStats: raw.homeSeasonStats } : {}),
    ...(raw.awaySeasonStats ? { awaySeasonStats: raw.awaySeasonStats } : {}),
  } as Match;
}

export interface MatchesAndPredictions {
  matches: Match[];
  predictions: Record<string, any>;
  lastRun: number | null;
}

export async function fetchMatchesAndPredictions(
  dateISO: string,
  signal?: AbortSignal
): Promise<MatchesAndPredictions> {
  const isToday = dateISO === new Date().toISOString().split('T')[0];
  const cacheAge = isToday ? 90_000 : 30 * 60_000; // vandaag 90s, anders 30 min
  const cached = readCache(dateISO, cacheAge);

  if (cached?.matches) {
    const predMap: Record<string, any> = {};
    for (const p of (cached.predictions || [])) if (p.matchId) predMap[p.matchId] = p;
    return { matches: cached.matches, predictions: predMap, lastRun: cached.lastRun || null };
  }

  try {
    const res = await fetch(`${GITHUB_RAW}?t=${Date.now()}`, {
      signal,
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const store = await res.json();

    const predMap: Record<string, any> = {};
    let matches: Match[] = [];

    // ── NIEUW formaat: store.matches[date] aanwezig ──────────────────────────
    if (store.matches?.[dateISO]) {
      const rawMatches: any[] = store.matches[dateISO];
      const rawPreds:   any[] = store.predictions?.[dateISO] || [];

      // Koppel H2H van match aan prediction
      const h2hMap: Record<string, any> = {};
      for (const m of rawMatches) if (m.h2h) h2hMap[m.id] = m.h2h;

      matches = rawMatches.map(buildMatch);
      for (const p of rawPreds) {
        if (p.matchId) predMap[p.matchId] = { ...p, ...(h2hMap[p.matchId] ? { h2h: h2hMap[p.matchId] } : {}) };
      }

    // ── OUD formaat: alleen store.predictions[date] beschikbaar ─────────────
    } else if (store.predictions?.[dateISO]) {
      const rawPreds: any[] = store.predictions[dateISO];
      console.log(`[matchService] oud formaat, ${rawPreds.length} predictions voor ${dateISO}`);

      for (const p of rawPreds) {
        // Maak een nep-match van de prediction data
        const matchId = p.matchId || `local-${p.homeTeam}-${p.awayTeam}`;
        const m = buildMatch({ ...p, id: matchId });
        matches.push(m);
        predMap[matchId] = { ...p, matchId };
      }

    // ── GEEN data voor gevraagde datum — probeer meest recente datum ─────────
    } else {
      const allDates = Object.keys(store.matches || {}).concat(Object.keys(store.predictions || {}));
      const uniqueDates = [...new Set(allDates)].sort().reverse();

      if (uniqueDates.length > 0) {
        const latestDate = uniqueDates[0];
        console.log(`[matchService] geen data voor ${dateISO}, gebruik ${latestDate}`);

        const rawMatches: any[] = store.matches?.[latestDate] || [];
        const rawPreds:   any[] = store.predictions?.[latestDate] || [];

        if (rawMatches.length > 0) {
          matches = rawMatches.map(buildMatch);
          for (const p of rawPreds) if (p.matchId) predMap[p.matchId] = p;
        } else {
          for (const p of rawPreds) {
            const matchId = p.matchId || `local-${p.homeTeam}-${p.awayTeam}`;
            matches.push(buildMatch({ ...p, id: matchId }));
            predMap[matchId] = { ...p, matchId };
          }
        }
      }
    }

    writeCache(dateISO, { matches, predictions: Object.values(predMap), lastRun: store.lastRun });
    return { matches, predictions: predMap, lastRun: store.lastRun };

  } catch (err) {
    console.error('[matchService]', err);
    // Probeer verlopen cache als fallback
    const stale = readCache(dateISO, Infinity);
    if (stale?.matches) {
      const predMap: Record<string, any> = {};
      for (const p of (stale.predictions || [])) if (p.matchId) predMap[p.matchId] = p;
      return { matches: stale.matches, predictions: predMap, lastRun: stale.lastRun };
    }
    return { matches: [], predictions: {}, lastRun: null };
  }
}

// Legacy export
export async function fetchMatchesForDate(dateISO: string, signal?: AbortSignal): Promise<Match[]> {
  const { matches } = await fetchMatchesAndPredictions(dateISO, signal);
  return matches;
}
