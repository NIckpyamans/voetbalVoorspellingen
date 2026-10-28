// Integriteitscontrole op de gebouwde wedstrijdopslag.
//
// De bronnen (dagbestanden, reviews, marktbestand) komen uit meerdere providers.
// Eén record met een onmogelijke score of datum zou als historie meetellen in het
// sterktenmodel en in de kalibratie. Deze module verwijdert zulke records,
// herstelt de uitkomst wanneer die niet bij de doelpunten past en herrekent de
// beoordeling, zodat de opgeslagen geschiedenis intern consistent is.
//
// Bewust een aparte module: shared/matchStore.js blijft ongewijzigd.

import { clubKey } from "./matchStore.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_GOALS = 30;

export function sanitizeMatchStore(store = {}) {
  const matches = {};
  const report = { total: 0, kept: 0, dropped: 0, correctedOutcome: 0, reasons: {} };
  const drop = (reason) => {
    report.dropped += 1;
    report.reasons[reason] = (report.reasons[reason] || 0) + 1;
  };
  for (const [id, record] of Object.entries(store.matches || {})) {
    report.total += 1;
    if (!record || typeof record !== "object") {
      drop("geen-record");
      continue;
    }
    const date = String(record.d || "");
    if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      drop("ongeldige-datum");
      continue;
    }
    const homeName = String(record.h || "").trim();
    const awayName = String(record.a || "").trim();
    if (!homeName || !awayName) {
      drop("team-ontbreekt");
      continue;
    }
    if (clubKey(homeName) === clubKey(awayName)) {
      drop("zelfde-team");
      continue;
    }
    const homeGoals = Number(record.hs);
    const awayGoals = Number(record.as);
    if (
      !Number.isInteger(homeGoals)
      || !Number.isInteger(awayGoals)
      || homeGoals < 0
      || awayGoals < 0
      || homeGoals > MAX_GOALS
      || awayGoals > MAX_GOALS
    ) {
      drop("ongeldige-score");
      continue;
    }
    const clean = { ...record };
    // De doelpunten zijn de bron van waarheid voor de uitkomst.
    const truth = homeGoals > awayGoals ? "H" : homeGoals < awayGoals ? "A" : "D";
    for (const field of ["y", "ao"]) {
      if (clean[field] && clean[field] !== truth) {
        clean[field] = truth;
        report.correctedOutcome += 1;
      }
    }
    // En de beoordeling moet bij die uitkomst passen, anders telt een oude
    // inconsistente hit als modelprestatie mee.
    if (clean.po && clean.ao) clean.hit = clean.po === clean.ao;
    matches[id] = clean;
    report.kept += 1;
  }
  return { store: { ...store, matches }, report };
}
