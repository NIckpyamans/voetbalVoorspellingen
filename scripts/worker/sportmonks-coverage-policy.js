function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function supportedSportmonksCountries(catalogReport = {}) {
  return new Set((catalogReport?.domesticLeagueExamples || [])
    .map((league) => normalize(league?.country))
    .filter(Boolean));
}

export function sportmonksEligibleFixtures(fixtures = [], catalogReport = {}) {
  const list = Array.isArray(fixtures) ? fixtures : [];
  const supportedCountries = supportedSportmonksCountries(catalogReport);
  // Zonder landenlijst in de catalogussync is er geen bewijs dat een competitie
  // buiten het abonnement valt. Eerder gaf dat een lege selectie, waardoor
  // gemapte fixtures (zoals de Nederlandse Eerste Divisie) nooit een
  // Sportmonks-fixture-ID en dus nooit odds kregen.
  if (!supportedCountries.size) return list.filter((fixture) => Boolean(fixture?.league));
  return list.filter((fixture) => {
    const country = normalize(String(fixture?.league || "").split(" - ")[0]);
    return supportedCountries.has(country);
  });
}
