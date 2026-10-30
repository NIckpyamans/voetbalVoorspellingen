// Analyse-bot: waar ging het mis, en wat zou er anders moeten?
//
// Deze module kijkt achteraf naar elke beoordeelde wedstrijd in de compacte
// opslag en beantwoordt per competitie drie vragen:
//
//   1. Was er bij de voorspelling genoeg informatie? (dq.cs / dq.mi / dq.sf)
//   2. Wie had er gelijk waar het model ernaast zat: de markt of een component?
//   3. Wat zou er dan anders moeten — marktgewicht, zekerheid, databron?
//
// Bewust puur en zonder neveneffecten: dit levert een *voorstel*, het past niets
// toe. Een aanpassing hoort via de bestaande poorten te lopen
// (shared/ensembleWeightFit.js met holdout, calibrationFit, ...) en niet omdat
// een analyse-script dat wil.
//
// De voorstellen zijn per competitie, omdat het model per competitie verschillend
// presteert: één globaal marktgewicht is aantoonbaar te grof.

import { sufficiencyFromStoreRecord } from "./dataSufficiency.js";

const OUTCOME_INDEX = { H: 0, D: 1, A: 2 };
const EPS = 1e-9;

export const DEFAULT_MISS_ANALYSIS_OPTIONS = {
  minSample: 20,
  // Een voorstel pas doen bij genoeg bewijs; anders is het ruis.
  minEvidence: 5,
  marketRightShareThreshold: 0.5,
  dataGapShareThreshold: 0.4,
  overconfidenceGapThreshold: 0.15,
  componentShareThreshold: 0.35,
  unknownSufficiencyShareThreshold: 0.5,
};

function round(value, digits = 3) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 10 ** digits) / 10 ** digits;
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : null;
}

function mean(values) {
  const clean = values.map(Number).filter((value) => Number.isFinite(value));
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function marketLogLoss(record) {
  const actual = OUTCOME_INDEX[String(record.ao || "").toUpperCase()];
  const market = Array.isArray(record.mp) ? record.mp.map(Number) : null;
  if (actual === undefined || !market || market.length !== 3) return null;
  const probability = market[actual];
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) return null;
  return -Math.log(Math.max(EPS, probability));
}

function topOutcome(values) {
  if (!Array.isArray(values) || values.length !== 3) return null;
  const [home, draw, away] = values.map(Number);
  if (![home, draw, away].every((value) => Number.isFinite(value))) return null;
  if (home >= draw && home >= away) return "H";
  if (away >= draw && away >= home) return "A";
  return "D";
}

// Een record telt mee als de uitslag beoordeeld is: zonder hit en zonder
// werkelijke uitkomst valt er niets te evalueren.
// Let op: `H` heeft index 0, dus een truthiness-check op de index zou elke
// thuiswinst als "niet beoordeeld" wegfilteren. Expliciet op undefined toetsen.
function isDecided(record) {
  if (!record || typeof record !== "object") return false;
  if (OUTCOME_INDEX[String(record.ao || "").toUpperCase()] === undefined) return false;
  return typeof record.hit === "boolean";
}

