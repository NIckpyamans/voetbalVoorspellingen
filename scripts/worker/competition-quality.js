export function buildCompetitionQuality(matches = [], modelPerformance = {}) {
  const groups = new Map();
  for (const match of matches || []) {
    const league = String(match?.league || "unknown");
    const row = groups.get(league) || { league, matches: 0, h2h: 0, form: 0, lineups: 0, odds: 0, updatedAt: null };
    row.matches += 1;
    row.h2h += Number(match?.h2h?.played || 0) > 0 ? 1 : 0;
    row.form += Number(match?.homeRecent?.gamesPlayed || match?.homeRecent?.recentMatches?.length || 0) >= 5 && Number(match?.awayRecent?.gamesPlayed || match?.awayRecent?.recentMatches?.length || 0) >= 5 ? 1 : 0;
    row.lineups += match?.lineupSummary?.confirmed ? 1 : 0;
    row.odds += match?.oddsAtPrediction || match?.odds?.home ? 1 : 0;
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
      coverage: { h2h: pct(row.h2h), form: pct(row.form), confirmedLineups: pct(row.lineups), odds: pct(row.odds) },
      performance: {
        evaluations: Number(metric.matches || metric.evaluations || 0),
        outcomeHitRate: metric.outcomeHitRate ?? metric.outcome_hit_rate ?? null,
        brierScore: metric.avgBrierScore ?? metric.brierScore ?? metric.brier_score ?? null,
        exactHitRate: metric.exactHitRate ?? metric.exact_hit_rate ?? null,
        roi: metric.roiTotal ?? metric.roi ?? null,
      },
    };
  }).sort((a, b) => b.matches - a.matches || a.league.localeCompare(b.league));
}
