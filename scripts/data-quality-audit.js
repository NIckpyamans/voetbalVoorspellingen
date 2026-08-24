#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { todayAmsterdamKey } from "../shared/date.js";
import { hasFinalScore, hasUsableH2H } from "../shared/matchNormalization.js";
import { ACTIVE_COMPETITIONS, isActiveCompetitionEntity } from "../shared/competitionVisibility.js";

const ROOT = process.cwd();
const OUTPUT_JSON = path.join(ROOT, "monitor", "data-quality-audit.json");
const OUTPUT_MD = path.join(ROOT, "monitor", "data-quality-audit.md");
const DEFAULT_LOOKBACK_DAYS = Number(process.env.DATA_QUALITY_LOOKBACK_DAYS || 45);

function readJsonSafe(relativePath, fallback) {
  try {
    const filePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function dateMinus(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function isPastMatch(match, today) {
  const dateKey = String(match?._dateKey || match?.date || match?.kickoff || "").slice(0, 10);
  if (!dateKey) return false;
  return dateKey < today;
}

function matchLabel(match) {
  const dateKey = String(match?._dateKey || match?.date || match?.kickoff || "").slice(0, 10) || "unknown";
  return `${dateKey}: ${match?.homeTeamName || match?.homeTeam || "?"} - ${match?.awayTeamName || match?.awayTeam || "?"}`;
}

function collectMatches() {
  const meta = readJsonSafe(path.join("data", "meta.json"), {});
  const dates = Array.isArray(meta.dates) ? meta.dates : [];
  const fromDate = dateMinus(todayAmsterdamKey(), DEFAULT_LOOKBACK_DAYS);
  const splitMatches = dates
    .filter((dateKey) => dateKey >= fromDate)
    .flatMap((dateKey) => {
      const day = readJsonSafe(path.join("data", "days", `${dateKey}.json`), { matches: [] });
      const predictions = Array.isArray(day.predictions) ? day.predictions : Object.values(day.predictions || {});
      const predictionByMatch = new Map(predictions.map((prediction) => [prediction?.matchId, prediction]));
      const snapshots = Object.values(day.predictionSnapshots || {});
      return (Array.isArray(day.matches) ? day.matches : []).map((match, index) => {
        const kickoff = Date.parse(String(match?.kickoff || match?.date || ""));
        const prematchSnapshot = snapshots
          .filter((snapshot) => {
            if (String(snapshot?.matchId || "") !== String(match?.id || "")) return false;
            const cutoff = Date.parse(String(snapshot?.cutoffAt || snapshot?.generatedAt || ""));
            return Number.isFinite(cutoff) && Number.isFinite(kickoff) && cutoff < kickoff;
          })
          .sort((left, right) => Date.parse(String(right?.cutoffAt || right?.generatedAt || "")) - Date.parse(String(left?.cutoffAt || left?.generatedAt || "")))[0] || null;
        return {
          ...match,
          _dateKey: dateKey,
          _prediction: predictionByMatch.get(match?.id) || predictions[index] || null,
          _prematchSnapshot: prematchSnapshot,
        };
      });
    });

  if (splitMatches.length) return splitMatches.filter(isActiveCompetitionEntity);

  const serverData = readJsonSafe("server_data.json", {});
  return Object.entries(serverData.matches || {}).flatMap(([dateKey, matches]) =>
    (Array.isArray(matches) ? matches : []).map((match) => ({ ...match, _dateKey: dateKey }))
  ).filter(isActiveCompetitionEntity);
}

function hasRecentForm(match) {
  return [match?.homeRecent, match?.awayRecent].every((profile) =>
    Number(profile?.gamesPlayed || profile?.recentMatches?.length || 0) >= 5
  );
}

function hasConfirmedLineup(match) {
  const predictionLineup = match?._prediction?.lineupSummary;
  const matchLineup = match?.lineupSummary;
  const safeMatchLineup = matchLineup?.confirmed && !matchLineup?.historicalBackfill && matchLineup?.preMatchUsable !== false;
  return Boolean(predictionLineup?.confirmed || safeMatchLineup || match?.lineupStatus === "confirmed");
}

function hasHistoricalConfirmedLineup(match) {
  const lineup = match?.lineupSummary;
  return Boolean(lineup?.confirmed && lineup?.historicalBackfill && lineup?.captureTiming === "post_match");
}

function normalizeTeam(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(fc|afc|cf|sc|sv|fk|nk|ac|club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function identityKey(date, home, away) {
  return `${String(date || "").slice(0, 10)}|${normalizeTeam(home)}|${normalizeTeam(away)}`;
}

function buildReviewIndex(reviews) {
  const index = new Set();
  for (const [matchId, review] of Object.entries(reviews || {})) {
    if (matchId) index.add(`id:${matchId}`);
    if (review?.matchId) index.add(`id:${review.matchId}`);
    const key = identityKey(review?.date, review?.homeTeamName || review?.homeTeam, review?.awayTeamName || review?.awayTeam);
    if (!key.endsWith("||")) index.add(`fixture:${key}`);
  }
  return index;
}

function hasTimestampedPrematchOdds(match) {
  const odds = match?._prediction?.odds || match?.oddsAtPrediction || match?.odds;
  const prices = [odds?.home ?? odds?.homeWin, odds?.draw, odds?.away ?? odds?.awayWin].map(Number);
  if (!prices.every((value) => Number.isFinite(value) && value > 1.01)) return false;
  const kickoff = Date.parse(String(match?.kickoff || match?.date || ""));
  const capturedAt = Date.parse(String(odds?.capturedAt || odds?.lastUpdated || ""));
  return Number.isFinite(kickoff) && Number.isFinite(capturedAt) && capturedAt < kickoff && kickoff - capturedAt <= 24 * 60 * 60 * 1000;
}

function hasModelReadyData(match) {
  const prediction = match?._prediction || match;
  const completeness = Number(prediction?.dataCompleteness?.score ?? prediction?.dataCompletenessScore ?? 0);
  return completeness >= 0.7 && !prediction?.qualityGate?.blockedHighConfidence;
}

function hasWagerEvidence(match) {
  return !/friendl|oefen/i.test(String(match?.league || ""))
    && hasModelReadyData(match)
    && hasConfirmedLineup(match)
    && hasTimestampedPrematchOdds(match);
}

function hasUsefulPostMatchStats(match) {
  const stats = match?.postMatchStats;
  if (!stats) return false;
  const values = [
    stats?.home?.possession,
    stats?.away?.possession,
    stats?.home?.shots,
    stats?.away?.shots,
    stats?.home?.shotsOnTarget,
    stats?.away?.shotsOnTarget,
    stats?.home?.corners,
    stats?.away?.corners,
  ].map(Number).filter(Number.isFinite);
  return values.some((value) => value > 0);
}

function hasReferee(match) {
  return Boolean(String(match?.refereeProfile?.name || "").trim());
}

function hasGoalTimeline(match) {
  const stats = match?.postMatchStats;
  const events = stats?.events || stats?.timeline || match?.events || match?.goalEvents || [];
  return Array.isArray(events) && events.some((event) => /goal/i.test(String(event?.type || event?.event || "")) && Number.isFinite(Number(event?.minute)));
}

function hasCardTimeline(match) {
  const stats = match?.postMatchStats;
  const events = stats?.events || stats?.timeline || match?.events || [];
  if (Array.isArray(events) && events.some((event) => /card/i.test(String(event?.type || event?.event || "")))) return true;
  const cards = stats?.cards || {};
  return [cards.homeYellow, cards.awayYellow, cards.homeRed, cards.awayRed].some((value) => Number(value || 0) > 0);
}

function hasSourceLineage(match) {
  return Boolean(String(match?.dataSource || match?.source || "").trim()) && !/^unknown$/i.test(String(match?.dataSource || ""));
}

function hasReview(match, reviewIndex) {
  const matchId = match?.id || match?.match_id;
  if (matchId && reviewIndex.has(`id:${matchId}`)) return true;
  const key = identityKey(match?._dateKey || match?.date || match?.kickoff, match?.homeTeamName || match?.homeTeam, match?.awayTeamName || match?.awayTeam);
  return reviewIndex.has(`fixture:${key}`);
}

function hasLeakFreePrematchPrediction(match) {
  const prediction = match?._prematchSnapshot || match?._prediction;
  if (!prediction) return false;
  const kickoff = Date.parse(String(match?.kickoff || match?.date || ""));
  const cutoff = Date.parse(String(prediction?.cutoffAt || prediction?.generatedAt || prediction?.createdAt || ""));
  return Number.isFinite(kickoff) && Number.isFinite(cutoff) && cutoff < kickoff;
}

function coverageRow(matches, reviewIndex) {
  const finished = matches.filter(hasFinalScore);
  const reviewEligible = finished.filter(hasLeakFreePrematchPrediction);
  const count = (rows, predicate) => rows.filter(predicate).length;
  const metric = (rows, predicate) => ({
    covered: count(rows, predicate),
    total: rows.length,
    pct: rows.length ? Number((count(rows, predicate) / rows.length).toFixed(3)) : 1,
  });
  return {
    matches: matches.length,
    finished: finished.length,
    predictionInputs: {
      form: metric(matches, hasRecentForm),
      h2h: metric(matches, hasUsableH2H),
      lineupConfirmed: metric(matches, hasConfirmedLineup),
      timestampedOdds: metric(matches, hasTimestampedPrematchOdds),
      modelReadyData: metric(matches, hasModelReadyData),
      wagerEvidence: metric(matches, hasWagerEvidence),
      sourceLineage: metric(matches, hasSourceLineage),
    },
    postMatch: {
      finalScore: metric(finished, hasFinalScore),
      historicalLineup: metric(finished, hasHistoricalConfirmedLineup),
      review: metric(finished, (match) => hasReview(match, reviewIndex)),
      reviewEligible: {
        covered: count(reviewEligible, (match) => hasReview(match, reviewIndex)),
        total: reviewEligible.length,
        pct: reviewEligible.length
          ? Number((count(reviewEligible, (match) => hasReview(match, reviewIndex)) / reviewEligible.length).toFixed(3))
          : 0,
      },
      statistics: metric(finished, hasUsefulPostMatchStats),
      referee: metric(finished, hasReferee),
      goalTimeline: metric(finished, hasGoalTimeline),
      cardTimeline: metric(finished, hasCardTimeline),
    },
  };
}

function main() {
  const today = todayAmsterdamKey();
  const matches = collectMatches();
  const history = readJsonSafe(path.join("data", "history-summary.json"), {});
  const reviews = history?.postMatchReviews || {};
  const reviewIndex = buildReviewIndex(reviews);
  const agentConfig = readJsonSafe(path.join("config", "competition-agents.json"), {});
  const pastMatches = matches.filter((match) => isPastMatch(match, today));
  const pendingResultBackfills = pastMatches
    .filter((match) => !hasFinalScore(match) && String(match?.status || "").toUpperCase() === "RESULT_PENDING")
    .map(matchLabel);
  const missingPastScores = pastMatches
    .filter((match) => !hasFinalScore(match) && !["POSTPONED", "CANCELLED", "RESULT_PENDING"].includes(String(match?.status || "").toUpperCase()))
    .map(matchLabel);
  const h2hMissing = matches
    .filter((match) => !hasUsableH2H(match))
    .map(matchLabel);
  const h2hCovered = matches.length - h2hMissing.length;
  const resultBackfillScore = pendingResultBackfills.length === 0 && missingPastScores.length === 0 ? "clean" : "needs_backfill";
  const h2hCoverage = matches.length ? Number((h2hCovered / matches.length).toFixed(3)) : 1;
  const byCompetition = ACTIVE_COMPETITIONS.map((league) => {
    const rows = matches.filter((match) => match.league === league);
    const coverage = coverageRow(rows, reviewIndex);
    const agent = (agentConfig?.agents || []).find((item) => item.league === league) || {};
    const profile = agentConfig?.profiles?.[agent.profile] || {};
    const sourcePlan = {
      fixtures: agent?.sourceOverrides?.fixtures || profile.fixtures || [],
      form: agent?.sourceOverrides?.form || profile.form || [],
      h2h: agent?.sourceOverrides?.h2h || profile.h2h || [],
      lineups: agent?.sourceOverrides?.lineups || profile.lineups || [],
      odds: agent?.sourceOverrides?.odds || ["the-odds-api"],
      postMatch: ["fotmob-match-details", "thesportsdb", "football-data-org", "goal-api-shadow"],
    };
    const gaps = [
      coverage.predictionInputs.form.pct < 0.8 ? "form" : null,
      coverage.predictionInputs.h2h.pct < 0.65 ? "h2h" : null,
      coverage.predictionInputs.lineupConfirmed.pct < 0.45 ? "confirmed_lineups" : null,
      coverage.predictionInputs.timestampedOdds.pct < 0.45 ? "timestamped_odds" : null,
      coverage.postMatch.reviewEligible.pct < 0.95 ? "leak_free_reviews" : null,
      coverage.postMatch.statistics.pct < 0.8 ? "post_match_statistics" : null,
      coverage.postMatch.referee.pct < 0.65 ? "referee" : null,
      coverage.postMatch.goalTimeline.pct < 0.8 ? "goal_timeline" : null,
      coverage.postMatch.cardTimeline.pct < 0.8 ? "card_timeline" : null,
    ].filter(Boolean);
    return { league, ...coverage, gaps, sourcePlan };
  });
  const coverage = coverageRow(matches, reviewIndex);

  const report = {
    generatedAt: new Date().toISOString(),
    lookbackDays: DEFAULT_LOOKBACK_DAYS,
    totals: {
      matches: matches.length,
      pastMatches: pastMatches.length,
      pendingResultBackfills: pendingResultBackfills.length,
      missingPastScores: missingPastScores.length,
      h2hMissing: h2hMissing.length,
      h2hCovered,
      h2hCoverage,
    },
    status: {
      resultBackfill: resultBackfillScore,
      h2h: h2hCoverage >= 0.85 ? "healthy" : h2hCoverage >= 0.65 ? "watch" : "needs_backfill",
    },
    coverage,
    byCompetition,
    backfillPolicy: {
      canBackfillAfterMatch: ["finalScore", "postMatchReview", "statistics", "goalMinutes", "cards", "referee", "historicalConfirmedLineup"],
      cannotReconstructSafely: ["openingOdds", "prematchOdds", "closingOddsWithoutTimestamp", "preKickoffAvailability"],
    },
    samples: {
      pendingResultBackfills: pendingResultBackfills.slice(0, 20),
      missingPastScores: missingPastScores.slice(0, 20),
      h2hMissing: h2hMissing.slice(0, 20),
    },
    recommendations: [
      pendingResultBackfills.length || missingPastScores.length
        ? "Vul eerst betrouwbare eindstanden aan voordat learning en ROI/CLV zwaarder worden gewogen."
        : "Resultaatbackfill is schoon binnen de auditperiode.",
      h2hCoverage < 0.85
        ? "Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking."
        : "H2H-dekking is voldoende voor de huidige auditperiode.",
      coverage.postMatch.reviewEligible.pct < 0.95
        ? `Koppel minimaal 95% van de ${coverage.postMatch.reviewEligible.total} lekvrije pre-matchsnapshots aan een post-matchreview voordat opnieuw wordt gekalibreerd.`
        : "Afgeronde wedstrijden zijn aan post-matchreviews gekoppeld.",
      coverage.postMatch.statistics.pct < 0.8
        ? "Vul post-match statistieken en doelminuten via FotMob, APIfootball.com of GOAL shadow aan; nulvelden tellen niet als echte statistiek."
        : "Post-match statistiekdekking is voldoende.",
      coverage.predictionInputs.wagerEvidence.pct < 0.45
        ? "Toon geen inzetadvies zolang bevestigde opstellingen, verse getimestampte 1X2-odds en minimaal 70% modeldata niet samen aanwezig zijn."
        : "De pre-match bewijsdekking is voldoende om inzetgereedheid per wedstrijd te beoordelen.",
    ],
  };

  const md = [
    "# Data Quality Audit",
    "",
    `Laatst bijgewerkt: ${report.generatedAt}`,
    `Lookback: ${DEFAULT_LOOKBACK_DAYS} dagen`,
    "",
    "## Scores",
    `- Wedstrijden: ${report.totals.matches}`,
    `- Oude wedstrijden: ${report.totals.pastMatches}`,
    `- Pending result backfills: ${report.totals.pendingResultBackfills}`,
    `- Ontbrekende oude scores: ${report.totals.missingPastScores}`,
    `- H2H-dekking: ${Math.round(report.totals.h2hCoverage * 100)}%`,
    `- Reviews na afloop: ${Math.round(report.coverage.postMatch.review.pct * 100)}%`,
    `- Lekvrije post-matchreviews: ${Math.round(report.coverage.postMatch.reviewEligible.pct * 100)}% (${report.coverage.postMatch.reviewEligible.covered}/${report.coverage.postMatch.reviewEligible.total})`,
    `- Bruikbare wedstrijdstatistieken: ${Math.round(report.coverage.postMatch.statistics.pct * 100)}%`,
    `- Bevestigde opstellingen: ${Math.round(report.coverage.predictionInputs.lineupConfirmed.pct * 100)}%`,
    `- Historisch teruggevonden basiselftallen: ${Math.round(report.coverage.postMatch.historicalLineup.pct * 100)}%`,
    `- Verse getimestampte prematch-odds: ${Math.round(report.coverage.predictionInputs.timestampedOdds.pct * 100)}%`,
    `- Volledige pre-match bewijsset: ${Math.round(report.coverage.predictionInputs.wagerEvidence.pct * 100)}%`,
    `- Doelpunten met tijdlijn: ${Math.round(report.coverage.postMatch.goalTimeline.pct * 100)}%`,
    `- Kaarten met tijdlijn: ${Math.round(report.coverage.postMatch.cardTimeline.pct * 100)}%`,
    "",
    "## Per competitie",
    ...report.byCompetition.map((item) => `- ${item.league}: ${item.matches} duels, vorm ${Math.round(item.predictionInputs.form.pct * 100)}%, H2H ${Math.round(item.predictionInputs.h2h.pct * 100)}%, inzetbewijs ${Math.round(item.predictionInputs.wagerEvidence.pct * 100)}%, lekvrije reviews ${Math.round(item.postMatch.reviewEligible.pct * 100)}% (${item.postMatch.reviewEligible.covered}/${item.postMatch.reviewEligible.total}), stats ${Math.round(item.postMatch.statistics.pct * 100)}%; gaten: ${item.gaps.join(", ") || "geen"}`),
    "",
    "## Aanbevelingen",
    ...report.recommendations.map((item) => `- ${item}`),
    "",
    "## Samples",
    ...report.samples.pendingResultBackfills.map((item) => `- Pending: ${item}`),
    ...report.samples.missingPastScores.map((item) => `- Score mist: ${item}`),
    ...report.samples.h2hMissing.slice(0, 10).map((item) => `- H2H mist: ${item}`),
    "",
  ].join("\n");

  writeJson(OUTPUT_JSON, report);
  writeText(OUTPUT_MD, md);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

main();