function decideProposal(stats, options) {
  const { minSample, minEvidence } = options;
  if (stats.decided < minSample) {
    return {
      code: "te-weinig-data",
      action: "Nog geen bijsturing: te weinig beoordeelde duels in deze competitie.",
      confidence: "laag",
      evidence: { decided: stats.decided, minSample },
    };
  }

  // 1. Ontbrekende invoer eerst: aan gewichten sleutelen terwijl de bron leeg
  //    was, verbergt het echte probleem.
  if (stats.data.insufficientMissShare !== null
    && stats.data.insufficientMissShare >= options.dataGapShareThreshold
    && stats.data.insufficientMisses >= minEvidence) {
    return {
      code: "data-eerst",
      action: "Eerst de databronnen voor deze competitie repareren; de meeste misses hadden geen volledige invoer.",
      confidence: "hoog",
      evidence: {
        insufficientMissShare: stats.data.insufficientMissShare,
        insufficientMisses: stats.data.insufficientMisses,
        avgCompletenessOnMiss: stats.data.avgCompletenessOnMiss,
      },
    };
  }

  // 2. Markt had het vaker goed waar het model ernaast zat: marktgewicht omhoog.
  if (stats.market.disagreeButRightShare !== null
    && stats.market.disagreeButRightShare >= options.marketRightShareThreshold
    && stats.market.disagreeButRight >= minEvidence) {
    return {
      code: "marktgewicht-omhoog",
      action: "Marktgewicht voor deze competitie verhogen; de markt had vaak gelijk waar het model afweek.",
      confidence: "hoog",
      evidence: {
        disagreeButRight: stats.market.disagreeButRight,
        disagreeButRightShare: stats.market.disagreeButRightShare,
        modelLogLoss: stats.market.modelLogLoss,
        marketLogLoss: stats.market.marketLogLoss,
      },
    };
  }

  // 3. Even zelfverzekerd bij een miss als bij een hit: zekerheid dempen.
  if (stats.confidence.gapVsHitRate !== null
    && stats.confidence.gapVsHitRate >= options.overconfidenceGapThreshold) {
    return {
      code: "zekerheid-temper",
      action: "Zekerheid voor deze competitie dempen; het model is er even stellig bij een miss als bij een hit.",
      confidence: "hoog",
      evidence: {
        avgConfidenceOnMiss: stats.confidence.avgOnMiss,
        avgConfidenceOnHit: stats.confidence.avgOnHit,
        hitPct: stats.hitPct,
        gapVsHitRate: stats.confidence.gapVsHitRate,
      },
    };
  }

  // 4. Eén component had op de misses vaker de juiste kant: herweging onderzoeken.
  const component = stats.components.find(
    (entry) => entry.active && entry.rightOnMissShare !== null
      && entry.rightOnMissShare >= options.componentShareThreshold
      && entry.rightOnMiss >= minEvidence,
  );
  if (component) {
    return {
      code: "component-herwegen",
      action: `Component "${component.key}" had op de misses vaak de juiste kant; onderzoek of die in deze competitie meer gewicht verdient.`,
      confidence: "laag",
      evidence: {
        component: component.key,
        rightOnMiss: component.rightOnMiss,
        rightOnMissShare: component.rightOnMissShare,
      },
    };
  }

  return {
    code: "geen-bijsturing",
    action: "Geen aanwijzing voor een gerichte aanpassing in deze competitie; de fout zit niet bij één bron.",
    confidence: "laag",
    evidence: { hitPct: stats.hitPct, missPct: stats.missPct },
  };
}

