import { getOddsApiKey, getOddsApiUrlTemplate, getOddsProviderConfigs, getOddsProviderName } from "./provider-env.js";

const responseCache = new Map();
// Een volledige worker kan meerdere minuten duren; dezelfde sportmarkt hoeft binnen die run maar eenmaal opgehaald te worden.
const RESPONSE_CACHE_TTL_MS = 30 * 60 * 1000;

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function coreNameTokens(value) {
  return normalizeName(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !["fc", "sc", "afc", "cf", "ac", "club", "the", "de", "la", "sv", "fk", "bk"].includes(token));
}

function namesSimilar(a, b) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 5 && right.length >= 5 && (left.includes(right) || right.includes(left))) return true;
  const leftTokens = coreNameTokens(left);
  const rightTokens = coreNameTokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;
  const overlap = leftTokens.filter((token) => rightTokens.includes(token)).length;
  const denominator = Math.max(1, Math.min(leftTokens.length, rightTokens.length));
  return overlap / denominator >= 0.67;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 1 ? number : null;
}

function isBeforeOrAt(value, cutoff, toleranceMs = 0) {
  const valueMs = Date.parse(value || "");
  const cutoffMs = Date.parse(cutoff || "");
  if (!Number.isFinite(valueMs) || !Number.isFinite(cutoffMs)) return true;
  return valueMs <= cutoffMs + toleranceMs;
}

function replaceTemplate(template, variables) {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const value = variables[key] ?? "";
    return encodeURIComponent(String(value));
  });
}

