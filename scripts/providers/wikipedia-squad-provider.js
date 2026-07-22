function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(f\.?c\.?|cf|afc|sc|fk|club|football club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function cleanPlayerName(value) {
  return String(value || "")
    .replace(/\{\{sortname\|([^|{}]+)\|([^|{}]+)[^{}]*\}\}/gi, "$1 $2")
    .replace(/\{\{[^{}|]+\|([^{}|]+)\}\}/g, "$1")
    .replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function wikipediaTitleMatchesTeam(title, teamName) {
  const titleName = normalize(title);
  const wanted = normalize(teamName);
  if (!titleName || !wanted) return false;
  if (titleName === wanted) return true;
  const tokens = wanted.split(" ").filter((token) => token.length >= 4);
  return tokens.length > 0 && tokens.every((token) => titleName.includes(token));
}

function templateValue(template, keys) {
  for (const key of keys) {
    const match = new RegExp(`(?:^|\\|)\\s*${key}\\s*=\\s*(\\[\\[[^\\]]+\\]\\]|[^|}]+)`, "i").exec(template);
    if (match?.[1]) return cleanPlayerName(match[1]);
  }
  return "";
}

export function parseWikipediaSquad(wikitext) {
  const players = [];
  let loanSection = false;
  for (const line of String(wikitext || "").split(/\r?\n/)) {
    if (/^=+.*(out on loan|on loan|verhuurd|uitgeleend).*=+/i.test(line)) loanSection = true;
    else if (/^=+/.test(line)) loanSection = false;
    if (!/\{\{\s*(fs player|football squad player)/i.test(line)) continue;
    const name = templateValue(line, ["name", "player", "p"]);
    if (!name) continue;
    players.push({
      id: "",
      name,
      position: templateValue(line, ["pos", "position"]),
      nationality: templateValue(line, ["nat", "nationality"]),
      status: loanSection ? "verhuurd" : "roster-listed",
      availability: loanSection ? "verhuurd" : "onbekend",
      loan: loanSection,
      source: "Wikipedia",
      sources: ["Wikipedia"],
    });
  }
  return players.slice(0, 45);
}

export async function fetchWikipediaSquad({ teamName, fetchJson }) {
  if (!teamName || typeof fetchJson !== "function") return null;
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=6&search=${encodeURIComponent(teamName)}`;
  const search = await fetchJson(searchUrl);
  const titles = Array.isArray(search?.[1]) ? search[1] : [];
  const title = titles.find((item) => !/women|under-|u-?21|academy|reserve|youth/i.test(item) && wikipediaTitleMatchesTeam(item, teamName));
  if (!title) return null;
  const parsed = await fetchJson(`https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&page=${encodeURIComponent(title)}`);
  const players = parseWikipediaSquad(parsed?.parse?.wikitext?.["*"]);
  if (players.length < 11 || players.length > 45) return null;
  return {
    providerTeamId: "",
    providerTeamName: teamName,
    pageTitle: title,
    players,
  };
}
