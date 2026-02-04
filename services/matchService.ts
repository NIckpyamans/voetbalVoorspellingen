import { Match } from "../types";

// SofaScore has public JSON endpoints (no API key). They are unofficial and may change.
const SOFASCORE_BASE = "https://api.sofascore.com/api/v1";

type SofaScoreEvent = any;

function safeStr(v: any, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function mapStatus(event: SofaScoreEvent): { status: string; minute?: string; score?: string } {
  const type = safeStr(event?.status?.type).toLowerCase();
  const description = safeStr(event?.status?.description);
  const home = event?.homeScore?.current;
  const away = event?.awayScore?.current;

  const score =
    Number.isFinite(home) && Number.isFinite(away) ? `${home}-${away}` : "v";

  // Minute: SofaScore provides current minute as "time.current" for some events.
  const min = event?.time?.current;
  const minute = Number.isFinite(min) ? `${min}'` : undefined;

  if (type === "finished") return { status: "FT", score };
  if (type === "inprogress") return { status: description || "LIVE", minute, score };
  if (type === "notstarted") return { status: "NS", score: "v" };
  return { status: description || event?.status?.type || "", minute, score };
}

function mapLeague(event: SofaScoreEvent): string {
  const tournament = safeStr(event?.tournament?.name);
  const category = safeStr(event?.tournament?.category?.name);
  if (tournament && category) return `${category} — ${tournament}`;
  return tournament || category || "Unknown";
}

function mapEventToMatch(dateISO: string, event: SofaScoreEvent): Match {
  const home = safeStr(event?.homeTeam?.name, "Home");
  const away = safeStr(event?.awayTeam?.name, "Away");
  const homeId = String(event?.homeTeam?.id ?? home).toLowerCase();
  const awayId = String(event?.awayTeam?.id ?? away).toLowerCase();

  const startTs = event?.startTimestamp;
  const kickoff = Number.isFinite(startTs)
    ? new Date(startTs * 1000).toISOString()
    : new Date().toISOString();

  const { status, minute, score } = mapStatus(event);

  // Logo: SofaScore provides team IDs; we can use their public image CDN.
  const homeLogo = event?.homeTeam?.id
    ? `https://api.sofascore.app/api/v1/team/${event.homeTeam.id}/image`
    : `https://picsum.photos/seed/${encodeURIComponent(home)}/64`;
  const awayLogo = event?.awayTeam?.id
    ? `https://api.sofascore.app/api/v1/team/${event.awayTeam.id}/image`
    : `https://picsum.photos/seed/${encodeURIComponent(away)}/64`;

  return {
    id: `ss-${event?.id ?? `${home}-${away}-${kickoff}`}`,
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

async function fetchJson(url: string, signal?: AbortSignal) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      // Some CDNs are picky; a basic accept header helps.
      Accept: "application/json",
    },
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function storageKey(dateISO: string) {
  return `footypredict_cache_matches_${dateISO}`;
}

function readCache(dateISO: string, maxAgeMs: number): Match[] | null {
  try {
    const raw = localStorage.getItem(storageKey(dateISO));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || !Array.isArray(parsed?.data)) return null;
    if (Date.now() - parsed.ts > maxAgeMs) return null;
    return parsed.data as Match[];
  } catch {
    return null;
  }
}

function writeCache(dateISO: string, data: Match[]) {
  try {
    localStorage.setItem(storageKey(dateISO), JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // ignore
  }
}

/**
 * Fetch all football matches for a specific date (YYYY-MM-DD).
 * Also merges live event data to ensure minute/score stays current.
 */
export async function fetchMatchesForDate(dateISO: string, signal?: AbortSignal): Promise<Match[]> {
  // Cache strategy:
  // - Scheduled list changes slowly; cache for 5 minutes.
  // - Live list changes fast; we always fetch live and merge.
  const cached = readCache(dateISO, 5 * 60 * 1000);

  let scheduled: Match[] = cached ?? [];
  if (!cached) {
    const url = `${SOFASCORE_BASE}/sport/football/scheduled-events/${dateISO}`;
    const json = await fetchJson(url, signal);
    const events: SofaScoreEvent[] = json?.events ?? [];
    scheduled = events.map((e) => mapEventToMatch(dateISO, e));
    writeCache(dateISO, scheduled);
  }

  // Live merge
  let live: Match[] = [];
  try {
    const liveUrl = `${SOFASCORE_BASE}/sport/football/events/live`;
    const liveJson = await fetchJson(liveUrl, signal);
    const liveEvents: SofaScoreEvent[] = liveJson?.events ?? [];
    live = liveEvents.map((e) => mapEventToMatch(dateISO, e));
  } catch {
    // If live endpoint fails, still show scheduled.
  }

  const byId = new Map<string, Match>();
  for (const m of scheduled) byId.set(m.id, m);
  for (const m of live) {
    const existing = byId.get(m.id);
    byId.set(m.id, existing ? { ...existing, ...m } : m);
  }

  // Sort by kickoff
  return Array.from(byId.values()).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}
