export type MatchEvidenceCoverage = {
  complete: boolean;
  score: number;
  lineupConfirmedPrematch: boolean;
  oddsCompleteFreshPrematch: boolean;
  h2hAvailable: boolean;
  lineupCapturedAt: string | null;
  oddsCapturedAt: string | null;
  missing: string[];
};

export function parseEvidenceTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && /^\d{10,13}$/.test(value.trim())) {
    const numeric = Number(value);
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function getMatchEvidenceCoverage(match: any, prediction: any = {}, { now = Date.now() }: { now?: number } = {}): MatchEvidenceCoverage {
  const kickoffValue = match?.kickoff || match?.date || prediction?.kickoff || prediction?.date;
  const kickoffAt = parseEvidenceTimestamp(kickoffValue);
  const kickoffHasTime = Boolean(kickoffAt != null && typeof kickoffValue === "string" && kickoffValue.includes("T"));
  const rawCompleteness = Number(prediction?.dataCompleteness?.score ?? prediction?.dataCompletenessScore ?? match?.dataCompleteness?.score ?? match?.dataCompletenessScore ?? 0);
  const completeness = Number.isFinite(rawCompleteness) ? Math.max(0, Math.min(1, rawCompleteness > 1 ? rawCompleteness / 100 : rawCompleteness)) : 0;
  const lineup = prediction?.lineupSummary || match?.lineupSummary || null;
  const lineupCapturedAt = parseEvidenceTimestamp(
    prediction?.lineupSummary?.firstConfirmedAt || match?.lineupFirstConfirmedAt ||
    match?.lineupSummary?.firstConfirmedAt || prediction?.lineupSummary?.capturedAt ||
    match?.lineupSummary?.capturedAt || prediction?.lineupSummary?.retrievedAt || match?.lineupSummary?.retrievedAt
  );
  const lineupConfirmedPrematch = Boolean(
    lineup?.confirmed && !lineup?.projected && !lineup?.historicalBackfill && lineup?.preMatchUsable !== false &&
    kickoffAt != null && lineupCapturedAt != null && lineupCapturedAt < kickoffAt && lineupCapturedAt <= now
  );
  const odds = prediction?.oddsAtPrediction || match?.oddsAtPrediction || null;
  const oddsStatus = prediction?.oddsStatus || match?.oddsStatus || null;
  const oddsCapturedAt = parseEvidenceTimestamp(odds?.capturedAt);
  const prices = [odds?.home ?? odds?.homeWin, odds?.draw, odds?.away ?? odds?.awayWin].map(Number);
  const validPrices = prices.every((price) => Number.isFinite(price) && price > 1.01);
  const oddsCompleteFreshPrematch = Boolean(
    oddsStatus !== "historical_market_profile_only" && oddsStatus !== "missing" && oddsStatus !== "partial" &&
    validPrices && kickoffHasTime && kickoffAt != null && oddsCapturedAt != null &&
    oddsCapturedAt <= now && oddsCapturedAt < kickoffAt && kickoffAt - oddsCapturedAt <= 24 * 60 * 60 * 1000
  );
  const h2h = prediction?.h2h || match?.h2h || (Number(prediction?.h2hPlayed || match?.h2hPlayed || 0) > 0 ? { played: prediction?.h2hPlayed || match?.h2hPlayed } : null);
  const h2hAvailable = Number(h2h?.played || h2h?.results?.length || 0) > 0;
  const missing = [
    completeness < 0.7 ? "modeldata" : null,
    !lineupConfirmedPrematch ? "bevestigde prematch-opstelling" : null,
    !oddsCompleteFreshPrematch ? "verse getimestampte 1X2-odds" : null,
  ].filter((item): item is string => Boolean(item));
  return {
    complete: completeness >= 0.7 && lineupConfirmedPrematch && oddsCompleteFreshPrematch,
    score: (3 - missing.length) / 3,
    lineupConfirmedPrematch,
    oddsCompleteFreshPrematch,
    h2hAvailable,
    lineupCapturedAt: lineupCapturedAt == null ? null : new Date(lineupCapturedAt).toISOString(),
    oddsCapturedAt: oddsCapturedAt == null ? null : new Date(oddsCapturedAt).toISOString(),
    missing,
  };
}

export function summarizeMatchEvidenceCoverage(matches: Array<{ match: any; prediction?: any }>) {
  const rows = matches.map(({ match, prediction }) => ({ evidence: getMatchEvidenceCoverage(match, prediction) }));
  const count = (predicate: (evidence: MatchEvidenceCoverage) => boolean) => rows.filter((row) => predicate(row.evidence)).length;
  return {
    matches: rows.length,
    complete: count((evidence) => evidence.complete),
    lineupConfirmedPrematch: count((evidence) => evidence.lineupConfirmedPrematch),
    oddsCompleteFreshPrematch: count((evidence) => evidence.oddsCompleteFreshPrematch),
    h2hAvailable: count((evidence) => evidence.h2hAvailable),
    missing: rows.reduce((acc, row) => {
      for (const item of row.evidence.missing) acc[item] = (acc[item] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };
}
