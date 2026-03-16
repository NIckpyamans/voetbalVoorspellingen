import { Match, Prediction, PredictionMemory, Team } from "../types";
import { calculatePrediction } from "../utils/predictionEngine";

type TeamStoreEntry = {
  id: string; name: string; league: string; logo: string;
  elo: number; attack: number; defense: number; lastUpdated: number;
};

const TEAM_STORE_KEY = "footypredict_team_store_v1";
const MEMORY_KEY     = "footypredict_memory";
// Geen limiet meer — sla alles op
const MEMORY_LIMIT   = 999999;

function readTeamStore(): Record<string, TeamStoreEntry> {
  try { return JSON.parse(localStorage.getItem(TEAM_STORE_KEY) || "{}"); } catch { return {}; }
}
function writeTeamStore(store: Record<string, TeamStoreEntry>) {
  try { localStorage.setItem(TEAM_STORE_KEY, JSON.stringify(store)); } catch {}
}
function teamKey(teamId: string, teamName: string) {
  return teamId ? `id:${teamId}` : `name:${teamName.toLowerCase()}`;
}

export function getOrCreateTeam(params: { id: string; name: string; league: string; logo: string; }): Team {
  const store = readTeamStore();
  const key = teamKey(params.id, params.name);
  if (!store[key]) {
    store[key] = { id: params.id, name: params.name, league: params.league, logo: params.logo,
      elo: 1500, attack: 1.5, defense: 1.5, lastUpdated: Date.now() };
    writeTeamStore(store);
  } else {
    store[key] = { ...store[key], id: params.id || store[key].id, name: params.name || store[key].name,
      league: params.league || store[key].league, logo: params.logo || store[key].logo };
    writeTeamStore(store);
  }
  const t = store[key];
  return { id: t.id, name: t.name, league: t.league, elo: t.elo, attack: t.attack, defense: t.defense, logo: t.logo };
}

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
function expectedScore(eloA: number, eloB: number) { return 1 / (1 + Math.pow(10, (eloB - eloA) / 400)); }

export function updateTeamModelsFromResult(match: Match, home: Team, away: Team) {
  if (!match.score?.includes("-")) return;
  const [hG, aG] = match.score.split("-").map(x => Number(x.trim()));
  if (!Number.isFinite(hG) || !Number.isFinite(aG)) return;
  const store = readTeamStore();
  const homeK = teamKey(home.id, home.name);
  const awayK = teamKey(away.id, away.name);
  const homeEntry = store[homeK], awayEntry = store[awayK];
  if (!homeEntry || !awayEntry) return;
  const k = 22;
  const homeExp = expectedScore(homeEntry.elo, awayEntry.elo);
  const homeAct = hG === aG ? 0.5 : hG > aG ? 1 : 0;
  homeEntry.elo += k * (homeAct - homeExp);
  awayEntry.elo += k * ((1 - homeAct) - (1 - homeExp));
  const alpha = 0.06, avgGoals = 1.35;
  homeEntry.attack  = clamp(homeEntry.attack  * (1-alpha) + (hG/avgGoals) * alpha, 0.6, 3.0);
  homeEntry.defense = clamp(homeEntry.defense * (1-alpha) + (aG/avgGoals) * alpha, 0.6, 3.0);
  awayEntry.attack  = clamp(awayEntry.attack  * (1-alpha) + (aG/avgGoals) * alpha, 0.6, 3.0);
  awayEntry.defense = clamp(awayEntry.defense * (1-alpha) + (hG/avgGoals) * alpha, 0.6, 3.0);
  homeEntry.lastUpdated = awayEntry.lastUpdated = Date.now();
  store[homeK] = homeEntry; store[awayK] = awayEntry;
  writeTeamStore(store);
}

export async function getEnhancedPrediction(match: Match): Promise<Prediction> {
  const home = getOrCreateTeam({ id: match.homeTeamId, name: match.homeTeamName, league: match.league, logo: match.homeLogo });
  const away = getOrCreateTeam({ id: match.awayTeamId, name: match.awayTeamName, league: match.league, logo: match.awayLogo });
  const base = calculatePrediction(home, away);
  const memory = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]") as PredictionMemory[];
  const relevant = memory.filter(m => m.matchId.startsWith("ss-") && m.actual.includes("-") && m.prediction.includes("-")).slice(-80);
  let bias = 0;
  if (relevant.length >= 10) {
    const errors = relevant.map(m => {
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
  const memory = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]") as any[];
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
    // Sla teamnamen en competitie op voor betere weergave
    homeTeam: match?.homeTeamName || null,
    awayTeam: match?.awayTeamName || null,
    league: match?.league || null,
  });
  // Geen 500 limiet meer — bewaar alles
  localStorage.setItem(MEMORY_KEY, JSON.stringify(memory.slice(-MEMORY_LIMIT)));
}
