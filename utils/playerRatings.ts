export type PlayerRatingSource = "provider" | "marktwaarde-indicatie" | "teamprofiel-indicatie";

export interface RatedSquadPlayer {
  rating: number;
  ratingSource: PlayerRatingSource;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function derivePlayerRating(player: any, squadPlayers: any[], teamStrength?: number | null): RatedSquadPlayer {
  const providerRating = Number(player?.rating || player?.player?.rating || 0);
  if (providerRating >= 1 && providerRating <= 10) {
    return { rating: Number(providerRating.toFixed(1)), ratingSource: "provider" };
  }

  const marketValue = Number(player?.marketValueEur || player?.player?.marketValueEur || 0);
  const marketValues = (Array.isArray(squadPlayers) ? squadPlayers : [])
    .map((item) => Number(item?.marketValueEur || item?.player?.marketValueEur || 0))
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  if (marketValue > 0 && marketValues.length) {
    const lower = Math.log1p(marketValues[0]);
    const upper = Math.log1p(marketValues[marketValues.length - 1]);
    const percentile = upper > lower ? (Math.log1p(marketValue) - lower) / (upper - lower) : 0.5;
    return {
      rating: Number((5.8 + clamp(percentile, 0, 1) * 2.2).toFixed(1)),
      ratingSource: "marktwaarde-indicatie",
    };
  }

  const strength = clamp(Number(teamStrength || 50), 0, 100);
  const starterBoost = player?.lastStartedAt ? 0.2 : 0;
  return {
    rating: Number(clamp(5.5 + strength / 50 + starterBoost, 5.5, 7.7).toFixed(1)),
    ratingSource: "teamprofiel-indicatie",
  };
}

export function sortSquadPlayersByRating(players: any[], teamStrength?: number | null) {
  const squadPlayers = Array.isArray(players) ? players : [];
  return squadPlayers
    .map((player) => ({ ...player, ...derivePlayerRating(player, squadPlayers, teamStrength) }))
    .sort((left, right) =>
      Number(Boolean(left.unavailable)) - Number(Boolean(right.unavailable)) ||
      Number(right.rating || 0) - Number(left.rating || 0) ||
      Number(right.marketValueEur || 0) - Number(left.marketValueEur || 0) ||
      String(left.name || "").localeCompare(String(right.name || "")),
    );
}
