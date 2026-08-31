export function buildCompetitionQuality(matches = [], modelPerformance = {}) {
  const groups = new Map();
  for (const match of matches || []) {
    const league = String(match?.league || "unknown");
    const row = groups.get(league) || { league, matches: 0, h2h: 0, form: 0, lineups: 0, squads: 0, ratings: 0, odds: 0, timestampedOdds: 0, updatedAt: null };
    row.matches += 1;
    row.h2h += Number(match?.h2h?.played || 0) > 0 ? 1 : 0;
    row.form += Number(match?.homeRecent?.gamesPlayed || match?.homeRecent?.recentMatches?.length || 0) >= 5 && Number(match?.awayRecent?.gamesPlayed || match?.awayRecent?.recentMatches?.length || 0) >= 5 ? 1 : 0;
    row.lineups += match?.lineupSummary?.confirmed ? 1 : 0;
    const profiles = [match?.homeTeamProfile, match?.awayTeamProfile];
    const players = (profile) => Array.isArray(profile?.players)
      ? profile.players
      : Array.isArray(profile?.squad)
        ? profile.squad
        : Array.isArray(profile?.squad?.players)
          ? profile.squad.players
          : [];
    row.squads += profiles.every((profile) => Math.max(Number(profile?.playerCount || profile?.squadSize || profile?.squad?.playerCount || 0), players(profile).length) >= 11) ? 1 : 0;
    row.ratings += profiles.every((profile) => players(profile).some((player) => Number(player?.rating || 0) > 0)) ? 1 : 0;
    row.odds += match?.oddsAtPrediction || match?.odds?.home ? 1 : 0;
    const odds = match?.oddsAtPrediction || match?.odds;
    const capturedAt = Date.parse(odds?.capturedAt || odds?.prematchCapturedAt || "");
    const kickoff = Date.parse(match?.kickoff || "");
    row.timestampedOdds += [odds?.home, odds?.draw, odds?.away].every((value) => Number(value) > 1) && Number.isFinite(capturedAt) && Number.isFinite(kickoff) && capturedAt < kickoff ? 1 : 0;
    const timestamp = match?.sourceAsOf?.fixture || match?.updatedAt || match?.liveUpdatedAt || null;
    if (timestamp && (!row.updatedAt || Date.parse(timestamp) > Date.parse(row.updatedAt))) row.updatedAt = timestamp;
    groups.set(league, row);
  }
  const rawPerformance = modelPerformance?.byLeague || modelPerformance?.leagues || modelPerformance?.competitions || {};
  const performance = new Map(
    Array.isArray(rawPerformance)
      ? rawPerformance
        .filter((metric) => metric && (metric.key || metric.league || metric.competition))
        .map((metric) => [String(metric.key || metric.league || metric.competition), metric])
      : Object.entries(rawPerformance || {}),
  );
  return [...groups.values()].map((row) => {
    const metric = performance.get(row.league) || {};
    const pct = (value) => row.matches ? Number((value / row.matches).toFixed(3)) : 0;
    return {
      ...row,
      coverage: { h2h: pct(row.h2h), form: pct(row.form), confirmedLineups: pct(row.lineups), squads: pct(row.squads), ratings: pct(row.ratings), odds: pct(row.odds), timestampedOdds: pct(row.timestampedOdds) },
      performance: {
        evaluations: Number(metric.matches || metric.evaluations || 0),
        outcomeHitRate: metric.outcomeHitRate ?? metric.outcome_hit_rate ?? null,
        brierScore: metric.avgBrierScore ?? metric.brierScore ?? metric.brier_score ?? null,
        logLoss: metric.avgLogLoss ?? metric.logLoss ?? metric.log_loss ?? null,
        exactHitRate: metric.exactHitRate ?? metric.exact_hit_rate ?? null,
        roi: metric.roiTotal ?? metric.roi ?? null,
        leakageCoverage: metric.metricCoverage?.leakageCutoffKnown ?? null,
      },
      modelReady: Number(metric.matches || metric.evaluations || 0) >= 100 && Number(metric.metricCoverage?.leakageCutoffKnown || 0) >= 0.8,
      modelReadyReason: Number(metric.matches || metric.evaluations || 0) < 100
        ? "minder dan 100 evaluaties"
        : Number(metric.metricCoverage?.leakageCutoffKnown || 0) < 0.8
          ? "leakage-cutoffdekking lager dan 80%"
          : "voldoende historische evaluaties",
    };
  }).sort((a, b) => b.matches - a.matches || a.league.localeCompare(b.league));
}
