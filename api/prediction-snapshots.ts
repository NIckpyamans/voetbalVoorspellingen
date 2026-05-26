import { fetchServerStore } from "./_dataSource.js";

function compactSnapshot(snapshot: any) {
  if (!snapshot) return null;
  return {
    predictionId: snapshot.predictionId,
    matchId: snapshot.matchId,
    generatedAt: snapshot.generatedAt,
    cutoffAt: snapshot.cutoffAt,
    kickoff: snapshot.kickoff,
    status: snapshot.status,
    schemaVersion: snapshot.schemaVersion,
    featureSchemaVersion: snapshot.featureSchemaVersion,
    modelVersion: snapshot.modelVersion,
    algorithmVersion: snapshot.algorithmVersion,
    workerVersion: snapshot.workerVersion,
    date: snapshot.date,
    league: snapshot.league,
    season: snapshot.season,
    homeTeam: snapshot.homeTeam,
    awayTeam: snapshot.awayTeam,
    inputSnapshotHash: snapshot.inputSnapshotHash,
    inputSnapshot: snapshot.inputSnapshot || null,
    features: snapshot.features || null,
    probabilities: snapshot.probabilities || null,
    confidence: snapshot.confidence ?? null,
    expectedScore: snapshot.expectedScore || null,
    explanation: snapshot.explanation || null,
    oddsAtPrediction: snapshot.oddsAtPrediction || null,
    oddsStatus: snapshot.oddsStatus || null,
    oddsMissingReason: snapshot.oddsMissingReason || null,
    roiStatus: snapshot.roiStatus || null,
    clvStatus: snapshot.clvStatus || null,
    leakageGuard: snapshot.leakageGuard || null,
    dataCompleteness: snapshot.dataCompleteness || null,
    missingData: snapshot.missingData || [],
  };
}

export default async function handler(req: any, res: any) {
  const started = Date.now();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");

  try {
    const predictionId = typeof req.query?.predictionId === "string" ? req.query.predictionId : null;
    const matchId = typeof req.query?.matchId === "string" ? req.query.matchId : null;
    const limit = Math.min(Math.max(Number(req.query?.limit || 25), 1), 100);
    const { store, branch } = await fetchServerStore();
    const snapshots = store.predictionSnapshots || {};
    const index = store.predictionSnapshotIndex || {};

    let items: any[] = [];
    if (predictionId) {
      const snapshot = compactSnapshot(snapshots[predictionId]);
      items = snapshot ? [snapshot] : [];
    } else if (matchId) {
      items = (index[matchId] || [])
        .map((id: string) => compactSnapshot(snapshots[id]))
        .filter(Boolean);
    } else {
      items = Object.values(snapshots)
        .map((snapshot: any) => compactSnapshot(snapshot))
        .filter(Boolean)
        .sort((a: any, b: any) => Date.parse(b.generatedAt || "") - Date.parse(a.generatedAt || ""))
        .slice(0, limit);
    }

    return res.status(200).json({
      ok: true,
      items,
      total: items.length,
      sourceBranch: branch,
      workerVersion: store.workerVersion || "unknown",
      durationMs: Date.now() - started,
    });
  } catch (err: any) {
    console.error("[prediction-snapshots]", err);
    return res.status(503).json({
      ok: false,
      items: [],
      total: 0,
      error: err?.message || "Unknown error",
      durationMs: Date.now() - started,
    });
  }
}
