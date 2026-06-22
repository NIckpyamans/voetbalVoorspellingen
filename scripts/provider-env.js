export function getFootballDataApiKey() {
  return String(
    process.env.FOOTBALL_DATA_TOKEN ||
      process.env.FOOTBALL_DATA_API_KEY ||
      process.env.API_KEY_FOOTBALL_DATA ||
      ""
  ).trim();
}

export function getApiFootballKey() {
  return String(
    process.env.API_KEY_API_FOOTBALL ||
      process.env.API_FOOTBALL_KEY ||
      process.env.APISPORTS_KEY ||
      ""
  ).trim();
}

export function getOddsApiKey(template = process.env.ODDS_API_URL_TEMPLATE || "") {
  const dedicatedKey = String(process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY || "").trim();
  if (dedicatedKey) return dedicatedKey;
  const provider = String(process.env.ODDS_PROVIDER_NAME || "").toLowerCase();
  const target = `${template} ${provider}`;
  return /api-sports|api-football/.test(target) ? getApiFootballKey() : "";
}
