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

export const DEFAULT_THE_ODDS_API_URL_TEMPLATE =
  "https://api.the-odds-api.com/v4/sports/{sport}/odds/?apiKey={apiKey}&regions=eu&markets=h2h&oddsFormat=decimal";

export function getDedicatedOddsApiKey() {
  return String(process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY || "").trim();
}

export function getOddsProviderName(template = process.env.ODDS_API_URL_TEMPLATE || "") {
  const explicit = String(process.env.ODDS_PROVIDER_NAME || "").trim();
  if (explicit) return explicit;
  if (/api-sports|api-football|football\.api-sports/i.test(String(template || ""))) return "api-football";
  return getDedicatedOddsApiKey() ? "the-odds-api" : "custom-odds-provider";
}

export function getOddsApiUrlTemplate() {
  const template = String(process.env.ODDS_API_URL_TEMPLATE || "").trim();
  if (template) return template;
  const provider = String(process.env.ODDS_PROVIDER_NAME || "").toLowerCase();
  if (getDedicatedOddsApiKey() && (!provider || /the[-_ ]?odds|oddsapi/.test(provider))) {
    return DEFAULT_THE_ODDS_API_URL_TEMPLATE;
  }
  return "";
}

export function getOddsApiKey(template = process.env.ODDS_API_URL_TEMPLATE || "") {
  const dedicatedKey = String(process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY || "").trim();
  if (dedicatedKey) return dedicatedKey;
  const provider = String(process.env.ODDS_PROVIDER_NAME || "").toLowerCase();
  const target = `${template} ${provider}`;
  return /api-sports|api-football/.test(target) ? getApiFootballKey() : "";
}

export function buildProviderEnvStatus() {
  const oddsTemplate = getOddsApiUrlTemplate();
  const oddsProvider = getOddsProviderName(oddsTemplate);
  return {
    footballDataConfigured: !!getFootballDataApiKey(),
    apiFootballConfigured: !!getApiFootballKey(),
    oddsConfigured: !!getOddsApiKey(oddsTemplate),
    dedicatedOddsConfigured: !!getDedicatedOddsApiKey(),
    oddsTemplateConfigured: !!oddsTemplate,
    oddsProvider,
  };
}
