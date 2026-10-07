// Gewogen team-learning: recency × competitiebetrouwbaarheid. Vult
// store.weightedTeamLearning als aanvulling op de bestaande teamLearning-tellingen:
// zelfde sleutels (`id:<teamId>` / `name:<normalized>`), maar met EMA-gewichten zodat
// recente competitiewedstrijden zwaarder meetellen dan oude oefenwedstrijden.
import { competitionSegment } from "./competition-segmentation.js";
import { canonicalDedupeTeam } from "../../shared/matchNormalization.js";

// Recency en competitieniveau zijn de twee assen waarop historische duels
// betrouwbaar zijn: recente competitiewedstrijden zeggen het meest, oude
// oefenduels bijna niets. De halfwaardetijd is verkort van 120 naar 90 dagen
// zodat de vorm van deze maanden zwaarder telt dan die van vorig seizoen.
const HALF_LIFE_DAYS = 90;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value || 0)));

const SEGMENT_WEIGHTS = {
  regular_league: 1,
  knockout_cup: 0.65,
  friendly: 0.08,
  unknown: 0.45,
};

export const WEIGHTED_LEARNING_POLICY = Object.freeze({
  halfLifeDays: HALF_LIFE_DAYS,
  segmentWeights: { ...SEGMENT_WEIGHTS },
});

function segmentWeight(league) {
  const segment = competitionSegment({ league });
  return SEGMENT_WEIGHTS[segment] ?? SEGMENT_WEIGHTS.unknown;
}

function recencyWeight(kickoffOrDate, now) {
  const parsed = Date.parse(String(kickoffOrDate || ""));
  const ageDays = Number.isFinite(parsed) ? Math.max(0, (now - parsed) / 86400000) : 365;
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

function outcomeFromScore(score) {
  const match = String(score || "").match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return null;
  const home = Number(match[1]);
  const away = Number(match[2]);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away, outcome: home > away ? "H" : home < away ? "A" : "D" };
}

function emptyTeam(teamName) {
  return {
    teamName: String(teamName || "").trim(),
    weightedMatches: 0,
    rawMatches: 0,
    weightedPoints: 0,
    weightedGoalsFor: 0,
    weightedGoalsAgainst: 0,
    weightedOutcomeHits: 0,
    weightedModelHits: 0,
    lastKickoff: null,
  };
}

// Reviews bevatten both scores: predictedScore en actualScore. We leren van actualScore
// en vergelijken met predictedOutcome voor gewogen hit-metrics.
export function buildWeightedTeamLearning(reviews = {}, now = Date.now()) {
  const teams = new Map();
  const touch = (key, teamName) => {
    if (!teams.has(key)) teams.set(key, emptyTeam(teamName));
    return teams.get(key);
  };
  for (const review of Object.values(reviews || {})) {
    const actual = outcomeFromScore(review?.actualScore);
    if (!actual) continue;
    const weight = recencyWeight(review?.createdAt || review?.date, now) * segmentWeight(review?.league);
    if (weight <= 0.001) continue;
    const homeKey = canonicalDedupeTeam(review?.homeTeamName);
    const awayKey = canonicalDedupeTeam(review?.awayTeamName);
    const home = touch(`name:${homeKey}`, review?.homeTeamName);
    const away = touch(`name:${awayKey}`, review?.awayTeamName);
    const homePoints = actual.outcome === "H" ? 3 : actual.outcome === "D" ? 1 : 0;
    const awayPoints = actual.outcome === "A" ? 3 : actual.outcome === "D" ? 1 : 0;
    for (const [team, isHome] of [
      [home, true],
      [away, false],
    ]) {
      team.weightedMatches += weight;
      team.rawMatches += 1;
      team.weightedPoints += weight * (isHome ? homePoints : awayPoints);
      team.weightedGoalsFor += weight * (isHome ? actual.home : actual.away);
      team.weightedGoalsAgainst += weight * (isHome ? actual.away : actual.home);
      if (review?.outcomeHit) team.weightedModelHits += weight;
      const kickoff = Date.parse(String(review?.createdAt || review?.date || ""));
      if (Number.isFinite(kickoff) && (!team.lastKickoff || kickoff > team.lastKickoff)) team.lastKickoff = kickoff;
    }
  }
  const result = {};
  for (const [key, team] of teams.entries()) {
    const matches = team.weightedMatches || 1;
    result[key] = {
      teamName: team.teamName,
      weightedMatches: Number(team.weightedMatches.toFixed(2)),
      rawMatches: team.rawMatches,
      weightedPpg: Number((team.weightedPoints / matches).toFixed(3)),
      weightedGoalsFor: Number((team.weightedGoalsFor / matches).toFixed(2)),
      weightedGoalsAgainst: Number((team.weightedGoalsAgainst / matches).toFixed(2)),
      weightedOutcomeHitRate: Number((team.weightedModelHits / matches).toFixed(3)),
      formSignal: Number(
        ((team.weightedPoints / matches - 1.35) / 1.65).toFixed(3) // ~-0.8..+1.0 signal
      ),
      lastKickoff: team.lastKickoff ? new Date(team.lastKickoff).toISOString() : null,
    };
  }
  return result;
}
