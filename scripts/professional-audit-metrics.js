import fs from "fs";
import path from "path";

export function values(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function average(items) {
  const numbers = items.map(Number).filter(Number.isFinite);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function isFinished(match) {
  return ["FT", "AET", "PEN"].includes(String(match?.status || "").toUpperCase());
}

function hasScore(match) {
  return /^\d+\s*-\s*\d+$/.test(String(match?.score || "")) ||
    (Number.isFinite(Number(match?.homeScore)) && Number.isFinite(Number(match?.awayScore)));
}

function segmentFor(league) {
  const value = String(league || "").toLowerCase();
  if (value.includes("friendl")) return "club_friendlies";
  if (value.startsWith("europe -")) return "european_knockout";
  return "domestic_competitions";
}

function summarizeReviews(reviews) {
  const valid = reviews.filter((review) => review?.actualScore && review?.predictedScore);
  return {
    reviews: valid.length,
    outcomeHitRate: valid.length
      ? valid.filter((review) => review.outcomeHit || review.winnerCorrect).length / valid.length
      : null,
    exactHitRate: valid.length
      ? valid.filter((review) => review.exactHit || review.wasCorrect).length / valid.length
      : null,
    averageBrier: average(valid.map((review) => review.brierScore)),
    averageLogLoss: average(valid.map((review) => review.logLoss)),
    averageConfidence: average(valid.map((review) => review.confidence)),
  };
}

export function summarizeRecentDays(dayDocuments) {
  const matches = dayDocuments.flatMap((day) => values(day.matches));
  const predictions = dayDocuments.flatMap((day) => values(day.predictions));
  const reviews = dayDocuments.flatMap((day) => values(day.reviews));
  const snapshots = dayDocuments.flatMap((day) => values(day.predictionSnapshots));
  const finished = matches.filter(isFinished);
  const reviewedIds = new Set(reviews.map((review) => String(review.matchId || "")).filter(Boolean));
  const snapshotBackedReviews = reviews.filter((review) => review.evaluationSource === "prediction_snapshot");
  const segments = {};

  for (const segment of ["club_friendlies", "european_knockout", "domestic_competitions"]) {
    segments[segment] = summarizeReviews(reviews.filter((review) => segmentFor(review.league) === segment));
  }

  return {
    days: dayDocuments.length,
    matches: matches.length,
    predictions: predictions.length,
    finishedMatches: finished.length,
    finishedWithScore: finished.filter(hasScore).length,
    resultCoverage: finished.length ? finished.filter(hasScore).length / finished.length : null,
    reviewedMatches: reviewedIds.size,
    evaluationCoverage: finished.length ? reviewedIds.size / finished.length : null,
    snapshotBackedReviews: snapshotBackedReviews.length,
    snapshotBackedReviewCoverage: reviews.length ? snapshotBackedReviews.length / reviews.length : null,
    predictionSnapshots: snapshots.length,
    uniqueSnapshotMatches: new Set(snapshots.map((snapshot) => String(snapshot.matchId || "")).filter(Boolean)).size,
    dataCompleteness: average(predictions.map((prediction) => prediction.dataCompletenessScore ?? prediction.dataCompleteness?.score)),
    sourceMetadataCoverage: predictions.length
      ? predictions.filter((prediction) => prediction.featureSourceMetadata || prediction.sourceAsOf || prediction.sourceTimestampCoverage != null).length / predictions.length
      : null,
    actualOddsCoverage: predictions.length
      ? predictions.filter((prediction) => {
          const odds = prediction.oddsAtPrediction || prediction.odds_at_prediction;
          return odds && ["home", "draw", "away"].some((key) => Number(odds[key]) > 1.01);
        }).length / predictions.length
      : null,
    confirmedLineupCoverage: predictions.length
      ? predictions.filter((prediction) => prediction.lineupStatus === "confirmed" || prediction.lineupSummary?.confirmed).length / predictions.length
      : null,
    performance: summarizeReviews(reviews),
    segments,
    matchesList: matches,
    predictionsList: predictions,
    reviewsList: reviews,
    snapshotsList: snapshots,
  };
}

export function loadRecentDayDocuments(root, generatedAt, lookbackDays = 14) {
  const directory = path.join(root, "data", "days");
  if (!fs.existsSync(directory)) return [];
  const cutoff = new Date(generatedAt);
  cutoff.setUTCDate(cutoff.getUTCDate() - Math.max(1, lookbackDays));
  const latest = String(generatedAt).slice(0, 10);
  const earliest = cutoff.toISOString().slice(0, 10);
  return fs.readdirSync(directory)
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .filter((file) => file.slice(0, 10) >= earliest && file.slice(0, 10) <= latest)
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")));
}

export function buildAppRecommendations({ recent, snapshotGrowth, lineupMonitor, recalibrationReport, databaseAvailable }) {
  const recommendations = [];
  const completed = [];
  const uniqueEvaluated = Number(snapshotGrowth?.training?.uniqueEvaluatedMatches || 0);

  if ((recent.resultCoverage ?? 0) >= 0.99 && (recent.evaluationCoverage ?? 0) >= 0.95) {
    completed.push("Recente eindstanden en evaluaties zijn vrijwel volledig opgeslagen.");
  } else {
    recommendations.push({ key: "result_evaluation_coverage", priority: 1, title: "Herstel resultaat- en evaluatiedekking", advice: "Vul ontbrekende eindstanden en maak voor iedere afgeronde wedstrijd precies een post-match review." });
  }

  if (uniqueEvaluated >= 150) {
    completed.push(`Professionele snapshotgate gehaald met ${uniqueEvaluated} unieke geëvalueerde wedstrijden.`);
    if (recalibrationReport?.calibrationRows > 0 && Number(recalibrationReport?.accepted || 0) === 0) {
      completed.push(`Shadowkalibratie gecontroleerd op ${recalibrationReport.calibrationRows} unieke wedstrijdsamples; geen profiel voldeed aan de promotiedrempel.`);
    } else {
      recommendations.push({ key: "shadow_calibration", priority: 2, title: "Kalibreer league en fase in shadow mode", advice: "Gebruik de volwassen club-only set, vergelijk Brier/log loss per segment en promoveer alleen aantoonbaar betere gewichten." });
    }
  } else {
    recommendations.push({ key: "snapshot_growth", priority: 2, title: "Vergroot snapshot-backed evaluaties", advice: `Laat de immutable trainingsset groeien van ${uniqueEvaluated} naar minimaal 150 unieke afgeronde wedstrijden.` });
  }

  if ((recent.actualOddsCoverage ?? 0) < 0.5) {
    recommendations.push({ key: "timestamped_odds", priority: 1, title: "Vul opening-, prematch- en closing odds", advice: "Meet per provider en competitie; gebruik ROI/CLV pas wanneer timestamped oddsparen aantoonbaar compleet zijn." });
  } else {
    completed.push("Actuele oddsdekking is voldoende voor gecontroleerde marktevaluatie.");
  }

  const lineupCoverage = Math.max(Number(recent.confirmedLineupCoverage || 0), Number(lineupMonitor?.confirmedLineupCoverage || 0));
  if (lineupCoverage < 0.45) {
    recommendations.push({ key: "confirmed_lineups", priority: 1, title: "Verhoog confirmed-lineupdekking", advice: "Haal alleen rond T-75, T-45 en T-20 op en rapporteer dekking per competitie en provider." });
  }

  if ((recent.snapshotBackedReviewCoverage ?? 0) < 0.8) {
    recommendations.push({ key: "snapshot_review_linking", priority: 2, title: "Koppel recente reviews vaker aan immutable snapshots", advice: "Verhoog de recente snapshot-backed reviewdekking naar minimaal 80%; gebruik actuele prediction fallback niet voor modelpromotie." });
  }

  if (!databaseAvailable) {
    recommendations.push({ key: "neon_quota", priority: 1, title: "Herstel Neon-quota of verlaag datatransfer", advice: "R2 houdt de leerlijn beschikbaar, maar relationele writes en monitors blijven beperkt zolang Neon HTTP 402 geeft." });
  }

  return {
    completed,
    recommendations: recommendations.sort((left, right) => left.priority - right.priority),
  };
}
