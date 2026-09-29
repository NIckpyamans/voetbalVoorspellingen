// Provideraliassen en losse teamnaam-matching voor squad-enrichment. De
// losse vergelijking verwijdert clubvoorvoegsels (FC, FK, KF, ...) en
// diacritics zodat "Drita Gjilan", "FC Drita", "KF Drita" en "Drita" dezelfde
// providerzoeken activeren; expliciete aliassen overbruggen spellingvarianten
// (bijvoorbeeld Qarabağ / Karabakh).

export const SQUAD_TEAM_ALIASES = {
  "az": ["AZ Alkmaar"],
  "fc bayern munchen": ["Bayern München", "Bayern Munich"],
  "fc iberia 1999 tiflis": ["Iberia 1999", "FC Iberia 1999", "Saburtalo"],
  "fc nordsjaelland": ["FC Nordsjælland", "Nordsjælland"],
  "ks dynamo tirana": ["Dinamo City", "Dinamo Tirana"],
  "lillestrom": ["Lillestrøm", "Lillestrom SK"],
  "paok salonika": ["PAOK", "PAOK Thessaloniki"],
  "sv 07 elversberg": ["SV Elversberg", "Elversberg"],
  // Kosovo/Albanische clubnamen: providers wisselen tussen korte en formele
  // namen; elke schrijfwijze zoekt op alle varianten.
  "drita": ["Drita Gjilan", "FC Drita", "KF Drita"],
  "drita gjilan": ["Drita", "FC Drita", "KF Drita"],
  "fc drita": ["Drita", "Drita Gjilan", "KF Drita"],
  "kf drita": ["Drita", "Drita Gjilan", "FC Drita"],
  // Azerbeidzjaanse clubnamen: transliteratie en voorvoegsels wisselen sterk.
  "qarabag": ["FK Qarabag", "Qarabağ", "Qarabag FK", "Qarabag Agdam", "Karabakh Agdam"],
  "fk qarabag": ["Qarabag", "Qarabağ", "Qarabag FK", "Qarabag Agdam", "Karabakh Agdam"],
  "qarabag fk": ["Qarabag", "FK Qarabag", "Qarabağ", "Qarabag Agdam", "Karabakh Agdam"],
  "qarabag agdam": ["Qarabag", "FK Qarabag", "Qarabağ", "Karabakh Agdam"],
  "karabakh agdam": ["Qarabag", "FK Qarabag", "Qarabağ", "Qarabag Agdam"],
  "karabakh": ["Qarabag", "FK Qarabag", "Qarabağ", "Qarabag Agdam", "Karabakh Agdam"],
};

// Aliassen zijn gesleuteld op naam mét voorvoegsels ("fc drita"), zodat ook
// bestaande entries als "fc bayern munchen" bereikbaar blijven.
export function normalizeSquadAliasKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const CLUB_PREFIX_TOKENS = /^(?:fc|fk|kf|cf|afc|sc|cd|ac|as|rcd|sk|if|ik|bk|sv|vfb|vfl)$/;

export function normalizeSquadTeamKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token && !CLUB_PREFIX_TOKENS.test(token))
    .join(" ")
    .trim();
}

// Alle zoekopdrachten voor een teamnaam: de naam zelf plus bekende
// provideraliassen, gedupliceerd op exacte naam. Voorvoegselvarianten (FC
// Drita vs KF Drita) blijven bewust behouden: sommige providers vergelijken
// hun teamnamen nog strikt op schrijfwijze.
export function squadQueryVariants(name) {
  const variants = [String(name || "").trim(), ...(SQUAD_TEAM_ALIASES[normalizeSquadAliasKey(name)] || [])];
  const seen = new Set();
  return variants.filter((variant) => {
    const key = String(variant || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Losse provider-vergelijking: gelijke sleutel na verwijderen van
// clubvoorvoegsels en diacritics. Geen substring-matching, zodat "Tokyo" niet
// per ongeluk "Tokyo Verdy" raakt; spellingvarianten lopen via de aliassen.
export function providerTeamMatches(providerTeamName, queryName) {
  const left = normalizeSquadTeamKey(providerTeamName);
  const right = normalizeSquadTeamKey(queryName);
  return Boolean(left) && left === right;
}

// Preventie: stel uit provider-zoekresultaten automatisch kandidaat-aliassen
// voor voor teams die geen exacte match vonden, zodat alias-uitbreiding niet
// handmatig ontdekt hoeft te worden.
export function suggestAliasCandidates(candidateNames = [], teamName, options = {}) {
  const limit = Math.max(1, Number(options.limit || 3));
  const targetTokens = new Set(normalizeSquadTeamKey(teamName).split(" ").filter(Boolean));
  if (!targetTokens.size) return [];
  const suggestions = [];
  for (const name of candidateNames) {
    const key = normalizeSquadTeamKey(name);
    if (!key || key === normalizeSquadTeamKey(teamName)) continue;
    const tokens = new Set(key.split(" ").filter(Boolean));
    const overlap = [...targetTokens].filter((token) => tokens.has(token)).length;
    const score = overlap / Math.min(targetTokens.size, tokens.size);
    if (score > 0) suggestions.push({ name: String(name).trim(), score: Number(score.toFixed(2)) });
  }
  return suggestions
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, limit);
}

// Cache-canonicalisatie: dubbele teamnamen ("drita" en "drita gjilan") worden
// één identiteit via canonicalDedupeTeam. Alle sleutels blijven werken en
// sourceIds worden samengevoegd, zodat er geen informatie verloren gaat; de
// spelerslijst komt van de meest actieve bron (zelfde beleid als enrichment).
export function canonicalizeSquadCache(cache = {}, options = {}) {
  const canonicalOf = options.canonicalOf || ((value) => String(value || ""));
  const groups = new Map();
  for (const [key, entry] of Object.entries(cache)) {
    const name = String(entry?.teamName || key.replace(/^name:/, ""));
    const canonical = String(canonicalOf(name) || name);
    if (!groups.has(canonical)) groups.set(canonical, []);
    groups.get(canonical).push({ key, entry });
  }
  let mergedKeys = 0;
  let mergedGroups = 0;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    mergedGroups += 1;
    const freshness = (item) => Math.max(
      Number(item?.entry?.rosterSourceCheckedAt || 0),
      Date.parse(item?.entry?.fetchedAt || item?.entry?.checkedAt || "") || 0
    );
    const sorted = [...members].sort((left, right) =>
      freshness(right) - freshness(left) ||
      Number(right?.entry?.playerCount || right?.entry?.players?.length || 0) - Number(left?.entry?.playerCount || left?.entry?.players?.length || 0)
    );
    const primary = sorted[0];
    const primaryPlayers = Array.isArray(primary.entry?.players) && primary.entry.players.length ? primary.entry.players : null;
    const sourceIds = Object.assign({}, ...sorted.map((item) => item?.entry?.sourceIds || {}));
    for (const { key, entry } of members) {
      cache[key] = {
        ...entry,
        ...(primaryPlayers
          ? { players: primaryPlayers, playerCount: primaryPlayers.length, starPlayer: primary.entry?.starPlayer || primaryPlayers[0] || null }
          : {}),
        sourceIds,
        canonicalTeamName: primary.entry?.teamName || entry?.teamName || null,
        canonicalKey: primary.key,
        duplicateKeys: members.map((item) => item.key),
      };
      if (key !== primary.key) mergedKeys += 1;
    }
  }
  return { cache, mergedGroups, mergedKeys };
}
