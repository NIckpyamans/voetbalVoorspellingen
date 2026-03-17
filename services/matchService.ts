// services/matchService.ts v4 — geeft alle velden door inclusief live minuten
import { Match } from "../types";

const GITHUB_RAW = 'https://raw.githubusercontent.com/NIckpyamans/voetbalVoorspellingen/main/server_data.json';

function storageKey(dateISO: string) { return `footypredict_v6_${dateISO}`; }

function readCache(dateISO: string, maxAgeMs: number) {
  try {
    const raw = localStorage.getItem(storageKey(dateISO));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p?.ts || Date.now() - p.ts > maxAgeMs) return null;
    return { matches: p.matches || [], predictions: p.predictions || {}, lastRun: p.lastRun || null };
  } catch { return null; }
}

function writeCache(dateISO: string, matches: Match[], predictions: Record<string, any>, lastRun: number | null) {
  try { localStorage.setItem(storageKey(dateISO), JSON.stringify({ ts: Date.now(), matches, predictions, lastRun })); } catch {}
}

function mapRawMatch(m: any): Match {
  return {
    id: m.id, date: m.date, kickoff: m.kickoff, league: m.league,
    homeTeamId: m.homeTeamId || '', awayTeamId: m.awayTeamId || '',
    homeTeamName: m.homeTeamName || 'Home', awayTeamName: m.awayTeamName || 'Away',
    homeLogo: m.homeLogo || '', awayLogo: m.awayLogo || '',
    status: m.status || 'NS',
    score: m.score || undefined,
    minute: m.minute || undefined,
    // LIVE velden — cruciaal voor klok weergave
    ...(m.period    != null ? { period: m.period }       : {}),
    ...(m.extraTime != null ? { extraTime: m.extraTime } : {}),
    // Team data
    ...(m.homeForm        ? { homeForm: m.homeForm }             : {}),
    ...(m.awayForm        ? { awayForm: m.awayForm }             : {}),
    ...(m.homeElo         ? { homeElo: m.homeElo }               : {}),
    ...(m.awayElo         ? { awayElo: m.awayElo }               : {}),
    ...(m.homePos         ? { homePos: m.homePos }               : {}),
    ...(m.awayPos         ? { awayPos: m.awayPos }               : {}),
    ...(m.matchImportance ? { matchImportance: m.matchImportance}: {}),
    // H2H en statistieken
    ...(m.h2h             ? { h2h: m.h2h }                       : {}),
    ...(m.homeSeasonStats ? { homeSeasonStats: m.homeSeasonStats }: {}),
    ...(m.awaySeasonStats ? { awaySeasonStats: m.awaySeasonStats }: {}),
    ...(m.homeInjuries    ? { homeInjuries: m.homeInjuries }     : {}),
    ...(m.awayInjuries    ? { awayInjuries: m.awayInjuries }     : {}),
    ...(m.homeGoalTiming  ? { homeGoalTiming: m.homeGoalTiming } : {}),
    ...(m.awayGoalTiming  ? { awayGoalTiming: m.awayGoalTiming } : {}),
    ...(m.liveStats       ? { liveStats: m.liveStats }           : {}),
  };
}

export interface MatchesUpdate {
  matches: Match[];
  predictions: Record<string, any>;
  lastRun: number | null;
  workerNeeded?: boolean;
}

export async function fetchMatchesAndPredictions(dateISO: string, signal?: AbortSignal): Promise<MatchesUpdate> {
  const isToday = dateISO === new Date().toISOString().split('T')[0];
  const cacheAge = isToday ? 90_000 : 30 * 60_000;
  const cached = readCache(dateISO, cacheAge);
  if (cached) return { ...cached, workerNeeded: false };

  try {
    const res = await fetch(`/api/matches?date=${dateISO}`, { signal });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const json = await res.json();

    const lastRun: number | null = json.lastRun || null;
    const rawMatches: any[] = json.matches || json.events || [];

    const predRes = await fetch(`/api/predict?date=${dateISO}`, { signal });
    const predJson = predRes.ok ? await predRes.json() : { predictions: [] };
    const rawPreds: any[] = predJson.predictions || [];

    if (rawMatches.length === 0 && rawPreds.length === 0) {
      return { matches: [], predictions: {}, lastRun, workerNeeded: true };
    }

    const matches = rawMatches.map(mapRawMatch);
    const predMap: Record<string, any> = {};
    for (const p of rawPreds) if (p.matchId) predMap[p.matchId] = p;

    // H2H vanuit match data koppelen aan prediction
    for (const m of rawMatches) {
      if (m.h2h && predMap[m.id]) predMap[m.id] = { ...predMap[m.id], h2h: m.h2h };
    }

    writeCache(dateISO, matches, predMap, lastRun);
    return { matches, predictions: predMap, lastRun, workerNeeded: false };
  } catch (err) {
    console.error('[matchService]', err);
    return { matches: [], predictions: {}, lastRun: null, workerNeeded: false };
  }
}
