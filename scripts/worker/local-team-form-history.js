import { canonicalDedupeTeam } from "../../shared/matchNormalization.js";
import { extractGoalTimingFromMatch, summarizeGoalTiming } from "./goal-timing.js";

function scoreFor(match) {
  const score = String(match?.score || "").match(/^(\d+)\s*-\s*(\d+)$/);
  if (score) return [Number(score[1]), Number(score[2])];
  const home = Number(match?.homeScore);
  const away = Number(match?.awayScore);
  return match?.homeScore != null && match?.awayScore != null && Number.isFinite(home) && Number.isFinite(away)
    ? [home, away]
    : null;
}

// Relevantie van een afgerond duel voor de vorm van vandaag. Oefenduels zijn
// nauwelijks voorspellend (de reviewdiagnose laat voor friendlies geen enkele
// betrouwbare treffer zien) en tellen daarom bijna niet mee; beker- en
// kwalificatieduels zijn door rotatie en tweeluiken ruiziger dan competitieduels.
const FRIENDLY_WEIGHT = 0.15;
const CUP_WEIGHT = 0.7;

function competitionWeight(league) {
  const text = String(league || "");
  if (/friendl|oefen/i.test(text)) return FRIENDLY_WEIGHT;
  if (/cup|pokal|coupe|beker|knockout|play-?off|qualif/i.test(text)) return CUP_WEIGHT;
  return 1;
}

function isCompletedBefore(match, now) {
  if (!["FT", "AET", "PEN"].includes(String(match?.status || "").toUpperCase())) return false;
  const kickoff = Date.parse(match?.kickoff || match?.date || "");
  return !Number.isFinite(kickoff) || kickoff <= now;
}

function addTeamResult(index, teamName, opponent, match, goalsFor, goalsAgainst, venue) {
  const key = canonicalDedupeTeam(teamName);
  if (!key) return;
  const item = {
    date: String(match?.date || match?.kickoff || "").slice(0, 10) || null,
    kickoff: match?.kickoff || null,
    eventId: String(match?.id || "") || null,
    league: match?.league || null,
    venue,
    opponent: String(opponent || "").trim(),
    opponentId: "",
    score: `${goalsFor}-${goalsAgainst}`,
    goalsFor,
    goalsAgainst,
    result: goalsFor > goalsAgainst ? "W" : goalsFor === goalsAgainst ? "D" : "L",
    source: `local-finished-results:${match?.dataSource || match?.source || "worker"}`,
    friendly: /friendl|oefen/i.test(String(match?.league || "")),
    weight: competitionWeight(match?.league),
    opponentStrength: Number(match?.[venue === "H" ? "awayClubStrength" : "homeClubStrength"] || match?.[venue === "H" ? "awayClubElo" : "homeClubElo"] || 0) || null,
    xGFor: Number(match?.postMatchStats?.[venue === "H" ? "home" : "away"]?.xG ?? match?.liveStats?.[venue === "H" ? "home" : "away"]?.xG),
    xGAgainst: Number(match?.postMatchStats?.[venue === "H" ? "away" : "home"]?.xG ?? match?.liveStats?.[venue === "H" ? "away" : "home"]?.xG),
    shotsFor: Number(match?.postMatchStats?.[venue === "H" ? "home" : "away"]?.shots ?? match?.liveStats?.[venue === "H" ? "home" : "away"]?.shots),
    shotsAgainst: Number(match?.postMatchStats?.[venue === "H" ? "away" : "home"]?.shots ?? match?.liveStats?.[venue === "H" ? "away" : "home"]?.shots),
    goalQuartersFor: extractGoalTimingFromMatch(match, venue === "H" ? "home" : "away"),
    goalQuartersAgainst: extractGoalTimingFromMatch(match, venue === "H" ? "away" : "home"),
  };
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(item);
}

