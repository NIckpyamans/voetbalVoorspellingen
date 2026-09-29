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
