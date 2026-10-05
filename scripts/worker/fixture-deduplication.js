import {
  H2H_PROVENANCE_FIELDS,
  h2hProvenanceRank,
  mergeMatchH2HProvenance,
  normalizeMatchH2H,
  synchronizeMatchPredictionH2H,
} from "../../shared/h2hProvenance.js";

export { h2hProvenanceRank };

export function storedMatchQuality(match) {
  const status = String(match?.status || "").toUpperCase();
  const hasScore = Number.isFinite(Number(match?.homeScore)) && Number.isFinite(Number(match?.awayScore));
  const statusScore = status === "FT" ? 70 : status === "LIVE" || status === "HT" ? 55 : status === "RESULT_PENDING" ? 20 : status === "NS" ? 8 : 0;
  const sourceText = String(match?.dataSource || "");
  const sourceScore = /fotmob/i.test(sourceText) ? 10 : /espn/i.test(sourceText) ? 9 : /thesportsdb/i.test(sourceText) ? 7 : /sky/i.test(sourceText) ? 6 : /openligadb/i.test(sourceText) ? 5 : /football-data/i.test(sourceText) ? 4 : /bbc/i.test(sourceText) ? 2 : 1;
  return statusScore + (hasScore ? 35 : 0) + Number(Boolean(match?.homeLogo)) + Number(Boolean(match?.awayLogo)) + sourceScore + Number(match?.dataCompletenessScore || 0) * 10;
}

export function buildStoredMatchDedupeKey(match, options) {
  const dateKey = String(match?.date || match?.kickoff || "").slice(0, 10);
  const home = options.teamKey(match?.homeTeamName || match?.homeTeam || "");
  const away = options.teamKey(match?.awayTeamName || match?.awayTeam || "");
  if (!dateKey || !home || !away) return "";
  // Provider competition labels are less stable than the fixture itself. The
  // same clubs cannot play each other twice on one date, so a wrong league
  // label must not allow a duplicate fixture into the canonical store.
  return `${dateKey}|${home}|${away}`;
}

export function mergeStoredDuplicateMatch(current, incoming) {
  current = normalizeMatchH2H(current);
  incoming = normalizeMatchH2H(incoming);
  const incomingPreferred = storedMatchQuality(incoming) > storedMatchQuality(current);
  const preferred = incomingPreferred ? { ...incoming } : { ...current };
  const fallback = incomingPreferred ? current : incoming;
  preferred.homeLogo ||= fallback?.homeLogo || "";
  preferred.awayLogo ||= fallback?.awayLogo || "";
  preferred.homeTeamId ||= fallback?.homeTeamId || "";
  preferred.awayTeamId ||= fallback?.awayTeamId || "";
  const h2hWinner = h2hProvenanceRank(fallback?.h2h) > h2hProvenanceRank(preferred?.h2h) ? fallback : preferred;
  preferred.h2h = h2hWinner?.h2h || preferred.h2h || fallback?.h2h || null;
  const mergedH2H = mergeMatchH2HProvenance(
    { ...preferred, h2h: preferred.h2h || h2hWinner?.h2h },
    fallback,
  );
  preferred.h2h = mergedH2H?.h2h || preferred.h2h;
  for (const field of H2H_PROVENANCE_FIELDS) {
    if (mergedH2H?.[field] !== undefined) preferred[field] = mergedH2H[field];
    else delete preferred[field];
  }
  const recentCount = (value) => Number(value?.gamesPlayed || value?.recentMatches?.length || 0);
  preferred.homeRecent = recentCount(preferred.homeRecent) >= recentCount(fallback?.homeRecent) ? preferred.homeRecent : fallback?.homeRecent;
  preferred.awayRecent = recentCount(preferred.awayRecent) >= recentCount(fallback?.awayRecent) ? preferred.awayRecent : fallback?.awayRecent;
  const lineupQuality = (value) => value?.confirmed ? 3 : value?.projected ? 2 : value?.home || value?.away ? 1 : 0;
  preferred.lineupSummary = lineupQuality(preferred.lineupSummary) >= lineupQuality(fallback?.lineupSummary) ? preferred.lineupSummary : fallback?.lineupSummary;
  const objectRichness = (value) => value && typeof value === "object"
    ? Object.values(value).filter((item) => item != null && item !== "" && item !== 0 && (!Array.isArray(item) || item.length)).length
    : 0;
  for (const field of ["postMatchStats", "liveStats", "homeSeasonStats", "awaySeasonStats", "homeTeamProfile", "awayTeamProfile", "refereeProfile", "aggregate", "sourceAsOf", "providerDiagnostics", "oddsAtPrediction", "odds", "marketCalibration"]) {
    if (objectRichness(fallback?.[field]) > objectRichness(preferred?.[field])) preferred[field] = fallback[field];
  }
  for (const field of ["events", "goalEvents", "goalMinuteEvents", "cards", "incidents"]) {
    if ((fallback?.[field]?.length || 0) > (preferred?.[field]?.length || 0)) preferred[field] = fallback[field];
  }
  preferred.goalMinuteEventsUpdatedAt = Math.max(Number(preferred.goalMinuteEventsUpdatedAt || 0), Number(fallback?.goalMinuteEventsUpdatedAt || 0)) || undefined;
  preferred.dataSource = [...new Set([preferred.dataSource, fallback?.dataSource].filter(Boolean))].join("+");
  const preferredHasScore = Number.isFinite(Number(preferred.homeScore)) && Number.isFinite(Number(preferred.awayScore));
  const fallbackHasScore = Number.isFinite(Number(fallback?.homeScore)) && Number.isFinite(Number(fallback?.awayScore));
  if (!preferredHasScore && fallbackHasScore) {
    preferred.homeScore = fallback.homeScore;
    preferred.awayScore = fallback.awayScore;
    preferred.score = fallback.score;
    preferred.status = fallback.status || preferred.status;
  }
  return preferred;
}

