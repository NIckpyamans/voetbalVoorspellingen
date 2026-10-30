// Was er bij de voorspelling genoeg informatie om een uitspraak te doen?
//
// Tot nu toe werd `dataSufficiency` alleen bewaard als een snapshot het veld al
// meegaf; in de praktijk stond het er dus nooit. Daardoor is achteraf niet te
// scheiden tussen een miss die het model fout deed en een miss die onvermijdelijk
// was omdat de invoer ontbrak. Deze module leidt de status af uit wat er wél
// wordt vastgelegd (datacompleetheid, ontbrekende bronvelden, odds-status en
// odds-versheid) en is puur, zodat materialisatie, opslag en analyse dezelfde
// uitkomst krijgen.
//
// Statussen (bewust grof en uitlegbaar):
//   voldoende    score >= 0,85 en hooguit 2 ontbrekende bronvelden
//   beperkt      score >= 0,60, of voldoende score maar te veel gaten
//   onvoldoende  score < 0,60
//   onbekend     geen compleetheidsscore en geen ontbrekende velden vastgelegd

export const SUFFICIENCY_STATUSES = ["voldoende", "beperkt", "onvoldoende", "onbekend"];

export const DEFAULT_SUFFICIENCY_THRESHOLDS = {
  voldoende: 0.85,
  beperkt: 0.6,
  maxMissingForVoldoende: 2,
};

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function round(value, digits = 3) {
  return Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
}

// Een lege `missingData` betekent "niet meegeleverd", niet "niets ontbreekt".
// Anders wist een aanroeper die het veld leeg doorgeeft de wél bekende gaten uit
// `dataCompleteness.missing` — en dan verdwijnt precies de reden die je wilt zien.
function missingFields(input = {}) {
  if (Array.isArray(input.missingData) && input.missingData.length) return input.missingData;
  if (Array.isArray(input.dataCompleteness?.missing)) return input.dataCompleteness.missing;
  return [];
}

function completenessScore(input = {}) {
  const raw = input.dataCompleteness?.score ?? input.dataCompletenessScore;
  const score = Number(raw);
  return Number.isFinite(score) ? clamp01(score) : null;
}

// `odds` mag een oddsStatus-string zijn of een object met capturedAt/kickoff.
// Alleen een ontbrekende of te oude markt is een reden; een ontbrekende odds-status
// is dat niet (de meeste bronnen leveren die niet mee).
function oddsFactors(input = {}) {
  const reasons = [];
  const status = String(input.oddsStatus || "").toLowerCase();
  if (status && (status.includes("missing") || status === "geen" || status === "none")) {
    reasons.push("odds-ontbreken");
  }
  const freshness = input.freshness?.f || input.oddsFreshness || null;
  if (freshness === "old") reasons.push("odds-te-oud");
  else if (freshness === "stale") reasons.push("odds-gedateerd");
  return reasons;
}

export function deriveDataSufficiency(input = {}, options = {}) {
  const thresholds = { ...DEFAULT_SUFFICIENCY_THRESHOLDS, ...(options.thresholds || {}) };
  const score = completenessScore(input);
  const missing = missingFields(input);
  const reasons = [];
  if (missing.length > thresholds.maxMissingForVoldoende) reasons.push("te-veel-ontbrekende-bronnen");
  reasons.push(...oddsFactors(input));

  let status = "onbekend";
  if (score === null && missing.length === 0 && reasons.length === 0) {
    status = "onbekend";
  } else if (score === null) {
    // Geen score, maar wel gaten bekend: alleen de gaten bepalen het oordeel.
    status = missing.length > thresholds.maxMissingForVoldoende ? "beperkt" : "onbekend";
  } else if (score >= thresholds.voldoende && missing.length <= thresholds.maxMissingForVoldoende) {
    status = "voldoende";
  } else if (score >= thresholds.beperkt) {
    status = "beperkt";
  } else {
    status = "onvoldoende";
  }

  return {
    status,
    score: round(score),
    missingCount: missing.length,
    reasons,
    // Bewust expliciet: een "onbekend" is geen "voldoende".
    enoughInformation: status === "voldoende",
  };
}

// Zelfde afleiding, maar dan vanaf een compact opgeslagen wedstrijdrecord.
// De opslag bewaart dq = { cs, mi, sf, od, h, f } (zie shared/matchStore.js).
// Een opgeslagen `sf` wint altijd: dat is wat er bij de voorspelling gold.
export function sufficiencyFromStoreRecord(record = {}, options = {}) {
  const stored = record?.dq?.sf ? String(record.dq.sf) : null;
  if (stored) {
    return {
      status: stored,
      score: Number.isFinite(Number(record.dq.cs)) ? round(Number(record.dq.cs)) : null,
      missingCount: Number.isFinite(Number(record.dq.mi)) ? Number(record.dq.mi) : null,
      reasons: [],
      enoughInformation: stored === "voldoende",
      source: "opgeslagen",
    };
  }
  const derived = deriveDataSufficiency({
    dataCompleteness: Number.isFinite(Number(record?.dq?.cs)) ? { score: Number(record.dq.cs) } : null,
    missingData: Number.isFinite(Number(record?.dq?.mi))
      ? Array.from({ length: Number(record.dq.mi) }, (_, index) => `onbekend-${index + 1}`)
      : [],
    oddsStatus: record?.dq?.od || null,
    freshness: { f: record?.dq?.f || null },
  }, options);
  return { ...derived, source: "afgeleid" };
}
