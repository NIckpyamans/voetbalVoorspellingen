// services/matchService.ts v3
// Haalt data op via /api/matches (Vercel proxy) — geen CORS probleem

import { Match } from "../types";

function storageKey(dateISO: string) {
  return `footypredict_v5_${dateISO}`;
}

function readCache(dateISO: string, maxAgeMs: number) {
  try {
    const raw = localStorage.getItem(storageKey(dateISO));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || Date.now() - parsed.ts > maxAgeMs) return null;
    return { matches: parsed.matches || [], predictions: parsed.predictions || {}, lastRun: parsed.lastRun || null };
  } catch { return null; }
}

function writeCache(dateISO: string, matches: Match[], predictions: Record<string, any>, lastRun: number | null) {
  try {
    localStorage.setItem(storageKey(dateISO), JSON.stringify({ ts: Date.now(), matches, predictions, lastRun }));
  } catch {}
}

function mapRawMatch(m: any): Match {
  return {
    id: m.id, date: m.date, kickoff: m.kickoff, league: m.league,
    homeTeamId: m.homeTeamId || '', awayTeamId: m.awayTeamId || '',
    homeTeamName: m.homeTeamName || 'Home', awayTeamName: m.awayTeamName || 'Away',
    homeLogo: m.homeLogo || '', awayLogo: m.awayLogo || '',
    status: m.status || 'NS', score: m.score || undefined, minute: m.minute || undefined,
    ...(m.homeForm        ? { homeForm: m.homeForm }             : {}),
    ...(m.awayForm        ? { awayForm: m.awayForm }             : {}),
    ...(m.homeElo         ? { homeElo: m.homeElo }               : {}),
    ...(m.awayElo         ? { awayElo: m.awayElo }               : {}),
    ...(m.h2h             ? { h2h: m.h2h }                       : {}),
    ...(m.homeSeasonStats ? { homeSeasonStats: m.homeSeasonStats }: {}),
    ...(m.awaySeasonStats ? { awaySeasonStats: m.awaySeasonStats }: {}),
  };
}

export interface MatchesUpdate {
  matches: Match[];
  predictions: Record<string, any>;
  lastRun: number | null;
  workerNeeded?: boolean;
}

export async function fetchMatchesAndPredictions(
  dateISO: string,
  signal?: AbortSignal
): Promise<MatchesUpdate> {
  const isToday = dateISO === new Date().toISOString().split('T')[0];
  const cacheAge = isToday ? 90_000 : 30 * 60_000;
  const cached = readCache(dateISO, cacheAge);
  if (cached) return { ...cached, workerNeeded: false };

  try {
    // Haal via onze eigen Vercel API (geen CORS)
    const res = await fetch(`/api/matches?date=${dateISO}`, { signal });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const json = await res.json();

    const lastRun: number | null = json.lastRun || null;
    const rawMatches: any[] = json.events || json.matches || [];

    // Haal ook predictions op
    const predRes = await fetch(`/api/predict?date=${dateISO}`, { signal });
    const predJson = predRes.ok ? await predRes.json() : { predictions: [] };
    const rawPreds: any[] = predJson.predictions || [];

    if (rawMatches.length === 0 && rawPreds.length === 0) {
      return { matches: [], predictions: {}, lastRun, workerNeeded: true };
    }

    // Als rawMatches leeg maar preds beschikbaar (oud formaat)
    const matchesToUse = rawMatches.length > 0 ? rawMatches : rawPreds
      .filter((p: any) => p.homeTeam && p.awayTeam)
      .map((p: any) => ({
        id: p.matchId, date: dateISO, kickoff: null,
        league: p.league || '⚽ Onbekend',
        homeTeamId: '', awayTeamId: '',
        homeTeamName: p.homeTeam, awayTeamName: p.awayTeam,
        homeLogo: '', awayLogo: '', status: 'NS',
        homeElo: p.homeElo, awayElo: p.awayElo,
        homeForm: p.homeForm, awayForm: p.awayForm,
      }));

    const matches = matchesToUse.map(mapRawMatch);
    const predMap: Record<string, any> = {};
    for (const p of rawPreds) if (p.matchId) predMap[p.matchId] = p;

    // Voeg H2H toe vanuit match data
    for (const m of matchesToUse) {
      if (m.h2h && predMap[m.id]) predMap[m.id].h2h = m.h2h;
    }

    writeCache(dateISO, matches, predMap, lastRun);
    return { matches, predictions: predMap, lastRun, workerNeeded: false };

  } catch (err) {
    console.error('[matchService]', err);
    return { matches: [], predictions: {}, lastRun: null, workerNeeded: false };
  }
}
