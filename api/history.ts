import { fetchServerStore } from "./_dataSource.js";

function mapServerReview(review: any) {
  return {
    matchId: review.matchId,
    prediction: review.predictedScore,
    actual: review.actualScore,
    wasCorrect: !!review.exactHit,
    errorMargin: Number(review.totalGoalError || 0),
    timestamp: Number(review.createdAt || Date.now()),
    homeTeam: review.homeTeamName || null,
    awayTeam: review.awayTeamName || null,
    league: review.league || null,
    winnerCorrect: review.predictedOutcome === review.actualOutcome,
    predictedOutcome:
      review.predictedOutcome === "H"
        ? "Thuis"
        : review.predictedOutcome === "A"
          ? "Uit"
          : review.predictedOutcome === "D"
            ? "Gelijk"
            : review.predictedOutcome || null,
    actualOutcome:
      review.actualOutcome === "H"
        ? "Thuis"
        : review.actualOutcome === "A"
          ? "Uit"
          : review.actualOutcome === "D"
            ? "Gelijk"
            : review.actualOutcome || null,
    topChanceCorrect: !!review.probabilityOutcomeHit,
    phaseBucket: review.phaseBucket || null,
    confidence: Number(review.confidence || 0),
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");

  try {
    const { store, branch } = await fetchServerStore();
    const items = Object.values(store.postMatchReviews || {})
      .map((review: any) => mapServerReview(review))
      .sort((a: any, b: any) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

    return res.status(200).json({
      items,
      total: items.length,
      sourceBranch: branch,
      workerVersion: store.workerVersion || "unknown",
    });
  } catch (err: any) {
    return res.status(200).json({
      items: [],
      total: 0,
      error: err?.message || "Unknown error",
    });
  }
}
