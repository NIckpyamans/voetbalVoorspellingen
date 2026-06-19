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

export function getOddsApiKey() {
  return String(
    process.env.ODDS_API_KEY ||
      process.env.THE_ODDS_API_KEY ||
      process.env.API_KEY_API_FOOTBALL ||
      ""
  ).trim();
}
