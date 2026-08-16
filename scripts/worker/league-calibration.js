const STATIC_PROFILES = {
  "England - Premier League": { confidenceBias: 0.01, drawBias: -0.01, homeBias: 0 },
  "Spain - LaLiga": { confidenceBias: 0.008, drawBias: 0.006, homeBias: 0 },
  "Italy - Serie A": { confidenceBias: 0.006, drawBias: 0.012, homeBias: 0 },
  "Germany - Bundesliga": { confidenceBias: 0.004, drawBias: -0.008, homeBias: 0.004 },
  "France - Ligue 1": { confidenceBias: 0.005, drawBias: 0.004, homeBias: 0 },
  "Netherlands - Eredivisie": { confidenceBias: 0.007, drawBias: -0.01, homeBias: 0.003 },
  default: { confidenceBias: 0, drawBias: 0, homeBias: 0 },
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function applyLeagueCalibration(probabilities, leagueLabel, dynamicProfile = null) {
  const base = STATIC_PROFILES[leagueLabel] || STATIC_PROFILES.default;
  const profile = {
    confidenceBias: Number(base.confidenceBias || 0) + Number(dynamicProfile?.confidenceBias || 0),
    drawBias: Number(base.drawBias || 0) + Number(dynamicProfile?.drawBias || 0),
    homeBias: Number(base.homeBias || 0) + Number(dynamicProfile?.homeBias || 0),
  };
  const home = clamp(Number(probabilities?.homeProb || 0) + profile.homeBias, 0.01, 0.98);
  const draw = clamp(Number(probabilities?.drawProb || 0) + profile.drawBias, 0.01, 0.98);
  const away = clamp(Number(probabilities?.awayProb || 0) - profile.homeBias, 0.01, 0.98);
  const total = home + draw + away;
  return {
    homeProb: Number((home / total).toFixed(4)),
    drawProb: Number((draw / total).toFixed(4)),
    awayProb: Number((away / total).toFixed(4)),
    profile,
  };
}

export function rebuildLeagueCalibrationProfilesFromReviews(store, now = Date.now()) {
  const reviews = Object.values(store?.postMatchReviews || {}).filter(Boolean);
  const windows = [7, 30, 90];
  const generatedAt = new Date(now).toISOString();
  const buildProfile = (items, windowDays) => {
    const byLeague = {};
    for (const item of items) {
      const league = String(item?.league || "").trim();
      if (!league) continue;
      if (!byLeague[league]) byLeague[league] = { matches: 0, actualDraw: 0, predictedDraw: 0, homeMissBias: 0, outcomeHits: 0 };
      const row = byLeague[league];
      row.matches += 1;
      row.outcomeHits += item?.outcomeHit ? 1 : 0;
      const actual = String(item?.actualScore || "").split("-").map(Number);
      const predicted = String(item?.predictedScore || "").split("-").map(Number);
      row.actualDraw += Number(Number.isFinite(actual[0]) && Number.isFinite(actual[1]) && actual[0] === actual[1]);
      row.predictedDraw += Number(Number.isFinite(predicted[0]) && Number.isFinite(predicted[1]) && predicted[0] === predicted[1]);
      if (item?.actualOutcome === "H" && item?.predictedOutcome !== "H") row.homeMissBias += 1;
      if (item?.actualOutcome !== "H" && item?.predictedOutcome === "H") row.homeMissBias -= 1;
    }
    const profiles = {};
    for (const [league, row] of Object.entries(byLeague)) {
      if (row.matches < 8) continue;
      const sampleStability = clamp(row.matches / (windowDays <= 7 ? 18 : windowDays <= 30 ? 36 : 60), 0, 1);
      const outcomeHitRate = row.outcomeHits / row.matches;
      const hitRateStability = clamp(1 - Math.abs(outcomeHitRate - 0.52) * 1.7, 0, 1);
      profiles[league] = {
        matches: row.matches,
        windowDays,
        stabilityScore: Number((sampleStability * 0.72 + hitRateStability * 0.28).toFixed(3)),
        confidenceBias: Number(clamp((outcomeHitRate - 0.52) * 0.04, -0.025, 0.025).toFixed(4)),
        drawBias: Number(clamp(((row.actualDraw - row.predictedDraw) / row.matches) * 0.08, -0.035, 0.035).toFixed(4)),
        homeBias: Number(clamp((row.homeMissBias / row.matches) * 0.03, -0.025, 0.025).toFixed(4)),
        updatedAt: generatedAt,
      };
    }
    return profiles;
  };

  const profilesByWindow = {};
  for (const days of windows) {
    const cutoff = now - days * 86400000;
    profilesByWindow[String(days)] = buildProfile(
      reviews.filter((review) => Number(review?.createdAt || 0) >= cutoff || Date.parse(review?.date || "") >= cutoff),
      days
    );
  }
  const allLeagues = new Set(Object.values(profilesByWindow).flatMap((profiles) => Object.keys(profiles || {})));
  const selectedProfiles = {};
  for (const league of allLeagues) {
    const candidates = windows.map((days) => profilesByWindow[String(days)]?.[league]).filter(Boolean)
      .sort((left, right) => Number(right.stabilityScore || 0) - Number(left.stabilityScore || 0));
    const selected = candidates[0];
    if (!selected || Number(selected.stabilityScore || 0) < 0.45) continue;
    selectedProfiles[league] = {
      ...selected,
      selectedWindow: selected.windowDays,
      availableWindows: candidates.map((item) => ({ windowDays: item.windowDays, matches: item.matches, stabilityScore: item.stabilityScore })),
    };
  }
  const rollbackProfiles = { ...(store.leagueCalibrationRollbackProfiles || {}) };
  for (const alert of store.backtestSegmentation?.driftAlerts || []) {
    if (alert?.scope !== "league" || alert?.severity !== "high") continue;
    const key = String(alert.key || "");
    const previous = store.leagueCalibrationProfiles?.[key];
    if (previous) rollbackProfiles[key] = { ...previous, rollbackAt: generatedAt, rollbackReason: "performance_drift" };
    delete selectedProfiles[key];
  }
  store.leagueCalibrationProfilesByWindow = profilesByWindow;
  store.leagueCalibrationRollbackProfiles = rollbackProfiles;
  store.leagueCalibrationProfiles = selectedProfiles;
}
