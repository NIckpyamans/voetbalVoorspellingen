function normalizePlayerName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function ratedSquadPlayers(squadProfile) {
  return (Array.isArray(squadProfile?.players) ? squadProfile.players : [])
    .map((player) => ({
      name: String(player?.name || "").trim(),
      rating: Number(player?.rating || 0),
      source: player?.ratingSource || player?.source || squadProfile?.source || null,
    }))
    .filter((player) => player.name && Number.isFinite(player.rating) && player.rating > 0)
    .sort((left, right) => right.rating - left.rating);
}

export function buildConfirmedLineupStarImpact(lineupSide, squadProfile) {
  const starters = Array.isArray(lineupSide?.players) ? lineupSide.players : [];
  const substitutes = Array.isArray(lineupSide?.substitutes) ? lineupSide.substitutes : [];
  if (!lineupSide?.confirmed || starters.length < 10) {
    return { usable: false, stars: [], missing: [], benched: [], penalty: 0 };
  }

  const rated = ratedSquadPlayers(squadProfile);
  if (rated.length < 3) return { usable: false, stars: [], missing: [], benched: [], penalty: 0 };

  const starterNames = new Set(starters.map((player) => normalizePlayerName(player?.name)).filter(Boolean));
  const benchNames = new Set(substitutes.map((player) => normalizePlayerName(player?.name)).filter(Boolean));
  const stars = rated.slice(0, Math.min(5, rated.length));
  const missing = stars.filter((player) => !starterNames.has(normalizePlayerName(player.name)) && !benchNames.has(normalizePlayerName(player.name)));
  const benched = stars.filter((player) => !starterNames.has(normalizePlayerName(player.name)) && benchNames.has(normalizePlayerName(player.name)));
  const topRating = Math.max(stars[0]?.rating || 0, 1);
  const missingPenalty = missing.reduce((sum, player) => sum + 0.012 + (player.rating / topRating) * 0.012, 0);
  const benchPenalty = benched.reduce((sum, player) => sum + 0.004 + (player.rating / topRating) * 0.004, 0);

  return {
    usable: true,
    stars,
    missing,
    benched,
    penalty: Number(Math.min(0.065, missingPenalty + benchPenalty).toFixed(3)),
  };
}

export function attachConfirmedLineupStarImpact(lineupSummary, homeSquadProfile, awaySquadProfile) {
  if (!lineupSummary?.confirmed) return lineupSummary;
  const home = buildConfirmedLineupStarImpact(lineupSummary.home, homeSquadProfile);
  const away = buildConfirmedLineupStarImpact(lineupSummary.away, awaySquadProfile);
  return {
    ...lineupSummary,
    starPlayerImpact: {
      home,
      away,
      differential: Number((away.penalty - home.penalty).toFixed(3)),
      summary: home.usable || away.usable
        ? `${home.missing.length} thuis- en ${away.missing.length} uitster(ren) ontbreken in de wedstrijdselectie`
        : "onvoldoende echte spelersratings voor sterspelerimpact",
    },
  };
}
