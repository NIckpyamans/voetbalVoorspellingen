import { Match, Prediction, PredictionMemory, Team } from "../types";
import { calculatePrediction } from "../utils/predictionEngine";

type TeamStoreEntry = {
  id: string;
  name: string;
  league: string;
  logo: string;
  elo: number;
  attack: number;
  defense: number;
  lastUpdated: number;
};

const TEAM_STORE_KEY = "footypredict_team_store_v1";
const MEMORY_KEY = "footypredict_memory";
const MEMORY_LIMIT = 1400;
const TEAM_STORE_LIMIT = 900;
const TEAM_STORE_MAX_AGE = 180 * 24 * 60 * 60 * 1000;

function pruneTeamStore(store: Record<string, TeamStoreEntry>) {
  const now = Date.now();
  const entries = Object.entries(store)
    .filter(([, entry]) => now - Number(entry?.lastUpdated || 0) <= TEAM_STORE_MAX_AGE)
    .sort((a, b) => Number(b[1]?.lastUpdated || 0) - Number(a[1]?.lastUpdated || 0))
    .slice(0, TEAM_STORE_LIMIT);
  return Object.fromEntries(entries);
}

function readTeamStore(): Record<string, TeamStoreEntry> {
  try {
    return pruneTeamStore(JSON.parse(localStorage.getItem(TEAM_STORE_KEY) || "{}"));
  } catch {
    return {};
  }
}

function writeTeamStore(store: Record<string, TeamStoreEntry>) {
  try {
    localStorage.setItem(TEAM_STORE_KEY, JSON.stringify(pruneTeamStore(store)));
  } catch {}
}

function readMemory(): PredictionMemory[] {
  try {
    return JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function compactMemory(items: PredictionMemory[]) {
  const latestByMatch = new Map<string, PredictionMemory>();
  for (const item of items || []) {
    if (!item?.matchId) continue;
    const existing = latestByMatch.get(item.matchId);
    if (!existing || Number(item.timestamp || 0) >= Number(existing.timestamp || 0)) {
      latestByMatch.set(item.matchId, {
        matchId: item.matchId,
        prediction: item.prediction,
        actual: item.actual,
        wasCorrect: !!item.wasCorrect,
        errorMargin: Number(item.errorMargin || 0),
        timestamp: Number(item.timestamp || Date.now()),
        homeTeam: (item as any).homeTeam || null,
        awayTeam: (item as any).awayTeam || null,
        league: (item as any).league || null,
      } as PredictionMemory);
    }
  }

  return [...latestByMatch.values()]
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
    .slice(-MEMORY_LIMIT);
}

function writeMemory(items: PredictionMemory[]) {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(compactMemory(items)));
  } catch {}
}

function teamKey(teamId: string, teamName: string) {
  return teamId ? `id:${teamId}` : `name:${teamName.toLowerCase()}`;
}

export function getOrCreateTeam(params: { id: string; name: string; league: string; logo: string }): Team {
  const store = readTeamStore();
  const key = teamKey(params.id, params.name);
  if (!store[key]) {
    store[key] = {
      id: params.id,
      name: params.name,
      league: params.league,
      logo: params.logo,
      elo: 1500,
      attack: 1.5,
      defense: 1.5,
      lastUpdated: Date.now(),
    };
    writeTeamStore(store);
  } else {
    store[key] = {
      ...store[key],
      id: params.id || store[key].id,
      name: params.name || store[key].name,
      league: params.league || store[key].league,
      logo: params.logo || store[key].logo,
      lastUpdated: Date.now(),
    };
    writeTeamStore(store);
  }
  const t = store[key];
  return { id: t.id, name: t.name, league: t.league, elo: t.elo, attack: t.attack, defense: t.defense, logo: t.logo };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function expectedScore(eloA: number, eloB: number) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

export function updateTeamModelsFromResult(match: Match, home: Team, away: Team) {
  if (!match.score?.includes("-")) return;
  const [hG, aG] = match.score.split("-").map((x) => Number(x.trim()));
  if (!Number.isFinite(hG) || !Number.isFinite(aG)) return;
  const store = readTeamStore();
  const homeK = teamKey(home.id, home.name);
  const awayK = teamKey(away.id, away.name);
  const homeEntry = store[homeK];
  const awayEntry = store[awayK];
  if (!homeEntry || !awayEntry) return;
  const k = 22;
  const homeExp = expectedScore(homeEntry.elo, awayEntry.elo);
  const homeAct = hG === aG ? 0.5 : hG > aG ? 1 : 0;
  homeEntry.elo += k * (homeAct - homeExp);
  awayEntry.elo += k * ((1 - homeAct) - (1 - homeExp));
  const alpha = 0.06;
  const avgGoals = 1.35;
  homeEntry.attack = clamp(homeEntry.attack * (1 - alpha) + (hG / avgGoals) * alpha, 0.6, 3.0);
  homeEntry.defense = clamp(homeEntry.defense * (1 - alpha) + (aG / avgGoals) * alpha, 0.6, 3.0);
  awayEntry.attack = clamp(awayEntry.attack * (1 - alpha) + (aG / avgGoals) * alpha, 0.6, 3.0);
  awayEntry.defense = clamp(awayEntry.defense * (1 - alpha) + (hG / avgGoals) * alpha, 0.6, 3.0);
  homeEntry.lastUpdated = Date.now();
  awayEntry.lastUpdated = Date.now();
  store[homeK] = homeEntry;
  store[awayK] = awayEntry;
  writeTeamStore(store);
}

export async function getEnhancedPrediction(match: Match): Promise<Prediction> {
  const home = getOrCreateTeam({ id: match.homeTeamId, name: match.homeTeamName, league: match.league, logo: match.homeLogo });
  const away = getOrCreateTeam({ id: match.awayTeamId, name: match.awayTeamName, league: match.league, logo: match.awayLogo });
  const base = calculatePrediction(home, away);
  const memory = compactMemory(readMemory());
  const relevant = memory
    .filter((m) => m.matchId.startsWith("ss-") && m.actual.includes("-") && m.prediction.includes("-"))
    .slice(-80);
  let bias = 0;
  if (relevant.length >= 10) {
    const errors = relevant.map((m) => {
      const [pH, pA] = m.prediction.split("-").map(Number);
      const [aH, aA] = m.actual.split("-").map(Number);
      return (aH + aA) - (pH + pA);
    });
    bias = clamp(errors.reduce((a, b) => a + b, 0) / errors.length, -0.25, 0.25);
  }
  return {
    ...base,
    matchId: match.id,
    predHomeGoals: clamp(Math.round(base.predHomeGoals + bias * 0.5), 0, 6),
    predAwayGoals: clamp(Math.round(base.predAwayGoals + bias * 0.5), 0, 6),
    analysis: "Lokaal Elo + Poisson model.",
  };
}

export function saveToMemory(matchId: string, predScore: string, actualScore: string, match?: Partial<Match>) {
  const memory = readMemory() as any[];
  const wasCorrect = predScore.trim() === actualScore.trim();
  const [pH, pA] = predScore.split("-").map(Number);
  const [aH, aA] = actualScore.split("-").map(Number);
  const errorMargin = Math.abs(pH - aH) + Math.abs(pA - aA);
  memory.push({
    matchId,
    prediction: predScore,
    actual: actualScore,
    wasCorrect,
    errorMargin,
    timestamp: Date.now(),
    homeTeam: match?.homeTeamName || null,
    awayTeam: match?.awayTeamName || null,
    league: match?.league || null,
  });
  writeMemory(memory as PredictionMemory[]);
}
