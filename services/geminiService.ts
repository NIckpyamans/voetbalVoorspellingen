import { Match, Prediction, PredictionMemory, Team } from "../types";
import { calculatePrediction } from "../utils/predictionEngine";

// --- Local "AI" (no API keys) -------------------------------------------------
// We use a lightweight, fully local model:
// - Per-team ratings (Elo) + attack/defense coefficients
// - Poisson score model (already implemented in predictionEngine.ts)
// - Online learning: update team parameters after every finished match

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

function readTeamStore(): Record<string, TeamStoreEntry> {
  try {
    return JSON.parse(localStorage.getItem(TEAM_STORE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeTeamStore(store: Record<string, TeamStoreEntry>) {
  try {
    localStorage.setItem(TEAM_STORE_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

function teamKey(teamId: string, teamName: string) {
  // Prefer numeric SofaScore IDs (stable). Fallback to name.
  return teamId ? `id:${teamId}` : `name:${teamName.toLowerCase()}`;
}

export function getOrCreateTeam(params: {
  id: string;
  name: string;
  league: string;
  logo: string;
}): Team {
  const store = readTeamStore();
  const key = teamKey(params.id, params.name);

  if (!store[key]) {
    store[key] = {
      id: params.id,
      name: params.name,
      league: params.league,
      logo: params.logo,
      elo: 1500,
      // Start around league average; the learning will adjust.
      attack: 1.5,
      defense: 1.5,
      lastUpdated: Date.now(),
    };
    writeTeamStore(store);
  } else {
    // Keep metadata fresh (names/logos can vary).
    store[key] = {
      ...store[key],
      id: params.id || store[key].id,
      name: params.name || store[key].name,
      league: params.league || store[key].league,
      logo: params.logo || store[key].logo,
    };
    writeTeamStore(store);
  }

  const t = store[key];
  return {
    id: t.id,
    name: t.name,
    league: t.league,
    elo: t.elo,
    attack: t.attack,
    defense: t.defense,
    logo: t.logo,
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function expectedScore(eloA: number, eloB: number) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

export function updateTeamModelsFromResult(match: Match, home: Team, away: Team) {
  if (!match.score || !match.score.includes("-")) return;
  const [hG, aG] = match.score.split("-").map((x) => Number(x.trim()));
  if (!Number.isFinite(hG) || !Number.isFinite(aG)) return;

  const store = readTeamStore();
  const homeK = teamKey(home.id, home.name);
  const awayK = teamKey(away.id, away.name);
  const homeEntry = store[homeK];
  const awayEntry = store[awayK];
  if (!homeEntry || !awayEntry) return;

  // --- Elo update (result-based) ---
  const k = 22;
  const homeExp = expectedScore(homeEntry.elo, awayEntry.elo);
  const awayExp = 1 - homeExp;
  const homeAct = hG === aG ? 0.5 : hG > aG ? 1 : 0;
  const awayAct = 1 - homeAct;

  homeEntry.elo = homeEntry.elo + k * (homeAct - homeExp);
  awayEntry.elo = awayEntry.elo + k * (awayAct - awayExp);

  // --- Attack/Defense update (goal-based) ---
  // Simple online learning: exponential moving average towards observed goals.
  // This keeps the app stable while still improving over time.
  const alpha = 0.06; // learning rate
  const avgGoals = 1.35;

  // Attack moves towards goals scored; defense moves towards goals conceded.
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

// --- Public API (kept name-compatible with the previous Gemini version) -------

export async function getEnhancedPrediction(match: Match): Promise<Prediction> {
  const home = getOrCreateTeam({
    id: match.homeTeamId,
    name: match.homeTeamName,
    league: match.league,
    logo: match.homeLogo,
  });
  const away = getOrCreateTeam({
    id: match.awayTeamId,
    name: match.awayTeamName,
    league: match.league,
    logo: match.awayLogo,
  });

  const base = calculatePrediction(home, away);

  // Add a small memory-based tweak: if we've historically under/over-shot this matchup,
  // nudge the predicted goals slightly.
  const memory = JSON.parse(localStorage.getItem("footypredict_memory") || "[]") as PredictionMemory[];
  const relevant = memory
    .filter((m) => m.matchId.startsWith("ss-") && m.actual.includes("-") && m.prediction.includes("-"))
    .slice(-80);

  // Global bias correction (very light)
  let bias = 0;
  if (relevant.length >= 10) {
    const errors = relevant.map((m) => {
      const [pH, pA] = m.prediction.split("-").map(Number);
      const [aH, aA] = m.actual.split("-").map(Number);
      return (aH + aA) - (pH + pA);
    });
    bias = errors.reduce((a, b) => a + b, 0) / errors.length;
    bias = clamp(bias, -0.25, 0.25);
  }

  const predHomeGoals = clamp(Math.round(base.predHomeGoals + bias * 0.5), 0, 6);
  const predAwayGoals = clamp(Math.round(base.predAwayGoals + bias * 0.5), 0, 6);

  return {
    ...base,
    matchId: match.id,
    predHomeGoals,
    predAwayGoals,
    analysis:
      "Local AI: Elo + Poisson model. Learns from finished matches stored in your browser (no API keys).",
    learningNote: relevant.length
      ? `Bias correction based on last ${relevant.length} finished matches.`
      : "No historical bias yet.",
  };
}

export function saveToMemory(matchId: string, predScore: string, actualScore: string) {
  const memory = JSON.parse(localStorage.getItem("footypredict_memory") || "[]") as PredictionMemory[];
  const wasCorrect = predScore.trim() === actualScore.trim();
  const [pH, pA] = predScore.split("-").map(Number);
  const [aH, aA] = actualScore.split("-").map(Number);
  const errorMargin = Math.abs(pH - aH) + Math.abs(pA - aA);

  const newEntry: PredictionMemory = {
    matchId,
    prediction: predScore,
    actual: actualScore,
    wasCorrect,
    errorMargin,
    timestamp: Date.now(),
  };

  memory.push(newEntry);
  localStorage.setItem("footypredict_memory", JSON.stringify(memory.slice(-500)));
}