function configuredExtraSports() {
  return String(process.env.ODDS_API_EXTRA_SPORTS || "")
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function inferOddsApiSportKeys(match = {}) {
  const override = process.env.ODDS_API_SPORT || process.env.ODDS_SPORT_KEY || "";
  if (override.trim()) return unique([override.trim(), ...configuredExtraSports()]);
  const league = normalizeName(match.league || "");
  const mappings = [
    [/champions league.*qual|qual.*champions league|ucl.*qual/, "soccer_uefa_champs_league_qualification"],
    [/europa league.*qual|qual.*europa league/, "soccer_uefa_europa_league_qualification"],
    [/conference league.*qual|qual.*conference league/, "soccer_uefa_europa_conference_league_qualification"],
    [/premier league/, "soccer_epl"],
    [/championship/, "soccer_efl_champ"],
    [/laliga|la liga/, "soccer_spain_la_liga"],
    [/serie a/, "soccer_italy_serie_a"],
    [/bundesliga/, "soccer_germany_bundesliga"],
    [/ligue 1/, "soccer_france_ligue_one"],
    [/eredivisie/, "soccer_netherlands_eredivisie"],
    [/liga portugal|portugal/, "soccer_portugal_primeira_liga"],
    [/champions league/, "soccer_uefa_champs_league"],
    [/europa league/, "soccer_uefa_europa_league"],
    [/conference league/, "soccer_uefa_europa_conference_league"],
  ];
  const primary = mappings.find(([pattern]) => pattern.test(league))?.[1] || "soccer_epl";
  const fallbackByFamily = [];
  if (/champions league|ucl|europe/.test(league)) {
    fallbackByFamily.push("soccer_uefa_champs_league_qualification", "soccer_uefa_champs_league");
  }
  if (/europa league|europe/.test(league)) {
    fallbackByFamily.push("soccer_uefa_europa_league_qualification", "soccer_uefa_europa_league");
  }
  if (/conference league|europe/.test(league)) {
    fallbackByFamily.push("soccer_uefa_europa_conference_league_qualification", "soccer_uefa_europa_conference_league");
  }
  fallbackByFamily.push(...configuredExtraSports());
  return unique([primary, ...fallbackByFamily]);
}

function inferOddsApiSportKey(match = {}) {
  return inferOddsApiSportKeys(match)[0] || "soccer_epl";
}

function pickFlatOdds(node) {
  if (!node || typeof node !== "object") return null;
  const odds = node.odds && typeof node.odds === "object" ? node.odds : node;
  const home = numberOrNull(odds.home ?? odds.homeOdds ?? odds.oddsHome ?? odds.choice1?.value);
  const draw = numberOrNull(odds.draw ?? odds.drawOdds ?? odds.oddsDraw ?? odds.choiceX?.value);
  const away = numberOrNull(odds.away ?? odds.awayOdds ?? odds.oddsAway ?? odds.choice2?.value);
  const closingHome = numberOrNull(odds.closingHome ?? odds.homeClosing ?? odds.closeHome ?? odds.home_close);
  const closingDraw = numberOrNull(odds.closingDraw ?? odds.drawClosing ?? odds.closeDraw ?? odds.draw_close);
  const closingAway = numberOrNull(odds.closingAway ?? odds.awayClosing ?? odds.closeAway ?? odds.away_close);
  if (!home && !draw && !away) return null;
  return {
    home,
    draw,
    away,
    closingHome,
    closingDraw,
    closingAway,
    bookmaker: odds.bookmaker || odds.source || node.bookmaker || node.source || null,
    market: odds.market || node.market || "1X2",
    capturedAt: odds.capturedAt || odds.timestamp || node.capturedAt || node.timestamp || null,
    closingCapturedAt: odds.closingCapturedAt || odds.closingTimestamp || node.closingCapturedAt || node.closingTimestamp || null,
  };
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function sportmonksName(value) {
  return normalizeName(value?.name || value?.label || value?.description || value);
}

function sportmonksOddsValue(odd) {
  return numberOrNull(odd?.value ?? odd?.dp3 ?? odd?.decimal ?? odd?.odds ?? odd?.price);
}

function collectSportmonksFixtures(node, fixtures = []) {
  if (!node || typeof node !== "object") return fixtures;
  const fixtureLike =
    (node.participants || node.localteam || node.visitorteam || node.home_team || node.away_team) &&
    (node.odds || node.fixtureOdds || node.prematch_odds || node.bookmakers);
  if (fixtureLike) fixtures.push(node);
  for (const key of ["data", "fixtures", "fixture", "round", "stage", "league"]) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach((item) => collectSportmonksFixtures(item, fixtures));
    else if (child && typeof child === "object") collectSportmonksFixtures(child, fixtures);
  }
  return fixtures;
}

function sportmonksParticipants(fixture) {
  const participants = asArray(fixture?.participants || fixture?.participant || fixture?.teams);
  const home =
    participants.find((item) => item?.meta?.location === "home") ||
    participants.find((item) => item?.location === "home") ||
    fixture?.localteam ||
    fixture?.home_team;
  const away =
    participants.find((item) => item?.meta?.location === "away") ||
    participants.find((item) => item?.location === "away") ||
    fixture?.visitorteam ||
    fixture?.away_team;
  return { home: home?.name || home?.team_name || null, away: away?.name || away?.team_name || null };
}

function sportmonksOddsRows(fixtureOrPayload) {
  const raw = [
    ...asArray(fixtureOrPayload?.odds),
    ...asArray(fixtureOrPayload?.fixtureOdds),
    ...asArray(fixtureOrPayload?.prematch_odds),
  ];
  for (const bookmaker of asArray(fixtureOrPayload?.bookmakers)) {
    raw.push(...asArray(bookmaker?.odds).map((odd) => ({ ...odd, bookmaker: odd.bookmaker || bookmaker.name || bookmaker.id })));
  }
  return raw.flatMap((row) => asArray(row?.data || row));
}

function extractSportmonksSnapshot(payload, match) {
  const fixtures = collectSportmonksFixtures(payload);
  const homeName = normalizeName(match.homeTeam);
  const awayName = normalizeName(match.awayTeam);
  const fixture =
    fixtures.find((item) => {
      const participants = sportmonksParticipants(item);
      return namesSimilar(participants.home, homeName) && namesSimilar(participants.away, awayName);
    }) ||
    fixtures.find((item) => {
      const participants = sportmonksParticipants(item);
      return namesSimilar(participants.away, homeName) && namesSimilar(participants.home, awayName);
    }) ||
    (fixtures.length === 1 ? fixtures[0] : null);
  const rows = fixture ? sportmonksOddsRows(fixture) : sportmonksOddsRows(payload);
  if (!rows.length) return null;

  const fulltimeRows = rows.filter((odd) => {
    const market = sportmonksName(odd?.market || odd?.market_description || odd?.market_name || odd?.market?.name);
    const marketId = Number(odd?.market_id || odd?.market?.id || 0);
    return marketId === 1 || /fulltime result|full time result|match winner|1x2|3way|3 way/.test(market);
  });
  const candidates = fulltimeRows.length ? fulltimeRows : rows;
  const home = candidates.find((odd) => ["home", "1"].includes(sportmonksName(odd)) || namesSimilar(odd?.name, homeName));
  const draw = candidates.find((odd) => ["draw", "x"].includes(sportmonksName(odd)));
  const away = candidates.find((odd) => ["away", "2"].includes(sportmonksName(odd)) || namesSimilar(odd?.name, awayName));
  const snapshot = {
    home: sportmonksOddsValue(home),
    draw: sportmonksOddsValue(draw),
    away: sportmonksOddsValue(away),
    bookmaker: home?.bookmaker?.name || home?.bookmaker || draw?.bookmaker?.name || draw?.bookmaker || away?.bookmaker?.name || away?.bookmaker || "sportmonks",
    market: home?.market_description || home?.market?.name || draw?.market_description || draw?.market?.name || "Fulltime Result",
    capturedAt: home?.latest_bookmaker_update || home?.updated_at || draw?.latest_bookmaker_update || draw?.updated_at || away?.latest_bookmaker_update || away?.updated_at || null,
  };
  return snapshot.home || snapshot.draw || snapshot.away ? snapshot : null;
}

function extractTheOddsApiSnapshot(payload, match) {
  const events = Array.isArray(payload) ? payload : payload?.events || payload?.data || [];
  if (!Array.isArray(events)) return null;
  const homeName = normalizeName(match.homeTeam);
  const awayName = normalizeName(match.awayTeam);
  const event =
    events.find((item) => {
      const home = item?.home_team || item?.homeTeam || item?.home;
      const away = item?.away_team || item?.awayTeam || item?.away;
      return (!homeName || namesSimilar(home, homeName)) && (!awayName || namesSimilar(away, awayName));
    }) ||
    events.find((item) => {
      const home = item?.home_team || item?.homeTeam || item?.home;
      const away = item?.away_team || item?.awayTeam || item?.away;
      return (!homeName || namesSimilar(away, homeName)) && (!awayName || namesSimilar(home, awayName));
    });
  if (!event) return null;

  for (const bookmaker of event.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      const key = String(market.key || market.market || "").toLowerCase();
      if (key && !["h2h", "1x2", "match_winner"].includes(key)) continue;
      const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
      const home = outcomes.find((outcome) => namesSimilar(outcome.name, homeName));
      const away = outcomes.find((outcome) => namesSimilar(outcome.name, awayName));
      const draw = outcomes.find((outcome) => ["draw", "gelijkspel", "x"].includes(normalizeName(outcome.name)));
      const snapshot = {
        home: numberOrNull(home?.price),
        draw: numberOrNull(draw?.price),
        away: numberOrNull(away?.price),
        bookmaker: bookmaker.title || bookmaker.key || null,
        market: market.key || "h2h",
        capturedAt: bookmaker.last_update || market.last_update || event.commence_time || null,
      };
      if (snapshot.home || snapshot.draw || snapshot.away) return snapshot;
    }
  }
  return null;
}

