// services/matchService.ts
// Haalt wedstrijden op via onze eigen /api/Matches proxy

import { Match } from "../types";

type RawEvent = any;

function safeStr(v: any, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function mapStatus(event: RawEvent): { status: string; minute?: string; score?: string } {
  const type = safeStr(event?.status?.type).toLowerCase();
  const description = safeStr(event?.status?.description);
  const home = event?.homeScore?.current;
  const away = event?.awayScore?.current;
  const score = (home !== null && away !== null && home !== undefined && away !== undefined)
    ? `${home}-${away}` : "v";
  const min = event?.time?.current;
  const minute = min ? `${min}'` : undefined;
  if (type === "finished") return { status: "FT", score };
  if (type === "inprogress") return { status: description || "LIVE", minute, score };
  return { status: "NS", score: "v" };
}

function mapLeague(event: RawEvent): string {
  const tournament = safeStr(event?.tournament?.name);
  const category = safeStr(event?.tournament?.category?.name);
  if (tournament && category) return `${category} — ${tournament}`;
  return tournament || category || "Unknown";
}

function mapEventToMatch(dateISO: string, event: RawEvent): Match {
  const home = safeStr(event?.homeTeam?.name, "Home");
  const away = safeStr(event?.awayTeam?.name, "Away");
  const homeId = String(event?.homeTeam?.id ?? home).toLowerCase();
  const awayId = String(event?.awayTeam?.id ?? away).toLowerCase();
  const startTs = event?.startTimestamp;
  const kickoff = startTs
    ? new Date(startTs * 1000).toISOString()
    : new Date().toISOString();
  const { status, minute, score } = mapStatus(event);

  // Logo's - SofaScore of football-data
  const homeLogo = event?.homeTeam?.logo ||
    (event?.homeTeam?.id && String(event.homeTeam.id).match(/^\d+$/)
      ? `https://api.sofascore.app/api/v1/team/${event.homeTeam.id}/image`
      : null) ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(home)}&background=1e293b&color=fff&size=64`;

  const awayLogo = event?.awayTeam?.logo ||
    (event?.awayTeam?.id && String(event.awayTeam.id).match(/^\d+$/)
      ? `https://api.sofascore.app/api/v1/team/${event.awayTeam.id}/image`
      : null) ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(away)}&background=1e293b&color=fff&size=64`;

  return {
    id: `ss-${event?.id ?? `${home}-${away}`}`,
    date: dateISO,
    kickoff,
    league: mapLeague(event),
    homeTeamId: homeId,
    awayTeamId: awayId,
    homeTeamName: home,
    awayTeamName: away,
    homeLogo,
    awayLogo,
    status,
    minute,
    score,
  };
}

function storageKey(dateISO: string) {
  return `footypredict_cache_v2_${dateISO}`;
}

function readCache(dateISO: string, maxAgeMs: number): Match[] | null {
  try {
    const raw = localStorage.getItem(storageKey(dateISO));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || !Array.isArray(parsed?.data)) return null;
    if (Date.now() - parsed.ts > maxAgeMs) return null;
    return parsed.data as Match[];
  } catch { return null; }
}

function writeCache(dateISO: string, data: Match[]) {
  try {
    localStorage.setItem(storageKey(dateISO), JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

export async function fetchMatchesForDate(dateISO: string, signal?: AbortSignal): Promise<Match[]> {
  // Cache: 3 minuten voor vandaag, 30 minuten voor andere dagen
  const isToday = dateISO === new Date().toISOString().split('T')[0];
  const cacheAge = isToday ? 3 * 60 * 1000 : 30 * 60 * 1000;
  const cached = readCache(dateISO, cacheAge);
  if (cached) return cached;

  try {
    // Haal geplande wedstrijden op via proxy
    const res = await fetch(`/api/matches?date=${dateISO}`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const events: RawEvent[] = json?.events ?? [];
    const matches = events.map((e) => mapEventToMatch(dateISO, e));
    writeCache(dateISO, matches);

    // Merge live wedstrijden
    let live: Match[] = [];
    try {
      const liveRes = await fetch(`/api/matches?live=true`, { signal });
      if (liveRes.ok) {
        const liveJson = await liveRes.json();
        live = (liveJson?.events ?? []).map((e: RawEvent) => mapEventToMatch(dateISO, e));
      }
    } catch {}

    const byId = new Map<string, Match>();
    for (const m of matches) byId.set(m.id, m);
    for (const m of live) {
      const existing = byId.get(m.id);
      byId.set(m.id, existing ? { ...existing, ...m } : m);
    }

    return Array.from(byId.values()).sort((a, b) => a.kickoff.localeCompare(b.kickoff));

  } catch (err) {
    console.error('[matchService] fout:', err);
    return [];
  }
}
