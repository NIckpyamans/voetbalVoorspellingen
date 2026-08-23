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
      return (Array.isArray(day.matches) ? day.matches : []).map((match) => ({ ...match, _dateKey: dateKey }));
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
  return Boolean(match?.lineupSummary?.confirmed || match?.lineupStatus === "confirmed");
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

function hasSourceLineage(match) {
  return Boolean(String(match?.dataSource || match?.source || "").trim()) && !/^unknown$/i.test(String(match?.dataSource || ""));
}

function hasReview(match, reviews) {
  return Boolean(reviews?.[match?.id || match?.match_id]);
}

function coverageRow(matches, reviews) {
  const finished = matches.filter(hasFinalScore);
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
      sourceLineage: metric(matches, hasSourceLineage),
    },
    postMatch: {
      finalScore: metric(finished, hasFinalScore),
      review: metric(finished, (match) => hasReview(match, reviews)),
      statistics: metric(finished, hasUsefulPostMatchStats),
      referee: metric(finished, hasReferee),
    },
  };
}

function main() {
  const today = todayAmsterdamKey();
  const matches = collectMatches();
  const history = readJsonSafe(path.join("data", "history-summary.json"), {});
  const reviews = history?.postMatchReviews || {};
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
    const coverage = coverageRow(rows, reviews);
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
      coverage.postMatch.review.pct < 0.98 ? "reviews" : null,
      coverage.postMatch.statistics.pct < 0.8 ? "post_match_statistics" : null,
      coverage.postMatch.referee.pct < 0.65 ? "referee" : null,
    ].filter(Boolean);
    return { league, ...coverage, gaps, sourcePlan };
  });
  const coverage = coverageRow(matches, reviews);

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
      canBackfillAfterMatch: ["finalScore", "postMatchReview", "statistics", "goalMinutes", "cards", "referee", "confirmedLineup"],
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
      coverage.postMatch.review.pct < 0.98
        ? `Koppel de ontbrekende reviews aan de ${coverage.finished} afgeronde wedstrijden voordat opnieuw wordt gekalibreerd.`
        : "Afgeronde wedstrijden zijn aan post-matchreviews gekoppeld.",
      coverage.postMatch.statistics.pct < 0.8
        ? "Vul post-match statistieken en doelminuten via FotMob, APIfootball.com of GOAL shadow aan; nulvelden tellen niet als echte statistiek."
        : "Post-match statistiekdekking is voldoende.",
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
    `- Bruikbare wedstrijdstatistieken: ${Math.round(report.coverage.postMatch.statistics.pct * 100)}%`,
    `- Bevestigde opstellingen: ${Math.round(report.coverage.predictionInputs.lineupConfirmed.pct * 100)}%`,
    "",
    "## Per competitie",
    ...report.byCompetition.map((item) => `- ${item.league}: ${item.matches} duels, vorm ${Math.round(item.predictionInputs.form.pct * 100)}%, H2H ${Math.round(item.predictionInputs.h2h.pct * 100)}%, reviews ${Math.round(item.postMatch.review.pct * 100)}%, stats ${Math.round(item.postMatch.statistics.pct * 100)}%; gaten: ${item.gaps.join(", ") || "geen"}`),
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
