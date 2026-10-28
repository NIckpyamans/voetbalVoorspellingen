// Modelmetingen over de compacte wedstrijdopslag. Alles hier is puur en werkt
// op records uit shared/matchStore.js (d/dq/cf/hit/ex/ge/mk/mh/mp/y/ll/bs), zodat
// de metingen lokaal, in CI en in workflows identiek rekenen.

import { selectCalibration } from "./calibrationFit.js";
import { benchmarkModelVsMarket } from "./marketBenchmark.js";

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function leagueKey(record) {
  return String(record.lg || "Unknown");
}

// 1. Kalibratie: kloppen de voorspellingkansen met de werkelijke frequenties?
// Platt-schaling bestaat al in server-worker.js; dit rapport toetst of de
// kalibratie klopt per confidence-bucket (en per competitie bij genoeg steekproef).
export function calibrationReport(records = [], options = {}) {
  const buckets = Math.max(2, Number(options.buckets || 5));
  const minLeagueSample = Math.max(1, Number(options.minLeagueSample || 30));
  const bucketState = Array.from({ length: buckets }, (_, position) => ({
    from: Math.round((position / buckets) * 100) / 100,
    to: Math.round(((position + 1) / buckets) * 100) / 100,
    n: 0,
    hit: 0,
    confidenceSum: 0,
  }));
  const leagueState = new Map();
  let n = 0;
  let hit = 0;
  let confidenceSum = 0;

  for (const record of records || []) {
    const confidence = Number(record.cf);
    const isHit = typeof record.hit === "boolean" ? record.hit : null;
    if (!Number.isFinite(confidence) || isHit === null) continue;
    n += 1;
    if (isHit) hit += 1;
    confidenceSum += confidence;

    const position = Math.min(buckets - 1, Math.floor(confidence * buckets));
    const bucket = bucketState[position];
    bucket.n += 1;
    if (isHit) bucket.hit += 1;
    bucket.confidenceSum += confidence;

    const league = leagueKey(record);
    if (!leagueState.has(league)) leagueState.set(league, { league, n: 0, hit: 0, confidenceSum: 0 });
    const entry = leagueState.get(league);
    entry.n += 1;
    if (isHit) entry.hit += 1;
    entry.confidenceSum += confidence;
  }

  const bucketRows = bucketState.map((bucket) => ({
    from: bucket.from,
    to: bucket.to,
    n: bucket.n,
    avgConfidence: bucket.n ? Math.round((bucket.confidenceSum / bucket.n) * 1000) / 1000 : null,
    hitPct: bucket.n ? pct(bucket.hit, bucket.n) : null,
    gap: bucket.n
      ? Math.round((bucket.confidenceSum / bucket.n - bucket.hit / bucket.n) * 1000) / 1000
      : null,
  }));
  // Expected Calibration Error: gewogen gemiddelde |verwacht - werkelijk| per bucket.
  const ece = n
    ? Math.round(
        bucketState.reduce((sum, bucket) => {
          if (!bucket.n) return sum;
          return sum
            + (bucket.n / n)
              * Math.abs(bucket.confidenceSum / bucket.n - bucket.hit / bucket.n);
        }, 0) * 1000,
      ) / 1000
    : null;

  return {
    n,
    hitPct: pct(hit, n),
    avgConfidence: n ? Math.round((confidenceSum / n) * 1000) / 1000 : null,
    ece,
    buckets: bucketRows,
    leagues: [...leagueState.values()]
      .filter((entry) => entry.n >= minLeagueSample)
      .map((entry) => ({
        league: entry.league,
        n: entry.n,
        hitPct: pct(entry.hit, entry.n),
        avgConfidence: Math.round((entry.confidenceSum / entry.n) * 1000) / 1000,
      }))
      .sort((left, right) => right.n - left.n),
  };
}

