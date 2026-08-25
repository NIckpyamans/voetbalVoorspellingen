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

export function buildClubStrengthProfile({ clubEloProfile, squadProfile, lineupSide } = {}) {
  const squadRating = Number(squadProfile?.rating || 0);
  const elo = Number(clubEloProfile?.elo || 0);
  const eloRating = elo > 0 ? Math.max(20, Math.min(96, ((elo - 1200) / 8))) : 0;
  const lineupRating = Number(lineupSide?.avgRating || 0) > 0
    ? Math.max(20, Math.min(96, ((Number(lineupSide.avgRating) - 5.5) / 2.5) * 100))
    : 0;
  const weights = [];
  if (squadRating > 0) weights.push([squadRating, 0.62]);
  if (eloRating > 0) weights.push([eloRating, 0.38]);
  if (lineupRating > 0) weights.push([lineupRating, lineupSide?.confirmed ? 0.22 : 0.08]);
  const totalWeight = weights.reduce((sum, [, weight]) => sum + weight, 0);
  const rating = totalWeight
    ? Number((weights.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight).toFixed(1))
    : null;
  const rosterCoverage = Number(squadProfile?.coverage || 0);
  const quality = lineupSide?.confirmed && rosterCoverage >= 0.75
    ? "hoog"
    : (rosterCoverage >= 0.5 || elo > 0)
      ? "middel"
      : "laag";

  return {
    rating,
    label: rating == null ? "onbekend" : rating >= 78 ? "zeer sterk" : rating >= 66 ? "sterk" : rating >= 52 ? "gemiddeld" : "kwetsbaar",
    quality,
    clubElo: elo || null,
    clubEloRank: clubEloProfile?.rank ?? null,
    country: clubEloProfile?.country || null,
    level: clubEloProfile?.level ?? null,
    squadRating: squadRating || null,
    squadPlayers: Number(squadProfile?.playerCount || squadProfile?.players?.length || 0),
    rosterCoverage: rosterCoverage || null,
    lineupRating: lineupRating || null,
    lineupConfirmed: Boolean(lineupSide?.confirmed),
    source: "eigen clubkracht op basis van ClubElo en actuele selectie",
    sourceAsOf: clubEloProfile?.asOf || null,
    uefaCoefficient: null,
    uefaCoefficientStatus: "niet automatisch overgenomen zonder gelicentieerde bron",
  };
}
