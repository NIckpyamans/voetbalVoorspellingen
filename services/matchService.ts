import { Match } from "../types";

const CACHE_VERSION = "v7";
const LIVE_CACHE_AGE_MS = 15_000;
const TODAY_CACHE_AGE_MS = 90_000;
const OTHER_CACHE_AGE_MS = 30 * 60_000;

function storageKey(dateISO: string) {
  return `footypredict_${CACHE_VERSION}_${dateISO}`;
}

function isLiveMatch(match: any) {
  return String(match?.status || "").toUpperCase() === "LIVE" || match?.minute != null || match?.minuteValue != null;
}

function parseMinuteValue(minute: any, minuteValue?: any) {
  const explicit = Number(minuteValue);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  if (typeof minute === "number" && Number.isFinite(minute)) return minute;

  if (typeof minute !== "string") return null;

  if (minute.toUpperCase() === "HT") return 45;

  const plusMatch = minute.match(/(\d+)\s*\+\s*(\d+)/);
  if (plusMatch) return Number(plusMatch[1]) + Number(plusMatch[2]);

  const plainMatch = minute.match(/(\d+)/);
  return plainMatch ? Number(plainMatch[1]) : null;
}

function normalizeMinute(minute: any, minuteValue?: any, extraTime?: any, period?: any) {
  const periodText = String(period || "").toLowerCase();
  if (periodText.includes("half time") || periodText.includes("halftime") || periodText.includes("break")) {
    return "HT";
  }

  const baseMinute = parseMinuteValue(minute, minuteValue);
  if (!baseMinute) return undefined;

  const extra = Number(extraTime || 0);
  if (extra > 0) return `${baseMinute}+${extra}'`;

  return `${baseMinute}'`;
}

function getMaxCacheAge(dateISO: string, matches: any[]) {
  const today = new Date().toISOString().split("T")[0];
  if (dateISO !== today) return OTHER_CACHE_AGE_MS;
  if ((matches || []).some(isLiveMatch)) return LIVE_CACHE_AGE_MS;
  return TODAY_CACHE_AGE_MS;
}

function readCache(dateISO: string) {
  try {
    const raw = localStorage.getItem(storageKey(dateISO));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const matches = parsed.matches || [];
    const maxAge = getMaxCacheAge(dateISO, matches);

    if (!parsed?.ts || Date.now() - parsed.ts > maxAge) return null;

    return {
      matches,
      predictions: parsed.predictions || {},
      lastRun: parsed.lastRun || null,
    };
  } catch {
    return null;
  }
}

function writeCache(
  dateISO: string,
  matches: Match[],
  predictions: Record<string, any>,
  lastRun: number | null
) {
  try {
    localStorage.setItem(
      storageKey(dateISO),
      JSON.stringify({
        ts: Date.now(),
        matches,
        predictions,
        lastRun,
      })
    );
  } catch {}
}

function mapRawMatch(m: any): Match {
  const minuteValue = parseMinuteValue(m.minute, m.minuteValue);

  return {
    id: m.id,
    date: m.date,
    kickoff: m.kickoff,
    league: m.league,
    homeTeamId: m.homeTeamId || "",
    awayTeamId: m.awayTeamId || "",
    homeTeamName: m.homeTeamName || "Home",
    awayTeamName: m.awayTeamName || "Away",
    homeLogo: m.homeLogo || "",
    awayLogo: m.awayLogo || "",
    status: m.status || "NS",
    score: m.score || undefined,
    minute: normalizeMinute(m.minute, minuteValue, m.extraTime, m.period),

    ...(minuteValue != null ? { minuteValue } : {}),
    ...(m.period != null ? { period: m.period } : {}),
    ...(m.extraTime != null ? { extraTime: m.extraTime } : {}),
    ...(m.liveUpdatedAt != null ? { liveUpdatedAt: m.liveUpdatedAt } : {}),

    ...(m.homeForm ? { homeForm: m.homeForm } : {}),
    ...(m.awayForm ? { awayForm: m.awayForm } : {}),
    ...(m.homeElo ? { homeElo: m.homeElo } : {}),
    ...(m.awayElo ? { awayElo: m.awayElo } : {}),
    ...(m.homePos ? { homePos: m.homePos } : {}),
    ...(m.awayPos ? { awayPos: m.awayPos } : {}),
    ...(m.matchImportance ? { matchImportance: m.matchImportance } : {}),
    ...(m.h2h ? { h2h: m.h2h } : {}),
    ...(m.homeSeasonStats ? { homeSeasonStats: m.homeSeasonStats } : {}),
    ...(m.awaySeasonStats ? { awaySeasonStats: m.awaySeasonStats } : {}),
    ...(m.homeInjuries ? { homeInjuries: m.homeInjuries } : {}),
    ...(m.awayInjuries ? { awayInjuries: m.awayInjuries } : {}),
    ...(m.homeGoalTiming ? { homeGoalTiming: m.homeGoalTiming } : {}),
    ...(m.awayGoalTiming ? { awayGoalTiming: m.awayGoalTiming } : {}),
    ...(m.liveStats ? { liveStats: m.liveStats } : {}),
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
  const cached = readCache(dateISO);
  if (cached) return { ...cached, workerNeeded: false };

  try {
    const res = await fetch(`/api/matches?date=${dateISO}`, {
      signal,
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`API ${res.status}`);
    const json = await res.json();

    const lastRun: number | null = json.lastRun || null;
    const rawMatches: any[] = json.matches || json.events || [];

    const predRes = await fetch(`/api/predict?date=${dateISO}`, {
      signal,
      cache: "no-store",
    });
    const predJson = predRes.ok ? await predRes.json() : { predictions: [] };
    const rawPredictions: any[] = predJson.predictions || [];

    if (rawMatches.length === 0 && rawPredictions.length === 0) {
      return { matches: [], predictions: {}, lastRun, workerNeeded: true };
    }

    const matches = rawMatches.map(mapRawMatch);
    const predictionMap: Record<string, any> = {};

    for (const prediction of rawPredictions) {
      if (!prediction.matchId) continue;
      predictionMap[prediction.matchId] = prediction;
    }

    for (const rawMatch of rawMatches) {
      if (!rawMatch.id) continue;

      if (!predictionMap[rawMatch.id]) predictionMap[rawMatch.id] = {};

      if (rawMatch.h2h) predictionMap[rawMatch.id] = { ...predictionMap[rawMatch.id], h2h: rawMatch.h2h };
      if (rawMatch.homePos != null) predictionMap[rawMatch.id] = { ...predictionMap[rawMatch.id], homePos: rawMatch.homePos };
      if (rawMatch.awayPos != null) predictionMap[rawMatch.id] = { ...predictionMap[rawMatch.id], awayPos: rawMatch.awayPos };
    }

    writeCache(dateISO, matches, predictionMap, lastRun);
    return { matches, predictions: predictionMap, lastRun, workerNeeded: false };
  } catch (err) {
    console.error("[matchService]", err);
    return { matches: [], predictions: {}, lastRun: null, workerNeeded: false };
  }
}