export function normalizeOddsSnapshot(raw, match, options = {}) {
  const provider = options.provider || process.env.ODDS_PROVIDER_NAME || "custom-odds-provider";
  const generatedAt = options.generatedAt || new Date().toISOString();
  const cutoffAt = options.cutoffAt || generatedAt;
  const kickoff = match?.kickoff || options.kickoff || null;
  const snapshot = pickFlatOdds(raw) || extractSportmonksSnapshot(raw, match || {}) || extractTheOddsApiSnapshot(raw, match || {});
  if (!snapshot) {
    return {
      status: "not_found",
      oddsAtPrediction: null,
      reason: "Provider gaf geen herkenbare 1X2 odds terug.",
    };
  }

  const capturedAt = snapshot.capturedAt || generatedAt;
  if (!isBeforeOrAt(capturedAt, cutoffAt, 2 * 60 * 1000) || !isBeforeOrAt(capturedAt, kickoff)) {
    return {
      status: "rejected_after_cutoff",
      oddsAtPrediction: null,
      reason: "Odds zijn na cutoff of kickoff vastgelegd en worden niet als pre-match input opgeslagen.",
      capturedAt,
      cutoffAt,
      kickoff,
    };
  }

  const validCount = [snapshot.home, snapshot.draw, snapshot.away].filter(Boolean).length;
  return {
    status: validCount === 3 ? "available" : "partial",
    oddsAtPrediction: {
      provider,
      bookmaker: snapshot.bookmaker || provider,
      market: snapshot.market || "1X2",
      home: snapshot.home,
      draw: snapshot.draw,
      away: snapshot.away,
      capturedAt,
      closingHome: snapshot.closingHome,
      closingDraw: snapshot.closingDraw,
      closingAway: snapshot.closingAway,
      closingCapturedAt: snapshot.closingCapturedAt || null,
    },
    closingStatus: [snapshot.closingHome, snapshot.closingDraw, snapshot.closingAway].filter(Boolean).length === 3 ? "available" : "missing",
    reason: validCount === 3 ? null : "Niet alle 1X2 oddsvelden waren beschikbaar.",
  };
}

