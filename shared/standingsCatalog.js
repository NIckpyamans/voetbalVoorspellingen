function normalizedTeamName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(fc|afc|sc|cf|ac|sv|fk|kv|kvc|kaa|rc|rkc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameTeam(left, right) {
  const a = normalizedTeamName(left);
  const b = normalizedTeamName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  return shorter.length >= 3 && (` ${longer} `).includes(` ${shorter} `);
}

function numericRow(row, fallback = {}) {
  return {
    ...fallback,
    ...row,
    p: Number(row?.p || 0),
    w: Number(row?.w || 0),
    d: Number(row?.d || 0),
    l: Number(row?.l || 0),
    gf: Number(row?.gf || 0),
    ga: Number(row?.ga || 0),
    pts: Number(row?.pts || 0),
  };
}

function standingStrength(standing) {
  return (standing?.rows || []).reduce((sum, row) => sum + Number(row?.p || 0), 0) * 100 + (standing?.rows || []).length;
}

function sortRows(rows) {
  return rows.sort((left, right) =>
    Number(right.pts || 0) - Number(left.pts || 0) ||
    (Number(right.gf || 0) - Number(right.ga || 0)) - (Number(left.gf || 0) - Number(left.ga || 0)) ||
    Number(right.gf || 0) - Number(left.gf || 0) ||
    String(left.team || "").localeCompare(String(right.team || ""))
  ).map((row, index) => ({ ...row, pos: index + 1 }));
}

function completedScore(match) {
  if (String(match?.status || "").toUpperCase() !== "FT") return null;
  const explicitHome = Number(match?.homeScore);
  const explicitAway = Number(match?.awayScore);
  if (Number.isFinite(explicitHome) && Number.isFinite(explicitAway)) {
    return { homeGoals: explicitHome, awayGoals: explicitAway };
  }
  const parsed = String(match?.score || "").match(/^(\d+)\s*-\s*(\d+)$/);
  if (!parsed) return null;
  return { homeGoals: Number(parsed[1]), awayGoals: Number(parsed[2]) };
}

function resultWasApplied(resultKeys, date, home, away) {
  return [...resultKeys].some((key) => {
    const [keyDate, keyHome, keyAway] = String(key || "").split("|");
    return keyDate === date && sameTeam(keyHome, home) && sameTeam(keyAway, away);
  });
}

function resultKeyBelongsToRows(key, rows) {
  const [, home, away] = String(key || "").split("|");
  return Boolean(home && away && rows.some((row) => sameTeam(row.team, home)) && rows.some((row) => sameTeam(row.team, away)));
}

function composeSource(baseSource, hasBaseResults, appliedResults) {
  const parts = hasBaseResults
    ? String(baseSource || "").split("+").map((part) => part.trim()).filter(Boolean)
    : [];
  const withoutCatalog = parts.filter((part) => part !== "competition-catalog" && part !== "competition-catalog-zero");
  return [...new Set([
    ...(withoutCatalog.length ? withoutCatalog : ["competition-catalog-zero"]),
    "competition-catalog",
    appliedResults > 0 ? "split-day-results" : null,
  ].filter(Boolean))].join(" + ");
}

function applyCompletedResults(rows, resultKeys, matches, label) {
  let applied = 0;
  let lastResultDate = null;
  for (const match of matches || []) {
    if (String(match?.league || "") !== label) continue;
    const score = completedScore(match);
    if (!score) continue;
    const homeIndex = rows.findIndex((row) => sameTeam(row.team, match?.homeTeamName));
    const awayIndex = rows.findIndex((row) => sameTeam(row.team, match?.awayTeamName));
    if (homeIndex < 0 || awayIndex < 0 || homeIndex === awayIndex) continue;
    const date = String(match?.date || match?.kickoff || "").slice(0, 10);
    if (!date || resultWasApplied(resultKeys, date, match.homeTeamName, match.awayTeamName)) continue;

    const home = rows[homeIndex];
    const away = rows[awayIndex];
    home.p += 1;
    away.p += 1;
    home.gf += score.homeGoals;
    home.ga += score.awayGoals;
    away.gf += score.awayGoals;
    away.ga += score.homeGoals;
    if (score.homeGoals > score.awayGoals) {
      home.w += 1;
      away.l += 1;
      home.pts += 3;
    } else if (score.homeGoals < score.awayGoals) {
      away.w += 1;
      home.l += 1;
      away.pts += 3;
    } else {
      home.d += 1;
      away.d += 1;
      home.pts += 1;
      away.pts += 1;
    }
    resultKeys.add(`${date}|${normalizedTeamName(match.homeTeamName)}|${normalizedTeamName(match.awayTeamName)}`);
    applied += 1;
    if (!lastResultDate || date > lastResultDate) lastResultDate = date;
  }
  return { applied, lastResultDate };
}

export function mergeCatalogStandings(existingStandings = {}, catalog = {}, completedMatches = []) {
  const existingEntries = Object.entries(existingStandings || {});
  const usedLabels = new Set();
  const merged = {};
  const updated = Date.parse(String(catalog?.generatedAt || "")) || Date.now();

  for (const competition of catalog?.competitions || []) {
    if (!Array.isArray(competition?.teams) || competition.teams.length === 0) continue;
    const label = String(competition.league || "").trim();
    if (!label) continue;
    const candidates = existingEntries
      .filter(([, standing]) => String(standing?.label || "").trim() === label)
      .map(([, standing]) => standing)
      .sort((left, right) => standingStrength(right) - standingStrength(left));
    const base = candidates[0] || null;
    const baseRows = Array.isArray(base?.rows) ? base.rows : [];
    const consumed = new Set();
    const rows = competition.teams.map((team, index) => {
      const matchedIndex = baseRows.findIndex((row, rowIndex) => !consumed.has(rowIndex) && sameTeam(row?.team, team));
      if (matchedIndex >= 0) consumed.add(matchedIndex);
      const existing = matchedIndex >= 0 ? baseRows[matchedIndex] : null;
      return numericRow(existing, {
        pos: index + 1,
        team,
        teamId: `catalog:${competition.slug}:${normalizedTeamName(team).replace(/\s+/g, "-")}`,
      });
    });
    if (competition.membershipStatus !== "provider_confirmed") {
      for (let index = 0; index < baseRows.length; index += 1) {
        if (consumed.has(index)) continue;
        const row = numericRow(baseRows[index]);
        if (row.p > 0 && !rows.some((item) => sameTeam(item.team, row.team))) rows.push(row);
      }
    }
    const hasBaseResults = rows.some((row) => Number(row.p || 0) > 0);
    const resultKeys = new Set(
      (Array.isArray(base?.resultKeys) ? base.resultKeys : []).filter((key) => resultKeyBelongsToRows(key, rows))
    );
    const appliedResults = applyCompletedResults(rows, resultKeys, completedMatches, label);
    const catalogSource = { source: "competition-catalog", rows: competition.teams.length };
    const resultSource = appliedResults.applied > 0
      ? [{ source: "split-day-results", rows: rows.length, results: appliedResults.applied }]
      : [];
    merged[`label:${label}`] = {
      ...(base || {}),
      label,
      rows: sortRows(rows),
      updated: Math.max(Number(base?.updated || 0), updated),
      source: composeSource(base?.source, hasBaseResults, appliedResults.applied),
      sources: [...(Array.isArray(base?.sources) ? base.sources : []), catalogSource, ...resultSource],
      resultKeys: [...resultKeys],
      lastResultDate: appliedResults.lastResultDate || base?.lastResultDate || null,
      meta: {
        ...(base?.meta || {}),
        format: competition.format,
        notes: [
          ...(Array.isArray(base?.meta?.notes) ? base.meta.notes : []),
          `${rows.length}/${competition.expectedTeams || rows.length} teams uit de competitiecatalogus; uitslagen worden erbovenop verwerkt.`,
          competition.membershipStatus === "provider_confirmed"
            ? "Niet-herkende clubs worden geweigerd om vervuiling tussen competities te voorkomen."
            : "Voorlopige deelnemers kunnen worden aangevuld vanuit betrouwbare uitslagen.",
        ],
      },
    };
    usedLabels.add(label);
  }

  for (const [key, standing] of existingEntries) {
    const label = String(standing?.label || "").trim();
    if (!label || usedLabels.has(label)) continue;
    merged[key] = standing;
  }
  return merged;
}

export { normalizedTeamName, sameTeam };
