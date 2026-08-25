const TARGETS = Object.freeze({
  roster: 0.8,
  ratings: 0.6,
  form: 0.85,
  h2h: 0.85,
  confirmedLineups: 0.45,
  timestampedOdds: 0.45,
  reviews: 0.95,
  postMatchStats: 0.8,
  sourceLineage: 0.95,
});

function pct(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function statusFor(metrics) {
  const ratios = Object.entries(TARGETS).map(([key, target]) => target > 0 ? pct(metrics[key]) / target : 1);
  const minimum = ratios.length ? Math.min(...ratios) : 0;
  return minimum >= 1 ? "ready" : minimum >= 0.7 ? "watch" : "improve";
}

export function buildProfessionalReadinessGate({
  activeCompetitions = [],
  catalog = {},
  agents = {},
  dataQuality = {},
  squads = {},
  calibration = {},
  providerHealth = {},
} = {}) {
  const catalogByLeague = new Map((catalog?.competitions || []).map((item) => [item.league, item]));
  const agentByLeague = new Map((agents?.agents || []).map((item) => [item.league, item]));
  const qualityByLeague = new Map((dataQuality?.byCompetition || []).map((item) => [item.league, item]));
  const squadByLeague = squads?.competitionCoverage || {};
  const competitions = activeCompetitions.map((league) => {
    const catalogRow = catalogByLeague.get(league) || null;
    const agent = agentByLeague.get(league) || null;
    const quality = qualityByLeague.get(league) || {};
    const squad = squadByLeague[league] || {};
    const metrics = {
      roster: pct(squad.rosterCoverage),
      ratings: pct(squad.ratingCoverage),
      form: pct(quality?.predictionInputs?.form?.pct),
      h2h: pct(quality?.predictionInputs?.h2h?.pct),
      confirmedLineups: pct(quality?.predictionInputs?.lineupConfirmed?.pct),
      timestampedOdds: pct(quality?.predictionInputs?.timestampedOdds?.pct),
      reviews: pct(quality?.postMatch?.reviewEligible?.pct),
      postMatchStats: pct(quality?.postMatch?.statistics?.pct),
      sourceLineage: pct(quality?.predictionInputs?.sourceLineage?.pct),
    };
    const gaps = Object.entries(TARGETS)
      .filter(([key, target]) => metrics[key] < target)
      .map(([key, target]) => ({ key, actual: metrics[key], target }));
    const structural = [
      !catalogRow ? "competition_catalog_missing" : null,
      !agent ? "competition_agent_missing" : null,
      catalogRow && Number(catalogRow.expectedTeams || 0) > 0 && catalogRow.teams?.length !== Number(catalogRow.expectedTeams)
        ? `catalog_team_count:${catalogRow.teams?.length || 0}/${catalogRow.expectedTeams}`
        : null,
    ].filter(Boolean);
    return {
      league,
      status: structural.length ? "blocked" : statusFor(metrics),
      matches: Number(quality?.matches || 0),
      finished: Number(quality?.finished || 0),
      metrics,
      gaps,
      structural,
      sources: quality?.sourcePlan || null,
      agent: agent?.key || null,
    };
  });
  const structuralBlockers = competitions.flatMap((row) => row.structural.map((reason) => `${row.league}:${reason}`));
  const providerBlocks = Object.entries(providerHealth || {})
    .filter(([, value]) => value && value.configured && value.valid === false)
    .map(([provider]) => provider);
  const regularCalibrationRows = Number(calibration?.uniqueCompletedRegularSnapshotMatches || 0);
  return {
    schemaVersion: "professional-readiness-v1",
    generatedAt: new Date().toISOString(),
    ok: structuralBlockers.length === 0,
    status: structuralBlockers.length ? "blocked" : competitions.every((row) => row.status === "ready") ? "ready" : "watch",
    targets: TARGETS,
    competitions,
    structuralBlockers,
    externalConstraints: {
      providerBlocks,
      regularCalibrationRows,
      shadowCalibrationReady: regularCalibrationRows >= 50,
      livePromotionReady: regularCalibrationRows >= 150,
    },
    guarantees: {
      historicalMatchesImmutable: true,
      noSyntheticH2H: true,
      noUntimestampedOddsForRoiClv: true,
      noWagerLabelWithoutAllEvidenceGates: true,
      providerCoverageGapsAreWarnings: true,
    },
  };
}
