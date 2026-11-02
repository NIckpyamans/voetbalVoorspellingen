import { aggregateOddspapiThreeWay } from "../providers/oddspapi-provider.js";

// Clubnamen verschillen per bron: "VVV-Venlo" tegenover "VVV Venlo", "Jong PSV"
// tegenover "PSV II", "TOP Oss" tegenover "Top Oss". Normaliseren tot losse
// woorden zonder leestekens maakt die varianten gelijk zonder een handmatige
// aliaslijst per club bij te houden.
const CLUB_NOISE = /\b(fc|sc|sv|vv|cf|afc|kfc|nv|bv|ac|as|us|ssc|calcio)\b/g;

export function normalizeOddspapiTeam(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bjong\b/g, "ii")
    .replace(CLUB_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Woordorde verschilt per bron ("Jong Ajax" tegenover "Ajax II", "VVV-Venlo"
// tegenover "Venlo VVV"). Sorteren maakt de sleutel orderonafhankelijk.
function sortedTokens(value) {
  return normalizeOddspapiTeam(value).split(" ").filter(Boolean).sort();
}

export function oddspapiTeamKey(value) {
  return sortedTokens(value).join(" ");
}

// "Roda JC Kerkrade" hoort bij "Roda JC", maar "Jong Ajax" hoort niet bij
// "Ajax". Daarom mogen alleen woorden ontbreken (maximaal één) en moeten beide
// namen hetzelfde beloftenelftal-signaal hebben.
function tokensCompatible(left, right) {
  const a = sortedTokens(left);
  const b = sortedTokens(right);
  if (!a.length || !b.length) return false;
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  if (!small.every((token) => large.includes(token))) return false;
  if (a.includes("ii") !== b.includes("ii")) return false;
  return large.length - small.length <= 1;
}

function fixtureHome(fixture) {
  return fixture?.home ?? fixture?.participant1Name ?? fixture?.participant1?.name ?? null;
}

function fixtureAway(fixture) {
  return fixture?.away ?? fixture?.participant2Name ?? fixture?.participant2?.name ?? null;
}

export function matchOddspapiFixture(fixtures = [], match = {}) {
  const home = oddspapiTeamKey(match?.homeTeam ?? match?.home);
  const away = oddspapiTeamKey(match?.awayTeam ?? match?.away);
  if (!home || !away) return null;
  const list = Array.isArray(fixtures) ? fixtures : [];
  const exact = list.find(
    (fixture) => oddspapiTeamKey(fixtureHome(fixture)) === home && oddspapiTeamKey(fixtureAway(fixture)) === away
  );
  if (exact) return exact;
  return (
    list.find((fixture) => {
      const fixtureHomeName = fixtureHome(fixture);
      const fixtureAwayName = fixtureAway(fixture);
      if (!fixtureHomeName || !fixtureAwayName) return false;
      return tokensCompatible(fixtureHomeName, home) && tokensCompatible(fixtureAwayName, away);
    }) || null
  );
}

function mostCommonBookmaker(quotes = []) {
  const counts = new Map();
  for (const quote of quotes) {
    const name = String(quote?.bookmaker || "").trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

// Koppelt OddsPapi-fixtures aan onze eigen matches en aggregeert de 1X2-quotes
// per fixture tot één mediaanprijs.
export function oddspapiOddsByMatch(fixtures = [], matches = []) {
  const byMatch = new Map();
  const list = Array.isArray(fixtures) ? fixtures : [];
  for (const match of Array.isArray(matches) ? matches : []) {
    const matchId = String(match?.matchId || match?.id || "");
    if (!matchId) continue;
    const fixture = matchOddspapiFixture(list, match);
    const quotes = Array.isArray(fixture?.quotes) ? fixture.quotes : [];
    if (!quotes.length) continue;
    const aggregate = aggregateOddspapiThreeWay(quotes);
    if (!aggregate) continue;
    byMatch.set(matchId, {
      fixtureId: String(fixture.fixtureId || ""),
      bookmaker: mostCommonBookmaker(quotes),
      home: aggregate.home,
      draw: aggregate.draw,
      away: aggregate.away,
      bookmakers: aggregate.bookmakers,
      independentPrices: aggregate.independentPrices,
    });
  }
  return byMatch;
}