function groupStats(records, options) {
  const decided = records.filter(isDecided);
  const hits = decided.filter((record) => record.hit === true);
  const misses = decided.filter((record) => record.hit === false);

  const sufficiency = { voldoende: 0, beperkt: 0, onvoldoende: 0, onbekend: 0 };
  const missSufficiency = { voldoende: 0, beperkt: 0, onvoldoende: 0, onbekend: 0 };
  let withQuality = 0;
  let staleOdds = 0;
  let qualitySample = 0;
  const completeness = [];
  const completenessOnMiss = [];
  const missingCounts = [];

  for (const record of decided) {
    const info = sufficiencyFromStoreRecord(record);
    const status = sufficiency[info.status] === undefined ? "onbekend" : info.status;
    sufficiency[status] += 1;
    if (record.hit === false) missSufficiency[status] += 1;
    if (info.source === "opgeslagen" || info.score !== null) withQuality += 1;
    if (info.score !== null) {
      completeness.push(info.score);
      if (record.hit === false) completenessOnMiss.push(info.score);
    }
    if (Number.isFinite(Number(record?.dq?.mi))) missingCounts.push(Number(record.dq.mi));
    if (record?.dq?.f) {
      qualitySample += 1;
      if (record.dq.f === "stale" || record.dq.f === "old") staleOdds += 1;
    }
  }

  const insufficientMisses = missSufficiency.onvoldoende + missSufficiency.beperkt;
  const insufficientMissShare = misses.length
    ? round(insufficientMisses / misses.length)
    : null;

  // Markt: alleen duels waar zowel de modelfavoriet (po) als de marktfavoriet
  // (mk) en de werkelijke uitslag bekend zijn, zijn vergelijkbaar.
  const marketComparable = decided.filter((record) => record.mk && record.po);
  const agree = marketComparable.filter((record) => record.mk === record.po);
  const disagree = marketComparable.filter((record) => record.mk !== record.po);
  const disagreeButRight = disagree.filter((record) => record.mh === true);
  const modelLosses = decided.map((record) => Number(record.ll)).filter((value) => Number.isFinite(value));
  const marketLosses = decided.map(marketLogLoss).filter((value) => value !== null);

  const components = new Map();
  for (const record of misses) {
    if (!Array.isArray(record.cp)) continue;
    for (const entry of record.cp) {
      if (!Array.isArray(entry) || !entry[0]) continue;
      const key = String(entry[0]);
      const active = Number(entry[1]) === 1;
      const prediction = topOutcome(entry.slice(2, 5));
      const state = components.get(key) || { key, active, seen: 0, right: 0 };
      state.seen += 1;
      if (active) state.active = true;
      if (prediction && prediction === record.ao) state.right += 1;
      components.set(key, state);
    }
  }

  const stats = {
    decided: decided.length,
    hits: hits.length,
    misses: misses.length,
    hitPct: pct(hits.length, decided.length),
    missPct: pct(misses.length, decided.length),
    // Ook de fijnere maten uit de opslag, zodat een miss niet alleen als 1X2-fout
    // telt maar ook laat zien hoe ver de score ernaast zat.
    exactHitPct: pct(decided.filter((record) => record.ex === true).length, decided.length),
    avgGoalError: round(mean(decided.map((record) => record.ge))),
    confidence: {
      avgOnHit: round(mean(hits.map((record) => record.cf))),
      avgOnMiss: round(mean(misses.map((record) => record.cf))),
      // Hoeveel stelliger is het model bij een miss dan de werkelijkheid toelaat?
      gapVsHitRate: decided.length
        ? round((mean(misses.map((record) => record.cf)) ?? 0) - (hits.length / decided.length))
        : null,
    },
    market: {
      comparable: marketComparable.length,
      agree: agree.length,
      agreeHitPct: pct(agree.filter((record) => record.hit === true).length, agree.length),
      disagree: disagree.length,
      disagreeButRight: disagreeButRight.length,
      disagreeButRightShare: disagree.length ? round(disagreeButRight.length / disagree.length) : null,
      modelLogLoss: round(mean(modelLosses)),
      marketLogLoss: round(mean(marketLosses)),
      veredict: meanLossVerdict(mean(modelLosses), mean(marketLosses)),
    },
    data: {
      withQuality,
      qualityShare: pct(withQuality, decided.length),
      avgCompleteness: round(mean(completeness)),
      avgCompletenessOnMiss: round(mean(completenessOnMiss)),
      avgMissing: round(mean(missingCounts)),
      sufficiency,
      missSufficiency,
      insufficientMisses,
      insufficientMissShare,
      staleOddsShare: qualitySample ? round(staleOdds / qualitySample) : null,
    },
    components: [...components.values()]
      .map((entry) => ({
        key: entry.key,
        active: entry.active,
        seenOnMiss: entry.seen,
        rightOnMiss: entry.right,
        rightOnMissShare: entry.seen ? round(entry.right / entry.seen) : null,
      }))
      .sort((left, right) => right.rightOnMiss - left.rightOnMiss)
      .slice(0, 8),
  };
  stats.proposal = decideProposal(stats, options);
  return stats;
}

// Koppelt de uitkomst van de marktgewicht-poort (shared/ensembleWeightFit.js,
// holdout) aan elk voorstel. Zonder deze koppeling leest "marktgewicht-omhoog"
// als een ingreep, terwijl de poort hem misschien helemaal niet doorlaat. Puur:
// de analyse verandert niets, ze maakt alleen zichtbaar of een advies ergens
// terechtkomt.
export function annotateProposalsWithWeightGate(analysis, byCompetition = null) {
  const gate = byCompetition && typeof byCompetition === "object" ? byCompetition : null;
  const byLeague = new Map();
  for (const entry of gate?.competitions || []) {
    if (entry?.league) byLeague.set(String(entry.league), entry);
  }

  const statusFor = (league) => {
    if (!gate) return { status: "geen-meting", applies: false };
    const entry = byLeague.get(String(league));
    if (!entry) return { status: "buiten-de-meting", applies: false };
    if (entry.available === false) {
      return {
        status: "te-weinig-paren",
        applies: false,
        sample: entry.sample ?? null,
        minSample: entry.minSample ?? null,
      };
    }
    if (entry.holdoutImproves) {
      return {
        status: "poort-gehaald",
        applies: true,
        weight: entry.recommendedWeight ?? null,
        sample: entry.sample ?? null,
      };
    }
    return { status: "holdout-niet-bevestigd", applies: false, sample: entry.sample ?? null };
  };

  // Alleen voorstellen die over het marktgewicht gaan hebben deze poort nodig;
  // de overige codes worden door een ander pad beslecht.
  const annotate = (proposal, league) => {
    if (!proposal || proposal.code !== "marktgewicht-omhoog") return;
    proposal.gate = statusFor(league);
  };

  for (const competition of analysis?.competitions || []) {
    annotate(competition.proposal, competition.league);
  }
  for (const proposal of analysis?.proposals || []) annotate(proposal, proposal.league);
  return analysis;
}