export function buildLocalTeamFormIndex(dayPayloads, options = {}) {
  const now = Number(options.now || Date.now());
  const index = new Map();
  for (const day of dayPayloads || []) {
    for (const match of day?.matches || []) {
      const score = scoreFor(match);
      if (!score || !isCompletedBefore(match, now)) continue;
      addTeamResult(index, match.homeTeamName, match.awayTeamName, match, score[0], score[1], "H");
      addTeamResult(index, match.awayTeamName, match.homeTeamName, match, score[1], score[0], "A");
    }
  }
  for (const [key, matches] of index.entries()) {
    const unique = new Map();
    for (const match of matches) {
      const identity = `${match.date || ""}|${canonicalDedupeTeam(match.opponent)}|${match.venue || ""}|${match.score}`;
      if (!unique.has(identity)) unique.set(identity, match);
    }
    index.set(key, [...unique.values()].sort((a, b) => String(a.kickoff || a.date || "").localeCompare(String(b.kickoff || b.date || ""))));
  }
  return index;
}

function weightedAverage(matches, selector) {
  const values = matches
    .map((match) => ({ value: Number(selector(match)), weight: Number(match?.weight || 1) }))
    .filter((item) => Number.isFinite(item.value) && item.weight > 0);
  const weight = values.reduce((sum, item) => sum + item.weight, 0);
  return weight ? Number((values.reduce((sum, item) => sum + item.value * item.weight, 0) / weight).toFixed(3)) : null;
}

function summarizeMatches(matches) {
  const points = (match) => match.result === "W" ? 3 : match.result === "D" ? 1 : 0;
  const playedWeight = matches.reduce((sum, match) => sum + Number(match?.weight || 1), 0);
  return {
    games: matches.length,
    weightedGames: Number(playedWeight.toFixed(2)),
    wins: matches.filter((match) => match.result === "W").length,
    draws: matches.filter((match) => match.result === "D").length,
    losses: matches.filter((match) => match.result === "L").length,
    pointsPerGame: playedWeight ? Number((matches.reduce((sum, match) => sum + points(match) * Number(match?.weight || 1), 0) / playedWeight).toFixed(3)) : 0,
    avgScored: weightedAverage(matches, (match) => match.goalsFor),
    avgConceded: weightedAverage(matches, (match) => match.goalsAgainst),
    xG: weightedAverage(matches, (match) => match.xGFor),
    xGA: weightedAverage(matches, (match) => match.xGAgainst),
    shotsFor: weightedAverage(matches, (match) => match.shotsFor),
    shotsAgainst: weightedAverage(matches, (match) => match.shotsAgainst),
    opponentStrength: weightedAverage(matches, (match) => match.opponentStrength),
  };
}

function summarizeMatchesWithDecay(matches, halfLifeMatches = 5) {
  const size = matches.length;
  const weighted = matches.map((match, index) => ({
    ...match,
    weight: Number(match?.weight || 1) * Math.pow(0.5, (size - 1 - index) / Math.max(1, halfLifeMatches)),
  }));
  return summarizeMatches(weighted);
}

// De kop-statistieken (punten, doelpunten, xG) zijn recency-gewogen met een
// halfwaardetijd van 3 duels: de vorm van de laatste weken weegt zwaarder dan
// die van twee maanden geleden. De expliciete last5/last10/last20-vensters
// blijven vlak, zodat die features vergelijkbaar en uitlegbaar blijven.
const HEADLINE_RECENCY_HALF_LIFE = 3;

export function summarizeLocalTeamForm(recentMatches = []) {
  const last20 = recentMatches.slice(-20);
  const last10 = last20.slice(-10);
  const home = last10.filter((match) => match.venue === "H");
  const away = last10.filter((match) => match.venue === "A");
  const overall = summarizeMatchesWithDecay(last10, HEADLINE_RECENCY_HALF_LIFE);
  return {
    gamesPlayed: last10.length,
    pointsPerGame: overall.pointsPerGame,
    avgScored: overall.avgScored,
    avgConceded: overall.avgConceded,
    xG: overall.xG,
    xGA: overall.xGA,
    shotsFor: overall.shotsFor,
    shotsAgainst: overall.shotsAgainst,
    opponentStrength: overall.opponentStrength,
    last5: summarizeMatches(last10.slice(-5)),
    last10: summarizeMatches(last10),
    last20: summarizeMatches(last20),
    recencyWeighted: summarizeMatchesWithDecay(last20, 5),
    splits: { home: summarizeMatches(home), away: summarizeMatches(away) },
    friendlyMatches: last10.filter((match) => match.friendly).length,
    weightingPolicy: `recency-gewogen kopstatistieken (halfwaardetijd ${HEADLINE_RECENCY_HALF_LIFE} duels); competitie=1, beker=${CUP_WEIGHT}, oefen=${FRIENDLY_WEIGHT}`,
  };
}

