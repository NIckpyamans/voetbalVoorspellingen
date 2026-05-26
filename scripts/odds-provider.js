function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 1 ? number : null;
}

function isBeforeOrAt(value, cutoff) {
  const valueMs = Date.parse(value || "");
  const cutoffMs = Date.parse(cutoff || "");
  if (!Number.isFinite(valueMs) || !Number.isFinite(cutoffMs)) return true;
  return valueMs <= cutoffMs;
}

function replaceTemplate(template, variables) {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const value = variables[key] ?? "";
    return encodeURIComponent(String(value));
  });
}

function pickFlatOdds(node) {
  if (!node || typeof node !== "object") return null;
  const odds = node.odds && typeof node.odds === "object" ? node.odds : node;
  const home = numberOrNull(odds.home ?? odds.homeOdds ?? odds.oddsHome ?? odds.choice1?.value);
  const draw = numberOrNull(odds.draw ?? odds.drawOdds ?? odds.oddsDraw ?? odds.choiceX?.value);
  const away = numberOrNull(odds.away ?? odds.awayOdds ?? odds.oddsAway ?? odds.choice2?.value);
  if (!home && !draw && !away) return null;
  return {
    home,
    draw,
    away,
    bookmaker: odds.bookmaker || odds.source || node.bookmaker || node.source || null,
    market: odds.market || node.market || "1X2",
    capturedAt: odds.capturedAt || odds.timestamp || node.capturedAt || node.timestamp || null,
  };
}

function extractTheOddsApiSnapshot(payload, match) {
  const events = Array.isArray(payload) ? payload : payload?.events || payload?.data || [];
  if (!Array.isArray(events)) return null;
  const homeName = normalizeName(match.homeTeam);
  const awayName = normalizeName(match.awayTeam);
  const event =
    events.find((item) => {
      const home = normalizeName(item?.home_team || item?.homeTeam || item?.home);
      const away = normalizeName(item?.away_team || item?.awayTeam || item?.away);
      return (!homeName || home === homeName) && (!awayName || away === awayName);
    }) || events[0];
  if (!event) return null;

  for (const bookmaker of event.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      const key = String(market.key || market.market || "").toLowerCase();
      if (key && !["h2h", "1x2", "match_winner"].includes(key)) continue;
      const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
      const home = outcomes.find((outcome) => normalizeName(outcome.name) === homeName);
      const away = outcomes.find((outcome) => normalizeName(outcome.name) === awayName);
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
  const snapshot = pickFlatOdds(raw) || extractTheOddsApiSnapshot(raw, match || {});
  if (!snapshot) {
    return {
      status: "not_found",
      oddsAtPrediction: null,
      reason: "Provider gaf geen herkenbare 1X2 odds terug.",
    };
  }

  const capturedAt = snapshot.capturedAt || generatedAt;
  if (!isBeforeOrAt(capturedAt, cutoffAt) || !isBeforeOrAt(capturedAt, kickoff)) {
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
    },
    reason: validCount === 3 ? null : "Niet alle 1X2 oddsvelden waren beschikbaar.",
  };
}

export async function fetchOddsAtPrediction(match, options = {}) {
  const apiKey = process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY || "";
  const template = process.env.ODDS_API_URL_TEMPLATE || "";
  const provider = process.env.ODDS_PROVIDER_NAME || (apiKey ? "the-odds-api" : "custom-odds-provider");
  if (!apiKey && !template) {
    return {
      status: "not_configured",
      oddsAtPrediction: null,
      provider,
      reason: "Geen ODDS_API_URL_TEMPLATE of ODDS_API_KEY geconfigureerd.",
    };
  }
  if (!template) {
    return {
      status: "provider_template_missing",
      oddsAtPrediction: null,
      provider,
      reason: "API-key staat klaar, maar ODDS_API_URL_TEMPLATE ontbreekt nog.",
    };
  }

  const generatedAt = options.generatedAt || new Date().toISOString();
  const url = replaceTemplate(template, {
    apiKey,
    homeTeam: match?.homeTeam || "",
    awayTeam: match?.awayTeam || "",
    league: match?.league || "",
    kickoff: match?.kickoff || "",
    matchId: match?.matchId || "",
  });

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
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        ...(apiKey && !url.includes(apiKey) ? { "x-api-key": apiKey } : {}),
      },
    });
    if (!response.ok) {
      return {
        status: "provider_error",
        oddsAtPrediction: null,
        provider,
        statusCode: response.status,
        reason: `Oddsprovider antwoordde met HTTP ${response.status}.`,
      };
    }
    const payload = await response.json();
    return {
      ...normalizeOddsSnapshot(payload, match, {
        provider,
        generatedAt,
        cutoffAt: options.cutoffAt || generatedAt,
        kickoff: match?.kickoff,
      }),
      provider,
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
