import { calculateClubRating, competitionStrength } from "./club-rating.js";
function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function splitCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < String(line || "").length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

export function parseClubEloSnapshot(csv, { asOf = null, buildPossibleNames = null } = {}) {
  const lines = String(csv || "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const headers = splitCsvLine(lines[0]);
  const indexOf = (pattern) => headers.findIndex((header) => pattern.test(String(header || "")));
  const clubIndex = indexOf(/^club$/i);
  const eloIndex = indexOf(/^elo$/i);
  const rankIndex = indexOf(/^rank$/i);
  const countryIndex = indexOf(/^country$/i);
  const levelIndex = indexOf(/^level$/i);
  if (clubIndex < 0 || eloIndex < 0) return null;

  const ratings = {};
  const profiles = {};
  for (const line of lines.slice(1)) {
    const parts = splitCsvLine(line);
    const club = parts[clubIndex];
    const elo = Number(parts[eloIndex]);
    if (!club || !Number.isFinite(elo)) continue;
    const profile = {
      club,
      elo: Math.round(elo),
      rank: rankIndex >= 0 && Number.isFinite(Number(parts[rankIndex])) ? Number(parts[rankIndex]) : null,
      country: countryIndex >= 0 ? parts[countryIndex] || null : null,
      level: levelIndex >= 0 && Number.isFinite(Number(parts[levelIndex])) ? Number(parts[levelIndex]) : null,
      source: "ClubElo",
      asOf,
    };
    const variants = typeof buildPossibleNames === "function"
      ? buildPossibleNames(club)
      : [club, normalizeName(club)];
    for (const variant of variants.filter(Boolean)) {
      ratings[variant] = profile.elo;
      profiles[variant] = profile;
    }
  }
  return { ratings, profiles, source: "ClubElo", asOf };
}

export function lookupClubEloProfile(snapshot, teamName, buildPossibleNames = null) {
  if (!snapshot) return null;
  const variants = typeof buildPossibleNames === "function"
    ? buildPossibleNames(teamName)
    : [teamName, normalizeName(teamName)];
  for (const variant of variants.filter(Boolean)) {
    if (snapshot.profiles?.[variant]) return snapshot.profiles[variant];
    if (snapshot.ratings?.[variant] != null) {
      return { elo: Number(snapshot.ratings[variant]), source: "ClubElo", asOf: snapshot.asOf || null };
    }
    if (snapshot[variant] != null) {
      return { elo: Number(snapshot[variant]), source: "ClubElo", asOf: null };
    }
  }
  return null;
}

export function buildClubStrengthProfile({ clubEloProfile, squadProfile, lineupSide, snapshot, asOf } = {}) {
  const profile = calculateClubRating({ clubEloProfile, squadProfile,
    leagueProfile: competitionStrength(snapshot, clubEloProfile), asOf });
  return { ...profile, clubElo: clubEloProfile?.elo ?? null,
    clubEloRank: clubEloProfile?.rank ?? null, country: clubEloProfile?.country ?? null,
    level: clubEloProfile?.level ?? null, squadRating: profile.valueEvidence.valueRating,
    squadPlayers: profile.valueEvidence.playerCount, rosterCoverage: profile.valueEvidence.coverage,
    lineupRating: null, lineupConfirmed: Boolean(lineupSide?.confirmed),
    uefaCoefficient: null, uefaCoefficientStatus: "niet gebruikt" };
}

// Read literal table data only; never execute scripts from a provider page.
export function parseClubEloWebsite(html, { buildPossibleNames = null } = {}) {
  const asOf = String(html).match(/<h1[^>]*>\s*<a href="\/(\d{4}-\d{2}-\d{2})\/(?:Ranking)?"/)?.[1];
  const start = String(html).indexOf("const eloData =");
  if (!asOf || start < 0) return null;
  // HTML entities can contain semicolons, so terminate at the array's closing bracket.
  const block = String(html).slice(start).split("]];")[0] + "]]";
  const ratings = {}, profiles = {};
  const decode = (v) => v.replace(/\\'/g, "'").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  for (const match of block.matchAll(/\['((?:\\.|[^'\\])*)',\s*'(\d+(?:\.\d+)?)'/g)) {
    const cell = decode(match[1]);
    const country = cell.match(/alt="([A-Z]{3})"/)?.[1];
    const rank = Number(cell.match(/<small>\s*(\d+)\s*<\/small>/)?.[1]);
    const club = cell.replace(/<small>[\s\S]*?<\/small>/g, "").replace(/<[^>]+>/g, "").trim();
    const elo = Number(match[2]);
    if (!club || !country || elo < 300 || elo > 3000) continue;
    const profile = { club, elo, rank: rank || null, country, level: null, source: "ClubElo", asOf };
    for (const key of (buildPossibleNames ? buildPossibleNames(club) : [club, normalizeName(club)])) {
      ratings[key] = elo; profiles[key] = profile;
    }
  }
  return Object.keys(profiles).length ? { ratings, profiles, source: "ClubElo", sourceUrl: "https://clubelo.com/Ranking", asOf } : null;
}