export function dayPayloadsFromSnapshotLedger(ledger = {}) {
  const snapshots = ledger?.predictionSnapshots || {};
  const evaluations = ledger?.evaluations || {};
  const days = new Map();
  for (const [predictionId, evaluation] of Object.entries(evaluations)) {
    const snapshot = snapshots[predictionId];
    if (!snapshot || !evaluation) continue;
    if (evaluation.finalHomeGoals == null || evaluation.finalAwayGoals == null) continue;
    const homeScore = Number(evaluation.finalHomeGoals);
    const awayScore = Number(evaluation.finalAwayGoals);
    if (![homeScore, awayScore].every(Number.isFinite)) continue;
    const date = String(snapshot.date || snapshot.kickoff || evaluation.kickoff || "").slice(0, 10);
    const homeTeamName = snapshot.homeTeam || snapshot.prediction?.homeTeam;
    const awayTeamName = snapshot.awayTeam || snapshot.prediction?.awayTeam;
    if (!date || !homeTeamName || !awayTeamName) continue;
    const match = {
      id: snapshot.matchId || evaluation.matchId,
      date,
      kickoff: snapshot.kickoff || evaluation.kickoff || `${date}T12:00:00.000Z`,
      league: snapshot.league || snapshot.prediction?.league || null,
      homeTeamName,
      awayTeamName,
      homeScore,
      awayScore,
      score: `${homeScore}-${awayScore}`,
      status: "FT",
      dataSource: evaluation.evaluationSource || "immutable-snapshot-ledger",
    };
    if (!days.has(date)) days.set(date, { date, matches: [] });
    days.get(date).matches.push(match);
  }
  return [...days.values()];
}

export function dayPayloadsFromHistorySummary(history = {}) {
  const days = new Map();
  for (const review of Object.values(history?.postMatchReviews || {})) {
    const score = String(review?.actualScore || "").match(/^(\d+)\s*-\s*(\d+)$/);
    const date = String(review?.date || "").slice(0, 10);
    if (!score || !date || !review?.homeTeamName || !review?.awayTeamName) continue;
    const match = {
      id: review.matchId || review.predictionId,
      date,
      kickoff: review.kickoff || `${date}T12:00:00.000Z`,
      league: review.league || null,
      homeTeamName: review.homeTeamName,
      awayTeamName: review.awayTeamName,
      homeScore: Number(score[1]),
      awayScore: Number(score[2]),
      score: `${score[1]}-${score[2]}`,
      status: "FT",
      dataSource: review.evaluationSource || "immutable-history-summary",
    };
    if (!days.has(date)) days.set(date, { date, matches: [] });
    days.get(date).matches.push(match);
  }
  return [...days.values()];
}

export function mergeLocalTeamForm(profile, localMatches, teamName, options = {}) {
  const limit = Math.max(1, Number(options.limit || 20));
  const current = Array.isArray(profile?.recentMatches) ? profile.recentMatches : [];
  const unique = new Map();
  for (const match of [...current, ...(localMatches || [])]) {
    const identity = `${match?.date || ""}|${canonicalDedupeTeam(match?.opponent)}|${match?.venue || ""}|${match?.score || ""}`;
    if (!unique.has(identity)) unique.set(identity, match);
  }
  const recentMatches = [...unique.values()]
    .sort((a, b) => String(a?.kickoff || a?.date || "").localeCompare(String(b?.kickoff || b?.date || "")))
    .slice(-limit);
  if (!recentMatches.length) return profile || null;
  const goalTiming = summarizeGoalTiming(recentMatches, profile?.goalTiming?.scored);
  const summary = summarizeLocalTeamForm(recentMatches);
  const sources = new Set(String(profile?.source || "").split("+").filter(Boolean));
  sources.add("local-finished-results");
  return {
    ...(profile || {}),
    providerTeamName: profile?.providerTeamName || teamName,
    recentMatches,
    ...summary,
    goalTiming,
    source: [...sources].join("+"),
    asOf: new Date(Number(options.now || Date.now())).toISOString(),
  };
}

export function mergePersistedTeamFormCache(storedCache, persistedCache) {
  return {
    ...(storedCache || {}),
    ...(persistedCache || {}),
  };
}