function meanLossVerdict(modelLoss, marketLoss) {
  if (modelLoss === null || marketLoss === null) return null;
  if (modelLoss + 0.002 < marketLoss) return "model-beter";
  if (marketLoss + 0.002 < modelLoss) return "markt-beter";
  return "gelijk";
}

// Hoofdfunctie: alle beoordeelde wedstrijden groeperen per competitie en per
// geheel, met per groep één voorstel.
export function analysePredictionMisses(records = [], options = {}) {
  const settings = { ...DEFAULT_MISS_ANALYSIS_OPTIONS, ...(options || {}) };
  const decided = (records || []).filter(isDecided);

  const byLeague = new Map();
  for (const record of decided) {
    const league = String(record.lg || "Onbekend");
    if (!byLeague.has(league)) byLeague.set(league, []);
    byLeague.get(league).push(record);
  }

  const competitions = [...byLeague.entries()]
    .map(([league, leagueRecords]) => ({ league, ...groupStats(leagueRecords, settings) }))
    .sort((left, right) => right.decided - left.decided);

  const overall = groupStats(decided, settings);

  // Algemene waarschuwing: zolang de sufficiency meestal onbekend is, is de hele
  // analyse blind op het punt dat de gebruiker juist wil weten.
  const unknownShare = overall.decided
    ? round((overall.data.sufficiency.onbekend || 0) / overall.decided)
    : null;
  const notes = [];
  if (unknownShare !== null && unknownShare >= settings.unknownSufficiencyShareThreshold) {
    notes.push({
      code: "sufficiency-onbekend",
      message: `${Math.round(unknownShare * 100)}% van de beoordeelde duels heeft geen vastgelegde datakwaliteit; die wordt nu bij materialisatie afgeleid (shared/dataSufficiency.js), dus nieuwe reviews vullen dit wel.`,
      applied: false,
    });
  }
  if (overall.data.staleOddsShare !== null && overall.data.staleOddsShare >= 0.5) {
    notes.push({
      code: "odds-gedateerd",
      message: `${Math.round(overall.data.staleOddsShare * 100)}% van de vastgelegde odds is ouder dan 24 uur; die wegen niet mee in de marktgewicht-fit.`,
      applied: false,
    });
  }

  const proposals = [];
  for (const competition of competitions) {
    if (competition.proposal.code === "geen-bijsturing" || competition.proposal.code === "te-weinig-data") continue;
    proposals.push({ league: competition.league, ...competition.proposal, applied: false });
  }
  // Het algemene voorstel alleen toevoegen wanneer geen enkele competitie het al
  // doet: dezelfde boodschap twee keer in de lijst is ruis.
  const competitionCodes = new Set(competitions.map((entry) => entry.proposal.code));
  if (overall.proposal.code !== "geen-bijsturing"
    && overall.proposal.code !== "te-weinig-data"
    && !competitionCodes.has(overall.proposal.code)) {
    proposals.push({ league: "*", ...overall.proposal, applied: false });
  }

  return {
    minSample: settings.minSample,
    sample: {
      records: (records || []).length,
      decided: decided.length,
      competitions: competitions.length,
    },
    overall,
    competitions,
    proposals,
    notes,
    // Expliciet: dit script past niets toe. Een voorstel wordt pas werkelijkheid
    // via de holdout-poort van shared/ensembleWeightFit.js of een handmatige stap.
    applied: false,
  };
}
