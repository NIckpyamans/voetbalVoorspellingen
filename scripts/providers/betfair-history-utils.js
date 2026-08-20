export function extractBetfairClosingMarkets(lines) {
  const markets = new Map();
  for (const line of lines) {
    let payload;
    try { payload = JSON.parse(line); } catch { continue; }
    const publishedAt = Number(payload.pt || 0);
    for (const marketChange of payload.mc || []) {
      const id = String(marketChange.id || "");
      if (!id) continue;
      const state = markets.get(id) || { marketId: id, runners: {}, prices: {}, snapshots: 0 };
      const definition = marketChange.marketDefinition;
      if (definition) {
        state.eventName = definition.eventName || state.eventName;
        state.marketName = definition.marketType || definition.name || state.marketName;
        state.marketTime = definition.marketTime || state.marketTime;
        for (const runner of definition.runners || []) state.runners[String(runner.id)] = runner.name || String(runner.id);
      }
      const kickoffMs = Date.parse(state.marketTime || "");
      for (const runner of marketChange.rc || []) {
        if (!Number.isFinite(Number(runner.ltp))) continue;
        if (Number.isFinite(kickoffMs) && publishedAt >= kickoffMs) continue;
        state.prices[String(runner.id)] = { selectionId: String(runner.id), name: state.runners[String(runner.id)] || null, odds: Number(runner.ltp), capturedAt: publishedAt ? new Date(publishedAt).toISOString() : null };
        state.snapshots += 1;
      }
      markets.set(id, state);
    }
  }
  return [...markets.values()].filter((market) => market.marketTime && Object.keys(market.prices).length >= 2).map((market) => ({
    provider: "betfair-historical-basic",
    marketId: market.marketId,
    eventName: market.eventName || null,
    marketName: market.marketName || null,
    kickoff: market.marketTime,
    closing: Object.values(market.prices),
    snapshotsObserved: market.snapshots,
    usage: "offline_calibration_only",
  }));
}
