// OddsPapi dekt de Nederlandse Eerste Divisie met honderden bookmakers, terwijl
// The Odds API die competitie niet in de catalogus heeft. Deze module blijft
// bewust los van de capture-pipeline: hij levert alleen de 1X2-aggregatie en telt
// de requests, zodat een droogrun de kosten zichtbaar maakt voordat er iets wordt
// vastgelegd.

export const ODDSPAPI_BASE_URL = "https://api.oddspapi.io/v4";
export const ODDSPAPI_SOCCER_SPORT_ID = 10;
export const ODDSPAPI_THREE_WAY_MARKET_ID = "101";
export const ODDSPAPI_THREE_WAY_OUTCOME_IDS = ["101", "102", "103"];
export const ODDSPAPI_DEFAULT_BOOKMAKERS = ["pinnacle", "bwin", "bet365"];
// De gratis tier wil minimaal een seconde tussen requests; sequentiële calls met
// deze interval halen dat zonder 429-retries.
export const ODDSPAPI_MIN_INTERVAL_MS = 1100;

export function oddspapiApiKey(env = process.env) {
  return String(env.ODDSPAPI_API_KEY || env.ODDSPAPI_KEY || "").trim();
}

function outcomePrice(bookmaker, outcomeId) {
  const player = bookmaker?.markets?.[ODDSPAPI_THREE_WAY_MARKET_ID]?.outcomes?.[outcomeId]?.players?.["0"];
  if (!player || player.active === false) return null;
  const price = Number(player.price);
  return Number.isFinite(price) && price > 1 ? price : null;
}

// Twee vlaggen doen het werk: bookmakerIsActive op bookmaker-niveau en active op
// prijsniveau. Ze zijn het vaak oneens, dus beide moeten mee.
export function oddspapiThreeWay(bookmaker) {
  if (!bookmaker || bookmaker.suspended || bookmaker.bookmakerIsActive === false) return null;
  const prices = ODDSPAPI_THREE_WAY_OUTCOME_IDS.map((outcomeId) => outcomePrice(bookmaker, outcomeId));
  if (prices.some((price) => price == null)) return null;
  return { home: prices[0], draw: prices[1], away: prices[2] };
}

// De endpoints verschillen in verpakking: soms een kale array, soms een object
// met data/fixtures/results. Eén helper voorkomt dat een vormwijziging stilletjes
// nul fixtures oplevert.
export function oddspapiList(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "fixtures", "results", "items", "odds"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return null;
}

// Het board komt per endpoint als map (bookmakernaam -> odds) of als array met
// bookmaker-objecten. Beide worden hier één map, zodat de rest één vorm kent.
export function oddspapiBookmakerOdds(fixture) {
  const raw = fixture?.bookmakerOdds ?? fixture?.odds?.bookmakerOdds ?? fixture?.bookmakers ?? fixture?.odds?.bookmakers ?? null;
  if (!raw) return {};
  if (!Array.isArray(raw)) return raw;
  const map = {};
  for (const item of raw) {
    const name = item?.bookmaker || item?.bookmakerName || item?.name;
    if (name) map[name] = item;
  }
  return map;
}

export function oddspapiQuotes(bookmakerOdds = {}) {
  const map = Array.isArray(bookmakerOdds) ? oddspapiBookmakerOdds({ bookmakers: bookmakerOdds }) : bookmakerOdds || {};
  const quotes = [];
  for (const [bookmaker, book] of Object.entries(map)) {
    const threeWay = oddspapiThreeWay(book);
    if (threeWay) quotes.push({ bookmaker, ...threeWay });
  }
  return quotes;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(4));
}

// Bookmakers zijn geen onafhankelijke meningen: in de OddsPapi-meting vielen 231
// complete 1X2-quotes uiteen in 67 unieke prijstuples. Dedupliceren voorkomt dat
// één boek dat dezelfde prijs onder tien labels herhaalt de mediaan bepaalt.
export function aggregateOddspapiThreeWay(quotes = []) {
  const unique = new Map();
  for (const quote of quotes) unique.set(`${quote.home}|${quote.draw}|${quote.away}`, quote);
  const independent = [...unique.values()];
  if (!independent.length) return null;
  return {
    home: median(independent.map((quote) => quote.home)),
    draw: median(independent.map((quote) => quote.draw)),
    away: median(independent.map((quote) => quote.away)),
    bookmakers: quotes.length,
    independentPrices: independent.length,
  };
}