// 2. Tijdsgewijze validatie: toets de prestaties over opeenvolgende vensters, zodat
// gewichtswijzigingen (docs/data-weighting-policy.md) op hun werking in de tijd
// beoordeeld kunnen worden in plaats van op een totaalbeeld.
export function temporalReport(records = [], options = {}) {
  const window = options.window === "week" ? "week" : "month";
  const periodKey = (date) => {
    if (window !== "week") return date.slice(0, 7);
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return date.slice(0, 7);
    const day = (parsed.getUTCDay() + 6) % 7; // maandag = 0
    parsed.setUTCDate(parsed.getUTCDate() - day);
    return parsed.toISOString().slice(0, 10);
  };
  const periodState = new Map();
  for (const record of records || []) {
    const date = String(record.d || "");
    if (date.length < 7) continue;
    const period = periodKey(date);
    if (!periodState.has(period)) {
      periodState.set(period, { period, n: 0, decided: 0, hit: 0, exact: 0, goalErrorSum: 0 });
    }
    const entry = periodState.get(period);
    entry.n += 1;
    if (typeof record.hit === "boolean") {
      entry.decided += 1;
      if (record.hit) entry.hit += 1;
    }
    if (record.ex === true) entry.exact += 1;
    if (Number.isFinite(Number(record.ge))) entry.goalErrorSum += Number(record.ge);
  }
  const periods = [...periodState.values()]
    .sort((left, right) => (left.period < right.period ? -1 : 1))
    .map((entry) => ({
      period: entry.period,
      n: entry.n,
      decided: entry.decided,
      hitPct: pct(entry.hit, entry.decided),
      exactPct: pct(entry.exact, entry.decided),
      avgGoalError: entry.decided
        ? Math.round((entry.goalErrorSum / entry.decided) * 100) / 100
        : null,
    }));
  const first = periods[0] || null;
  const last = periods[periods.length - 1] || null;
  return {
    window,
    periods,
    drift: first && last && periods.length > 1
      ? {
          from: first.period,
          to: last.period,
          hitPctDelta: Math.round((last.hitPct - first.hitPct) * 10) / 10,
          exactPctDelta: Math.round((last.exactPct - first.exactPct) * 10) / 10,
        }
      : null,
  };
}

// 3. Marktbaseline per competitie: model-hitrate tegenover de marktfavoriet uit de
// pre-kickoff odds (oddsAtPrediction). De favoriet is de laagste odd; die keuze is
// invariant onder de-vig, dus de vergelijking is eerlijk zonder aparte de-vig-stap.
// Sinds deze ronde ook op kansniveau (logloss/Brier/RPS) via shared/marketBenchmark.js.
export function marketBaselineReport(records = [], options = {}) {
  const minLeagueSample = Math.max(1, Number(options.minLeagueSample || 30));
  const leagueState = new Map();
  let n = 0;
  let modelHit = 0;
  let marketHit = 0;
  let nPreMatch = 0;
  let nMarketFile = 0;
  for (const record of records || []) {
    if (!record.mk || typeof record.mh !== "boolean") continue;
    const model = typeof record.hit === "boolean" ? record.hit : null;
    if (model === null) continue;
    n += 1;
    if (model) modelHit += 1;
    if (record.mh) marketHit += 1;
    if (record.mks === "fdc") nMarketFile += 1;
    else nPreMatch += 1;
    const league = leagueKey(record);
    if (!leagueState.has(league)) {
      leagueState.set(league, { league, n: 0, modelHit: 0, marketHit: 0 });
    }
    const entry = leagueState.get(league);
    entry.n += 1;
    if (model) entry.modelHit += 1;
    if (record.mh) entry.marketHit += 1;
  }
  const leagues = [...leagueState.values()]
    .filter((entry) => entry.n >= minLeagueSample)
    .map((entry) => ({
      league: entry.league,
      n: entry.n,
      modelHitPct: pct(entry.modelHit, entry.n),
      marketHitPct: pct(entry.marketHit, entry.n),
      edgePct: Math.round(((entry.modelHit - entry.marketHit) / entry.n) * 1000) / 10,
    }))
    .sort((left, right) => right.n - left.n);

  // Kansniveau: de favoriet-hitrate hierboven zegt niet hoe zeker de markt was.
  // Vergelijk daarom de volledige verdeling via logloss, Brier en RPS op precies
  // dezelfde wedstrijden (mp = gede-vigde marktkansen, ll/bs = modelmaten).
  const benchmarkRows = [];
  for (const record of records || []) {
    if (!Array.isArray(record.mp) || record.mp.length !== 3) continue;
    if (!record.y) continue;
    benchmarkRows.push({
      lg: leagueKey(record),
      mp: record.mp,
      y: record.y,
      ll: record.ll,
      bs: record.bs,
    });
  }
  return {
    n,
    nPreMatch,
    nMarketFile,
    modelHitPct: pct(modelHit, n),
    marketHitPct: pct(marketHit, n),
    edgePct: n ? Math.round(((modelHit - marketHit) / n) * 1000) / 10 : null,
    probability: benchmarkModelVsMarket(benchmarkRows, { minLeagueSample }),
    leagues,
  };
}