export function dedupeStoredMatches(matches = [], options) {
  const seen = new Map();
  for (const match of matches || []) {
    const key = buildStoredMatchDedupeKey(match, options);
    if (!key) continue;
    const current = seen.get(key);
    seen.set(key, current ? mergeStoredDuplicateMatch(current, match) : normalizeMatchH2H(match));
  }
  return [...seen.values()];
}

export function dedupeStoredPredictions(predictions = [], matches = [], options) {
  matches = matches.map((match) => normalizeMatchH2H(match));
  const keptMatchIds = new Set(matches.map((match) => String(match?.id || "")).filter(Boolean));
  const matchesById = new Map(matches.map((match) => [String(match?.id || ""), match]).filter(([id]) => id));
  const matchesByDedupeKey = new Map();
  for (const match of matches) {
    const key = buildStoredMatchDedupeKey(match, options);
    if (key) matchesByDedupeKey.set(key, match);
  }
  const selected = new Map();
  for (const prediction of predictions || []) {
    const predictionKey = `${String(prediction?.date || "").slice(0, 10)}|${options.teamKey(prediction?.homeTeam || prediction?.homeTeamName || "")}|${options.teamKey(prediction?.awayTeam || prediction?.awayTeamName || "")}`;
    const canonicalMatch = matchesByDedupeKey.get(predictionKey) || matchesById.get(String(prediction?.matchId || ""));
    const canonicalMatchId = canonicalMatch?.id || prediction?.matchId;
    if (canonicalMatchId && !keptMatchIds.has(String(canonicalMatchId))) continue;
    const unique = canonicalMatchId || predictionKey || prediction?.matchId;
    const candidate = synchronizeMatchPredictionH2H(
      canonicalMatch,
      { ...prediction, matchId: canonicalMatchId || prediction.matchId },
    );
    const quality =
      Number(String(prediction?.matchId || "") === String(canonicalMatchId || "")) * 100 +
      storedMatchQuality({
        ...prediction,
        homeTeamName: prediction?.homeTeamName || prediction?.homeTeam,
        awayTeamName: prediction?.awayTeamName || prediction?.awayTeam,
        dataSource: prediction?.dataSource || prediction?.featureSourceMetadata?.fields?.fixture?.source,
      });
    const current = selected.get(unique);
    if (!current || quality > current.quality) selected.set(unique, { quality, prediction: candidate });
  }
  return [...selected.values()].map((item) => item.prediction);
}
