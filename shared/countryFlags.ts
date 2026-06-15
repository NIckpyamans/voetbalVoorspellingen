const COUNTRY_CODES: Record<string, string> = {
  algeria: "dz",
  argentina: "ar",
  australia: "au",
  austria: "at",
  belgium: "be",
  "bosnia & herzegovina": "ba",
  "bosnia and herzegovina": "ba",
  brazil: "br",
  "cape verde": "cv",
  "cabo verde": "cv",
  canada: "ca",
  colombia: "co",
  "czech republic": "cz",
  czechia: "cz",
  "dr congo": "cd",
  "congo dr": "cd",
  croatia: "hr",
  curacao: "cw",
  curaçao: "cw",
  ecuador: "ec",
  egypt: "eg",
  england: "gb",
  france: "fr",
  germany: "de",
  ghana: "gh",
  haiti: "ht",
  iran: "ir",
  iraq: "iq",
  "ivory coast": "ci",
  "côte d'ivoire": "ci",
  japan: "jp",
  jordan: "jo",
  mexico: "mx",
  morocco: "ma",
  netherlands: "nl",
  "new zealand": "nz",
  norway: "no",
  panama: "pa",
  paraguay: "py",
  portugal: "pt",
  qatar: "qa",
  "republic of ireland": "ie",
  "rep of ireland": "ie",
  "saudi arabia": "sa",
  scotland: "gb",
  senegal: "sn",
  "south africa": "za",
  "south korea": "kr",
  "korea republic": "kr",
  spain: "es",
  sudan: "sd",
  sweden: "se",
  switzerland: "ch",
  tunisia: "tn",
  turkey: "tr",
  türkiye: "tr",
  usa: "us",
  "united states": "us",
  uruguay: "uy",
  uzbekistan: "uz",
};

function normalizedTeamName(name: string) {
  return String(name || "").trim().toLocaleLowerCase("en-US");
}

export function countryCodeForTeam(name: string, league?: string) {
  const code = COUNTRY_CODES[normalizedTeamName(name)];
  if (!code) return null;
  const competition = String(league || "").toLowerCase();
  const isInternational =
    competition.includes("world cup") ||
    competition.includes("international") ||
    competition.includes("qualification") ||
    competition.includes("nations league");
  return isInternational ? code : null;
}

export function countryFlagSources(name: string, league?: string) {
  const code = countryCodeForTeam(name, league);
  if (!code) return [];
  return [
    `https://flagcdn.com/${code}.svg`,
    `https://flagsapi.com/${code.toUpperCase()}/flat/64.png`,
  ];
}

export function countryFlagEmoji(name: string, league?: string) {
  const code = countryCodeForTeam(name, league);
  if (!code) return null;
  return String.fromCodePoint(...code.toUpperCase().split("").map((letter) => 127397 + letter.charCodeAt(0)));
}