// 5. Datakwaliteit per voorspelling: timestamp-dekking van de odds, odds-status en
// odds-versheid (dq uit recordFromReview), per competitie samengevat.
export function dataQualityReport(records = [], options = {}) {
  const minLeagueSample = Math.max(1, Number(options.minLeagueSample || 1));
  const leagueState = new Map();
  let withDq = 0;
  let tsSum = 0;
  let tsN = 0;
  let oddsAvailable = 0;
  let ageSum = 0;
  let ageN = 0;
  // Versheidsklassen (shared/oddsFreshness.js): fresh/recent/stale/old/unknown.
  const freshness = { fresh: 0, recent: 0, stale: 0, old: 0, unknown: 0 };
  for (const record of records || []) {
    const dq = record.dq;
    if (!dq) continue;
    withDq += 1;
    const league = leagueKey(record);
    if (!leagueState.has(league)) {
      leagueState.set(league, { league, n: 0, tsSum: 0, tsN: 0, oddsAvailable: 0, ageSum: 0, ageN: 0 });
    }
    const entry = leagueState.get(league);
    entry.n += 1;
    if (Number.isFinite(Number(dq.ts))) {
      tsSum += Number(dq.ts);
      tsN += 1;
      entry.tsSum += Number(dq.ts);
      entry.tsN += 1;
    }
    if (dq.od === "available") {
      oddsAvailable += 1;
      entry.oddsAvailable += 1;
    }
    const cls = freshness[dq.f] !== undefined ? dq.f : "unknown";
    freshness[cls] += 1;
    if (Number.isFinite(Number(dq.h))) {
      ageSum += Number(dq.h);
      ageN += 1;
      entry.ageSum += Number(dq.h);
      entry.ageN += 1;
    }
  }
  return {
    withDq,
    avgTimestampCoverage: tsN ? Math.round((tsSum / tsN) * 1000) / 1000 : null,
    oddsAvailablePct: pct(oddsAvailable, withDq),
    freshness,
    avgOddsAgeHours: ageN ? Math.round((ageSum / ageN) * 10) / 10 : null,
    leagues: [...leagueState.values()]
      .filter((entry) => entry.n >= minLeagueSample)
      .map((entry) => ({
        league: entry.league,
        n: entry.n,
        avgTimestampCoverage: entry.tsN
          ? Math.round((entry.tsSum / entry.tsN) * 1000) / 1000
          : null,
        oddsAvailablePct: pct(entry.oddsAvailable, entry.n),
        avgOddsAgeHours: entry.ageN ? Math.round((entry.ageSum / entry.ageN) * 10) / 10 : null,
      }))
      .sort((left, right) => right.n - left.n),
  };
}

// 4. Lege invoerbronnen: maak per bron zichtbaar of die leeg, dun of gezond is en
// welke actie er nodig is ("vul of verwijder"). Het model rekent niet op ruis doordat
// lege velden nergens in de store terechtkomen; dit rapport benoemt wat nog openstaat.
export function sourceHealthReport(meta = {}) {
  const coverage = meta.sourceCoverage || meta.meta?.sourceCoverage || {};
  const plan = meta.coverageImprovementPlan || meta.meta?.coverageImprovementPlan || [];
  const planBySource = new Map();
  for (const item of plan) {
    if (item?.source) planBySource.set(String(item.source), String(item.action || ""));
  }
  const rows = [];
  for (const [source, level] of Object.entries(coverage)) {
    const coveragePct = level == null ? null : Math.round(Number(level) * 1000) / 10;
    let status = "unknown";
    if (coveragePct === 0) status = "empty";
    else if (coveragePct !== null && coveragePct < 25) status = "thin";
    else if (coveragePct !== null) status = "ok";
    rows.push({
      source,
      coveragePct,
      status,
      action: planBySource.get(source)
        || (status === "empty" ? "Vul de bron of verwijder de invoer uit de pipeline." : ""),
    });
  }
  return {
    sources: rows.sort((left, right) => (left.coveragePct ?? -1) - (right.coveragePct ?? -1)),
    empty: rows.filter((row) => row.status === "empty").map((row) => row.source),
    thin: rows.filter((row) => row.status === "thin").map((row) => row.source),
  };
}

export function allMetrics(records = [], meta = {}, options = {}) {
  return {
    calibration: calibrationReport(records, options),
    calibrationSelection: selectCalibration(records, options),
    temporal: temporalReport(records, options),
    marketBaseline: marketBaselineReport(records, options),
    dataQuality: dataQualityReport(records, options),
    sourceHealth: sourceHealthReport(meta),
  };
}