export function estimateOddspapiRequests({ tournamentLookups = 0, bookmakers = 1, tournaments = 1, fixtureRequests = 0 } = {}) {
  const oddsByTournament = Math.max(0, Number(bookmakers) || 0) * Math.max(0, Number(tournaments) || 0);
  return {
    tournamentLookups: Math.max(0, Number(tournamentLookups) || 0),
    oddsByTournament,
    fixtureRequests: Math.max(0, Number(fixtureRequests) || 0),
    total: Math.max(0, Number(tournamentLookups) || 0) + oddsByTournament + Math.max(0, Number(fixtureRequests) || 0),
  };
}

export function oddspapiTournamentId(tournaments = [], name = "Eerste Divisie") {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return null;
  const list = (Array.isArray(tournaments) ? tournaments : [])
    .map((tournament) => ({
      id: Number(tournament?.tournamentId),
      name: String(tournament?.tournamentName || tournament?.name || "").trim().toLowerCase(),
    }))
    .filter((tournament) => Number.isFinite(tournament.id) && tournament.name);
  const exact = list.find((tournament) => tournament.name === wanted);
  if (exact) return exact.id;
  // Sommige catalogi noemen de competitie "Netherlands - Eerste Divisie".
  const partial = list.find((tournament) => tournament.name.includes(wanted) || wanted.includes(tournament.name));
  return partial ? partial.id : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchOddspapi({ path, params = {}, apiKey, fetchImpl = fetch, timeoutMs = 15000 }) {
  const url = new URL(`${ODDSPAPI_BASE_URL}/${String(path).replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  url.searchParams.set("apiKey", apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, payload, requests: 1 };
  } catch (error) {
    return { ok: false, status: "request_failed", payload: null, error: error?.name || String(error), requests: 1 };
  } finally {
    clearTimeout(timeout);
  }
}

// odds-by-tournaments levert fixtures én odds in één call per bookmaker, wat per
// fixture een losse /odds-call voorkomt.
export async function fetchOddspapiTournamentOdds({
  apiKey,
  tournamentIds = [],
  bookmakers = [],
  oddsFormat = "decimal",
  fetchImpl = fetch,
  minIntervalMs = 0,
}) {
  const fixtures = new Map();
  const failures = [];
  let requests = 0;
  for (const bookmaker of bookmakers) {
    if (requests > 0 && minIntervalMs > 0) await sleep(minIntervalMs);
    const result = await fetchOddspapi({
      path: "odds-by-tournaments",
      params: { bookmaker, tournamentIds: tournamentIds.join(","), oddsFormat },
      apiKey,
      fetchImpl,
    });
    requests += result.requests;
    const list = oddspapiList(result.payload);
    if (!result.ok || !list) {
      failures.push({ bookmaker, status: result.status, error: result.error || null });
      continue;
    }
    for (const fixture of list) {
      const fixtureId = String(fixture?.fixtureId || "");
      if (!fixtureId) continue;
      const entry = fixtures.get(fixtureId) || {
        fixtureId,
        tournamentId: fixture?.tournamentId ?? null,
        startTime: fixture?.startTime || null,
        home: fixture?.participant1Name || fixture?.participant1?.name || fixture?.homeTeam || null,
        away: fixture?.participant2Name || fixture?.participant2?.name || fixture?.awayTeam || null,
        participant1Id: fixture?.participant1Id ?? null,
        participant2Id: fixture?.participant2Id ?? null,
        quotes: [],
      };
      entry.quotes.push(...oddspapiQuotes(oddspapiBookmakerOdds(fixture)));
      fixtures.set(fixtureId, entry);
    }
  }
  return { fixtures: [...fixtures.values()], failures, requests };
}
