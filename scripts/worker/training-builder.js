import { selectPreferredTrainingSnapshot, snapshotTrainingEligibility } from "./snapshot-policy.js";

export function buildTrainingSnapshot(store, { isHiddenEntity, selectPredictionForReview } = {}) {
  const rows = [];
  const emittedPredictionIds = new Set();
  const snapshotsByMatchId = new Map();
  for (const snapshot of Object.values(store.predictionSnapshots || {}).flat()) {
    if (!snapshot?.matchId) continue;
    const list = snapshotsByMatchId.get(snapshot.matchId) || [];
    list.push(snapshot);
    snapshotsByMatchId.set(snapshot.matchId, list);
  }
  const selectedPredictionIds = new Set();
  for (const snapshots of snapshotsByMatchId.values()) {
    const byModel = new Map();
    for (const snapshot of snapshots) {
      const model = snapshot?.modelVersion || snapshot?.prediction?.modelVersion || "unknown";
      const list = byModel.get(model) || [];
      list.push(snapshot);
      byModel.set(model, list);
    }
    for (const candidates of byModel.values()) {
      const selected = selectPreferredTrainingSnapshot(candidates);
      if (selected?.predictionId) selectedPredictionIds.add(selected.predictionId);
    }
  }

  for (const date of Object.keys(store.matches || {})) {
    const matches = store.matches?.[date] || [];
    const predictions = Object.fromEntries((store.predictions?.[date] || []).map((prediction) => [prediction.matchId, prediction]));
    for (const match of matches) {
      if (isHiddenEntity?.(match)) continue;
      const prediction = predictions[match.id] || {};
      const reviewPrediction = selectPredictionForReview?.(store, match, prediction) || prediction;
      const label = String(match.status || "").toUpperCase() === "FT" && match.score?.includes("-")
        ? (() => {
            const [homeGoals, awayGoals] = String(match.score).split("-").map(Number);
            return homeGoals > awayGoals ? "H" : homeGoals < awayGoals ? "A" : "D";
          })()
        : null;
      const baseRow = {
        date, matchId: match.id, league: match.league, homeTeam: match.homeTeamName, awayTeam: match.awayTeamName,
        status: match.status || "NS", score: match.score || null, label, review: store.postMatchReviews?.[match.id] || null,
        dbFeatureContext: match.dbFeatureContext || prediction.dbFeatureContext || reviewPrediction?.dbFeatureContext || null,
      };
      const snapshotCandidates = (snapshotsByMatchId.get(match.id) || [])
        .filter((snapshot) => selectedPredictionIds.has(snapshot?.predictionId))
        .map((snapshot) => ({
        predictionId: snapshot.predictionId, generatedAt: snapshot.generatedAt, cutoffAt: snapshot.cutoffAt || snapshot.generatedAt,
        kickoff: snapshot.kickoff || match.kickoff || null,
        snapshotWindow: snapshot.snapshotWindow || snapshotTrainingEligibility(snapshot).snapshotWindow,
        featureVector: snapshot.featureVector || snapshot.features || snapshot.inputSnapshot?.featureVector || null,
        probabilities: snapshot.probabilities || snapshot.prediction?.probabilities || null,
        modelVersion: snapshot.modelVersion || snapshot.prediction?.modelVersion || null,
        ensembleMeta: snapshot.ensembleMeta || snapshot.prediction?.ensembleMeta || null,
        dbFeatureContext: snapshot.dbFeatureContext || snapshot.inputSnapshot?.dbFeatureContext || null,
        snapshotStatus: snapshot.status || null, snapshotBacked: true,
      }));
      const candidates = [{
        predictionId: reviewPrediction?.predictionId || prediction.predictionId || null,
        generatedAt: reviewPrediction?.generatedAt || prediction.generatedAt || null,
        cutoffAt: reviewPrediction?.cutoffAt || prediction.cutoffAt || null,
        featureVector: reviewPrediction?.featureVector || prediction.featureVector || null,
        ensembleMeta: reviewPrediction?.ensembleMeta || prediction.ensembleMeta || null,
        dbFeatureContext: reviewPrediction?.dbFeatureContext || prediction.dbFeatureContext || match.dbFeatureContext || baseRow.dbFeatureContext || null,
        snapshotBacked: false,
      }, ...snapshotCandidates];
      const seenCandidateIds = new Set();
      for (const candidate of candidates) {
        const candidateKey = candidate.predictionId || `${match.id}:${candidate.generatedAt || "latest"}`;
        if (seenCandidateIds.has(candidateKey)) continue;
        seenCandidateIds.add(candidateKey);
        if (candidate.predictionId) emittedPredictionIds.add(candidate.predictionId);
        rows.push({ ...baseRow, ...candidate });
      }
    }
  }

  for (const snapshots of Object.values(store.predictionSnapshots || {})) {
    for (const snapshot of Array.isArray(snapshots) ? snapshots : [snapshots]) {
      if (!snapshot?.predictionId || !snapshot?.matchId || !selectedPredictionIds.has(snapshot.predictionId) || emittedPredictionIds.has(snapshot.predictionId) || isHiddenEntity?.(snapshot)) continue;
      const review = store.postMatchReviews?.[snapshot.matchId] || null;
      const label = String(review?.actualOutcome || "").toUpperCase();
      rows.push({
        date: snapshot.date || String(snapshot.kickoff || "").slice(0, 10) || null,
        matchId: snapshot.matchId, league: snapshot.league || review?.league || null,
        homeTeam: snapshot.homeTeam || review?.homeTeamName || null, awayTeam: snapshot.awayTeam || review?.awayTeamName || null,
        status: review ? "FT" : snapshot.status || "NS", score: review?.actualScore || null,
        label: ["H", "D", "A"].includes(label) ? label : null, review,
        dbFeatureContext: snapshot.dbFeatureContext || snapshot.inputSnapshot?.dbFeatureContext || null,
        predictionId: snapshot.predictionId, generatedAt: snapshot.generatedAt, cutoffAt: snapshot.cutoffAt || snapshot.generatedAt,
        kickoff: snapshot.kickoff || null,
        snapshotWindow: snapshot.snapshotWindow || snapshotTrainingEligibility(snapshot).snapshotWindow,
        featureVector: snapshot.featureVector || snapshot.features || snapshot.inputSnapshot?.featureVector || null,
        probabilities: snapshot.probabilities || snapshot.prediction?.probabilities || null,
        modelVersion: snapshot.modelVersion || snapshot.prediction?.modelVersion || null,
        ensembleMeta: snapshot.ensembleMeta || snapshot.prediction?.ensembleMeta || null,
        snapshotStatus: snapshot.status || null, snapshotBacked: true,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    version: "v10-required-window-snapshots",
    reviewCount: Object.keys(store.postMatchReviews || {}).length,
    trainingPolicy: {
      immutableOnly: true,
      requiredWindows: ["t24", "t75", "t45", "t20"],
      selectedSnapshotRows: selectedPredictionIds.size,
    },
    rows,
  };
}
