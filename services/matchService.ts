import { Match } from "../types";

// Alle SofaScore calls gaan via onze eigen Vercel API proxy
// zodat CORS geen probleem is. De browser praat alleen met /api/...
const PROXY_BASE = "/api";

type SofaScoreEvent = any;

function safeStr(v: any, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function mapStatus(event: SofaScoreEvent): { status: string; minute?: string; score?: string } {
  const type = safeStr(event?.status?.type).toLowerCase();
  const description = safeStr(event?.status?.description);
  const home = event?.homeScore?.current;
  const away = event?.awayScore?.current;
  const score = Number.isFinite(home) && Number.isFinite(away) ? `${home}-${away}` : "v";
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

function isEuropeanEvent(event: SofaScoreEvent): boolean {
  const europeanSet = new Set([
    'england','spain','italy','germany','france','netherlands','portugal','belgium',
    'scotland','turkey','switzerland','austria','greece','sweden','norway','denmark',
    'poland','czech republic','romania','ukraine','serbia','croatia','bosnia',
    'bulgaria','hungary','slovakia','slovenia','ireland','wales','finland'
  ]);
  const category = safeStr(event?.tournament?.category?.name).toLowerCase();
  const tname = safeStr(event?.tournament?.name).toLowerCase();
  if (tname.includes('uefa') || tname.includes('champions') || tname.includes('europa')) return true;
  if (category && europeanSet.has(category)) return true;
  for (const c of europeanSet) if (category.includes(c) || tname.includes(c)) return true;
  return false;
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
  } catch {}
}

export async function fetchMatchesForDate(dateISO: string, signal?: AbortSignal): Promise<Match[]> {
  const cached = readCache(dateISO, 5 * 60 * 1000);
  let scheduled: Match[] = cached ?? [];

  if (!cached) {
    try {
      // Via onze eigen proxy (voorkomt CORS blokkade)
      const res = await fetch(`${PROXY_BASE}/matches?date=${dateISO}`, { signal });
      if (res.ok) {
        const json = await res.json();
        const events: SofaScoreEvent[] = json?.events ?? [];
        const euEvents = events.filter(isEuropeanEvent);
        scheduled = euEvents.map((e) => mapEventToMatch(dateISO, e));
        writeCache(dateISO, scheduled);
      }
    } catch {
      // proxy ook gefaald, gebruik lege array
    }
  }

  // Live merge via proxy
  let live: Match[] = [];
  try {
    const liveRes = await fetch(`${PROXY_BASE}/matches?live=true`, { signal });
    if (liveRes.ok) {
      const liveJson = await liveRes.json();
      const liveEvents: SofaScoreEvent[] = liveJson?.events ?? [];
      live = liveEvents.filter(isEuropeanEvent).map((e) => mapEventToMatch(dateISO, e));
    }
  } catch {}

  const byId = new Map<string, Match>();
  for (const m of scheduled) byId.set(m.id, m);
  for (const m of live) {
    const existing = byId.get(m.id);
    byId.set(m.id, existing ? { ...existing, ...m } : m);
  }

  return Array.from(byId.values()).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}
