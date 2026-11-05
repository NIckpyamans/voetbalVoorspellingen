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
  // Griekse club: providers schrijven Olympiacos en Olympiakos door elkaar.
  olympiakos: ["Olympiacos", "Olympiacos Piraeus", "Olympiakos Piraeus"],
  olympiacos: ["Olympiakos", "Olympiakos Piraeus", "Olympiacos Piraeus"],
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

// Twee namen horen alleen bij dezelfde club als de tokens daarop wijzen.
// Alleen op een gedeeld provider-ID samenvoegen koppelde eerder willekeurige
// clubs aan elkaar (Porto/Vitória de Guimarães, Inter/Monza, Leeds/Bournemouth);
// de spelerslijst van de "primair" gekozen entry werd daarna bij alle leden van
// de groep gepubliceerd.
export function squadNamesCompatible(left, right) {
  const leftKey = normalizeSquadTeamKey(left);
  const rightKey = normalizeSquadTeamKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  const leftTokens = leftKey.split(" ").filter(Boolean);
  const rightTokens = rightKey.split(" ").filter(Boolean);
  const [smaller, larger] = leftTokens.length <= rightTokens.length
    ? [leftTokens, rightTokens]
    : [rightTokens, leftTokens];
  // "Drita" past bij "Drita Gjilan"; "Porto" niet bij "Vitória de Guimarães".
  return smaller.length < larger.length && smaller.every((token) => larger.includes(token));
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

// Provider-identiteiten van een cache-entry. Twee schrijfwijzen die naar
// hetzelfde FotMob-team verwijzen zijn dezelfde club, ook als de naam daar
// niet uit af te leiden is ("Jagiellonia" versus "Jagiellonia Bialystok").
function providerIdentityIds(entry) {
  const ids = [];
  for (const [provider, value] of Object.entries(entry?.sourceIds || {})) {
    const text = String(value ?? "").trim().toLowerCase();
    if (text) ids.push(`${String(provider).toLowerCase()}:${text}`);
  }
  for (const value of Array.isArray(entry?.providerTeamIds) ? entry.providerTeamIds : []) {
    const text = String(value || "").trim().toLowerCase();
    if (text) ids.push(text);
  }
  return [...new Set(ids)];
}

function preferredProviderId(entry) {
  const ids = providerIdentityIds(entry);
  return ids.find((id) => id.startsWith("fotmob:") || id.startsWith("fotmob-")) || ids[0] || null;
}

// Cache-canonicalisatie: dubbele teamnamen ("drita" en "drita gjilan") en
// dubbele provider-ID's (dezelfde club onder twee schrijfwijzen) worden één
// identiteit. Alle sleutels blijven werken en sourceIds worden samengevoegd,
// zodat er geen informatie verloren gaat; de spelerslijst komt van de meest
// actieve bron (zelfde beleid als enrichment).
export function canonicalizeSquadCache(cache = {}, options = {}) {
  const canonicalOf = options.canonicalOf || ((value) => String(value || ""));
  const items = Object.entries(cache).map(([key, entry]) => {
    const name = String(entry?.teamName || key.replace(/^name:/, ""));
    return {
      key,
      entry,
      canonical: String(canonicalOf(name) || name),
      providerIds: providerIdentityIds(entry),
    };
  });

  // Union-find: koppel entries op canonieke naam én op gedeelde provider-ID's.
  const parent = items.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== root) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const byCanonicalName = new Map();
  const byProviderId = new Map();
  items.forEach((item, index) => {
    if (item.canonical) {
      const nameKey = `name:${item.canonical}`;
      if (byCanonicalName.has(nameKey)) union(byCanonicalName.get(nameKey), index);
      else byCanonicalName.set(nameKey, index);
    }
    for (const id of item.providerIds) {
      const known = byProviderId.get(id);
      // Alleen samenvoegen wanneer de teamnaam dezelfde club ondersteunt.
      if (known === undefined) byProviderId.set(id, index);
      else if (squadNamesCompatible(items[known].canonical, item.canonical)) union(known, index);
    }
  });
  const groups = new Map();
  items.forEach((item, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(item);
  });

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
    const canonicalProviderId = preferredProviderId(primary.entry) || preferredProviderId({ sourceIds });
    for (const { key, entry } of members) {
      // Spelers alleen overnemen wanneer de clubnaam bij de primaire entry past.
      const compatibleWithPrimary = squadNamesCompatible(
        entry?.teamName || key.replace(/^name:/, ""),
        primary.entry?.teamName || primary.key.replace(/^name:/, ""),
      );
      cache[key] = {
        ...entry,
        ...(primaryPlayers && compatibleWithPrimary
          ? { players: primaryPlayers, playerCount: primaryPlayers.length, starPlayer: primary.entry?.starPlayer || primaryPlayers[0] || null }
          : {}),
        sourceIds,
        canonicalProviderId,
        canonicalTeamName: primary.entry?.teamName || entry?.teamName || null,
        canonicalKey: primary.key,
        duplicateKeys: members.map((item) => item.key),
      };
      if (key !== primary.key) mergedKeys += 1;
    }
  }
  return { cache, mergedGroups, mergedKeys };
}

// Opruimen: een selectie die onder meerdere, niet-verwante clubnamen staat is per
// definitie fout (één club, één selectie). Zulke entries verliezen hun spelers en
// worden als "unavailable" gemarkeerd, zodat de volgende enrichment-run ze met
// een expliciete teamcontrole opnieuw ophaalt.
export function purgeMismatchedSquadRosters(cache = {}) {
  const byRoster = new Map();
  for (const [key, entry] of Object.entries(cache)) {
    const players = Array.isArray(entry?.players) ? entry.players : [];
    if (players.length < 11) continue;
    const signature = players
      .map((player) => normalizeSquadTeamKey(player?.name || ""))
      .filter(Boolean)
      .sort()
      .join("|");
    if (!signature) continue;
    if (!byRoster.has(signature)) byRoster.set(signature, []);
    byRoster.get(signature).push({
      key,
      entry,
      teamName: String(entry?.teamName || key.replace(/^name:/, "")),
    });
  }
  const cleared = [];
  for (const members of byRoster.values()) {
    if (members.length < 2) continue;
    const distinctNames = members.filter((member, index) =>
      members.findIndex((other) => squadNamesCompatible(member.teamName, other.teamName)) === index
    );
    if (distinctNames.length < 2) continue;
    for (const member of members) {
      const providerTeamName = String(member.entry?.providerTeamName || "");
      if (providerTeamName && squadNamesCompatible(providerTeamName, member.teamName)) continue;
      cache[member.key] = {
        ...member.entry,
        players: [],
        playerCount: 0,
        starPlayer: null,
        unavailable: true,
        lastFailureReason: "roster_team_mismatch",
        rosterMismatchClearedAt: new Date().toISOString(),
      };
      cleared.push(member.teamName);
    }
  }
  return { cleared };
}
