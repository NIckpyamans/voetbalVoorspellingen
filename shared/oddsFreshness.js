// Versheid van de odds op het voorspellingstijdstip.
//
// Een voorspelling die op drie dagen oude odds leunt, is niet hetzelfde product
// als een voorspelling op odds van twee uur voor aftrap. Deze module maakt dat
// onderscheid expliciet: een klasse, een gewichtsvermenigvuldiger voor het
// marktdeel van het ensemble, en een poort die zegt of de odds bruikbaar zijn.
//
// De klassen zijn bewust grof en uitlegbaar:
//   fresh   < 6 uur voor aftrap
//   recent  < 24 uur
//   stale   < 72 uur
//   old     >= 72 uur
//   unknown geen bruikbaar tijdstip (capturedAt of kickoff ontbreekt)

export const ODDS_FRESHNESS_CLASSES = ["fresh", "recent", "stale", "old", "unknown"];

export function oddsAgeHours(capturedAt, kickoff) {
  const captured = Date.parse(String(capturedAt || ""));
  const start = Date.parse(String(kickoff || ""));
  if (!Number.isFinite(captured) || !Number.isFinite(start)) return null;
  const hours = (start - captured) / 3600000;
  // Odds die na de aftrap zijn vastgelegd zijn per definitie lek: geen leeftijd.
  if (!Number.isFinite(hours) || hours < 0) return null;
  return Math.round(hours * 10) / 10;
}

export function classifyOddsAge(hours) {
  if (hours === null || hours === undefined || !Number.isFinite(Number(hours))) return "unknown";
  const value = Number(hours);
  if (value < 6) return "fresh";
  if (value < 24) return "recent";
  if (value < 72) return "stale";
  return "old";
}

export function oddsWeightMultiplier(hours) {
  switch (classifyOddsAge(hours)) {
    case "fresh": return 1;
    case "recent": return 0.85;
    case "stale": return 0.55;
    case "old": return 0.25;
    default: return 0.5;
  }
}

// Poort: mag het marktdeel meewegen, en met welk gewicht?
export function oddsFreshnessGate(hours, options = {}) {
  const minWeight = Number.isFinite(Number(options.minWeight)) ? Number(options.minWeight) : 0.3;
  const weight = oddsWeightMultiplier(hours);
  const freshness = classifyOddsAge(hours);
  return {
    freshness,
    hours: hours === null || hours === undefined ? null : Number(hours),
    weight,
    usable: weight >= minWeight,
    reason: freshness === "unknown"
      ? "geen betrouwbaar tijdstip van de odds"
      : freshness === "old"
        ? "odds ouder dan 72 uur: alleen als zwak signaal gebruiken"
        : null,
  };
}

// Compacte vastlegging in de wedstrijdopslag (dq.h = uren, dq.f = klasse).
export function compactOddsFreshness(capturedAt, kickoff) {
  const hours = oddsAgeHours(capturedAt, kickoff);
  if (hours === null) return null;
  return { h: hours, f: classifyOddsAge(hours) };
}
