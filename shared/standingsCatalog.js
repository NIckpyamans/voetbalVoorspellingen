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

export function mergeCatalogStandings(existingStandings = {}, catalog = {}) {
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
    const catalogSource = { source: "competition-catalog", rows: competition.teams.length };
    merged[`label:${label}`] = {
      ...(base || {}),
      label,
      rows: sortRows(rows),
      updated: Math.max(Number(base?.updated || 0), updated),
      source: base?.source ? `${base.source} + competition-catalog` : "competition-catalog-zero",
      sources: [...(Array.isArray(base?.sources) ? base.sources : []), catalogSource],
      lastResultDate: base?.lastResultDate || null,
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
