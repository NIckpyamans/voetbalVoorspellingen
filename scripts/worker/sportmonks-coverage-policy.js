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
  const supportedCountries = supportedSportmonksCountries(catalogReport);
  if (!supportedCountries.size) return [];
  return fixtures.filter((fixture) => {
    const country = normalize(String(fixture?.league || "").split(" - ")[0]);
    return supportedCountries.has(country);
  });
}