export async function fetchOddsAtPrediction(match, options = {}) {
  if (String(process.env.ODDS_FETCH_ENABLED || "true").toLowerCase() === "false") {
    return {
      status: "disabled_for_refresh_mode",
      oddsAtPrediction: null,
      provider: process.env.ODDS_PROVIDER_NAME || "custom-odds-provider",
      reason: "Odds ophalen is uitgeschakeld voor deze refreshmodus.",
    };
  }
  const template = getOddsApiUrlTemplate();
  const apiKey = getOddsApiKey(template);
  const provider = getOddsProviderName(template);
  const providerConfigs = getOddsProviderConfigs();
  if (!providerConfigs.length && !apiKey && !template) {
    return {
      status: "not_configured",
      oddsAtPrediction: null,
      provider,
      reason: "Geen ODDS_API_URL_TEMPLATE of ODDS_API_KEY geconfigureerd.",
    };
  }
  if (!providerConfigs.length && !template) {
    return {
      status: "provider_template_missing",
      oddsAtPrediction: null,
      provider,
      reason: "API-key staat klaar, maar er is geen odds-endpoint geconfigureerd.",
    };
  }
  if (!providerConfigs.length && !apiKey && /\{apiKey\}/i.test(template)) {
    return {
      status: "not_configured",
      oddsAtPrediction: null,
      provider,
      reason: "De geconfigureerde odds-endpoint mist zijn eigen ODDS_API_KEY; API-Football-keys worden niet naar andere providers gestuurd.",
    };
  }
  if (!providerConfigs.length && !apiKey && /the-odds-api\.com/i.test(template)) {
    return {
      status: "not_configured",
      oddsAtPrediction: null,
      provider,
      reason: "The Odds API endpoint is actief, maar ODDS_API_KEY/THE_ODDS_API_KEY ontbreekt.",
    };
  }

  const generatedAt = options.generatedAt || new Date().toISOString();
  try {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      return {
        status: "fetch_unavailable",
        oddsAtPrediction: null,
        provider,
        reason: "fetch is niet beschikbaar in deze runtime.",
      };
    }
    const attempts = [];
    let lastResult = null;
    const configs = providerConfigs.length ? providerConfigs : [{ template, apiKey, provider, suffix: "" }];
    for (const config of configs) {
      const configTemplate = config.template;
      const configApiKey = config.apiKey;
      const configProvider = config.provider || provider;
      if (!configApiKey && /\{apiKey\}/i.test(configTemplate)) {
        attempts.push({ provider: configProvider, sport: "provider", status: "not_configured" });
        lastResult = {
          status: "not_configured",
          oddsAtPrediction: null,
          provider: configProvider,
          reason: `Provider ${configProvider} mist een API-key.`,
        };
        continue;
      }
      const sports = /the-odds-api\.com/i.test(configTemplate) && /\{sport\}/i.test(configTemplate)
        ? inferOddsApiSportKeys(match)
        : [inferOddsApiSportKey(match)];
      for (const sport of sports) {
        const url = replaceTemplate(configTemplate, {
          apiKey: configApiKey,
          sport,
          homeTeam: match?.homeTeam || "",
          awayTeam: match?.awayTeam || "",
          league: match?.league || "",
          kickoff: match?.kickoff || "",
          matchId: match?.matchId || "",
          sportmonksFixtureId: match?.sportmonksFixtureId || match?.matchId || "",
        });
      const cached = responseCache.get(url);
      const cacheFresh = cached && Date.now() - cached.cachedAt <= RESPONSE_CACHE_TTL_MS;
      let response = null;
      let payload = cacheFresh ? cached.payload : null;
      let quota = cacheFresh ? cached.quota : null;
      if (!cacheFresh) {
        const isApiSports = /football\.api-sports\.io|api-sports\.io/i.test(url);
        const isRapidApi = /rapidapi/i.test(new URL(url).hostname);
        const headers = {
          Accept: "application/json",
          ...(configApiKey && !url.includes(configApiKey)
            ? isRapidApi
              ? { "x-rapidapi-key": configApiKey, "x-rapidapi-host": new URL(url).hostname }
              : isApiSports
                ? { "x-apisports-key": configApiKey }
                : { "x-api-key": configApiKey }
            : {}),
        };
        response = await fetchImpl(url, {
          headers,
        });
        quota = {
          remaining: response.headers.get("x-requests-remaining") || response.headers.get("x-ratelimit-requests-remaining"),
          used: response.headers.get("x-requests-used"),
          lastCost: response.headers.get("x-requests-last"),
          limit: response.headers.get("x-ratelimit-limit") || response.headers.get("x-ratelimit-requests-limit"),
          reset: response.headers.get("x-ratelimit-reset") || response.headers.get("x-requestcounter-reset"),
          retryAfter: response.headers.get("retry-after"),
        };
      }
      if (response && !response.ok) {
        attempts.push({ provider: configProvider, sport, status: "provider_error", statusCode: response.status });
        if (![400, 404, 422].includes(Number(response.status))) {
          lastResult = {
            status: "provider_error",
            oddsAtPrediction: null,
            provider: configProvider,
            statusCode: response.status,
            reason: `Oddsprovider antwoordde met HTTP ${response.status}.`,
            requestMeta: { attempts, attemptedSports: sports, attemptedProviders: configs.map((item) => item.provider) },
          };
          continue;
        }
        continue;
      }
      if (!cacheFresh) {
        payload = await response.json();
        quota = {
          ...(quota || {}),
          sportmonksRateLimit: payload?.rate_limit || payload?.meta?.rate_limit || null,
        };
        responseCache.set(url, { payload, quota, cachedAt: Date.now() });
      }
      const receivedAt = new Date().toISOString();
      const requestedCutoffMs = Date.parse(options.cutoffAt || "");
      const receivedAtMs = Date.parse(receivedAt);
      const effectiveCutoffAt = Number.isFinite(requestedCutoffMs) && requestedCutoffMs > receivedAtMs
        ? options.cutoffAt
        : receivedAt;
      const result = {
        ...normalizeOddsSnapshot(payload, match, {
          provider: configProvider,
          generatedAt: receivedAt,
          cutoffAt: effectiveCutoffAt,
          kickoff: match?.kickoff,
        }),
        provider: configProvider,
        requestMeta: {
          cached: Boolean(cacheFresh),
          quota,
          sport,
          attemptedSports: sports,
          attemptedProviders: configs.map((item) => item.provider),
          attempts,
          templateDefaulted: !String(process.env.ODDS_API_URL_TEMPLATE || "").trim(),
        },
      };
      attempts.push({ provider: configProvider, sport, status: result.status, cached: Boolean(cacheFresh), remaining: quota?.remaining || null });
      lastResult = result;
      if (["available", "partial"].includes(result.status)) return result;
      }
    }
    return {
      ...(lastResult || { status: "not_found", oddsAtPrediction: null, reason: "Geen sport fallback gaf herkenbare 1X2 odds terug." }),
      provider: lastResult?.provider || provider,
      requestMeta: {
        ...(lastResult?.requestMeta || {}),
        attemptedProviders: configs.map((item) => item.provider),
        attempts,
      },
    };
  } catch (error) {
    return {
      status: "provider_exception",
      oddsAtPrediction: null,
      provider,
      reason: error?.message || String(error),
    };
  }
}
