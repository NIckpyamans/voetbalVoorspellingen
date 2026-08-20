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

export function getSportmonksApiKey() {
  return String(
    process.env.SPORTMONKS_API_KEY ||
      process.env.MYSPORTS_API_KEY ||
      process.env.MYSPORTMONKS_API_KEY ||
      ""
  ).trim();
}

export const DEFAULT_THE_ODDS_API_URL_TEMPLATE =
  "https://api.the-odds-api.com/v4/sports/{sport}/odds/?apiKey={apiKey}&regions=eu&markets=h2h&oddsFormat=decimal";
export const DEFAULT_SPORTMONKS_ODDS_API_URL_TEMPLATE =
  "https://api.sportmonks.com/v3/football/odds/pre-match/fixtures/{sportmonksFixtureId}?filters=markets:1;bookmakers:2&api_token={apiKey}";

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

function splitTemplates(value = "") {
  return String(value || "")
    .split(/\r?\n|\|\||;;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function keyForTemplate(template, suffix = "") {
  const direct = String(
      process.env[`ODDS_API_KEY${suffix}`] ||
      process.env[`THE_ODDS_API_KEY${suffix}`] ||
      process.env[`SPORTMONKS_API_KEY${suffix}`] ||
      process.env[`MYSPORTS_API_KEY${suffix}`] ||
      process.env[`API_SPORTS_ODDS_KEY${suffix}`] ||
      ""
  ).trim();
  if (direct) return direct;
  const target = String(template || "").toLowerCase();
  if (/sportmonks/.test(target)) return getSportmonksApiKey();
  if (/api-sports|api-football|football\.api-sports/.test(target)) return getApiFootballKey();
  return getOddsApiKey(template);
}

function providerForTemplate(template, suffix = "") {
  const target = String(template || "");
  if (/sportmonks/i.test(target)) return "sportmonks";
  if (/api-sports|api-football|football\.api-sports/i.test(target)) return "api-football";
  if (/the-odds-api/i.test(target)) return "the-odds-api";
  const explicit = String(process.env[`ODDS_PROVIDER_NAME${suffix}`] || "").trim();
  if (explicit) return explicit;
  return getOddsProviderName(template);
}

export function getApiFootballComKey() {
  return String(
    process.env.APIFOOTBALL_API_KEY ||
      process.env.API_FOOTBALL_COM_KEY ||
      ""
  ).trim();
}

export function getGoalApiKey() {
  return String(process.env.GOAL_API_KEY || process.env.API_GOAL || "").trim();
}

export function getOddsProviderConfigs() {
  const configs = [];
  const add = (template, suffix = "") => {
    const value = String(template || "").trim();
    if (!value || configs.some((item) => item.template === value)) return;
    configs.push({
      template: value,
      apiKey: keyForTemplate(value, suffix),
      provider: providerForTemplate(value, suffix),
      suffix,
    });
  };

  add(getOddsApiUrlTemplate(), "");
  for (const template of splitTemplates(process.env.ODDS_API_URL_TEMPLATES)) add(template, "");
  add(process.env.ODDS_API_URL_TEMPLATE_2, "_2");
  add(process.env.ODDS_API_URL_TEMPLATE_3, "_3");
  add(process.env.EXTRA_ODDS_API_URL_TEMPLATE, "_2");
  add(process.env.SPORTMONKS_ODDS_API_URL_TEMPLATE, "");
  if (getSportmonksApiKey()) add(DEFAULT_SPORTMONKS_ODDS_API_URL_TEMPLATE, "");
  return configs;
}

export function buildProviderEnvStatus() {
  const oddsTemplate = getOddsApiUrlTemplate();
  const oddsProvider = getOddsProviderName(oddsTemplate);
  const oddsProviderConfigs = getOddsProviderConfigs();
  return {
    footballDataConfigured: !!getFootballDataApiKey(),
    apiFootballConfigured: !!getApiFootballKey(),
    apiFootballComConfigured: !!getApiFootballComKey(),
    goalApiConfigured: !!getGoalApiKey(),
    sportmonksConfigured: !!getSportmonksApiKey(),
    oddsConfigured: !!getOddsApiKey(oddsTemplate),
    oddsProviderCount: oddsProviderConfigs.length,
    oddsConfiguredProviderCount: oddsProviderConfigs.filter((config) => !!config.apiKey || !/\{apiKey\}/i.test(config.template)).length,
    dedicatedOddsConfigured: !!getDedicatedOddsApiKey(),
    oddsTemplateConfigured: !!oddsTemplate,
    oddsProvider,
  };
}
