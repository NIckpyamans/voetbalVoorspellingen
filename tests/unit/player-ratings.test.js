import { describe, expect, it } from "vitest";
import { derivePlayerRating, sortSquadPlayersByRating } from "../../utils/playerRatings";

describe("player ratings", () => {
  it("uses one global value scale instead of ranking each club's star equally", () => {
    const cheap = {marketValueEur:1000000}, expensive = {marketValueEur:50000000};
    expect(derivePlayerRating(expensive, [expensive]).rating).toBeGreaterThan(derivePlayerRating(cheap,[cheap]).rating);
    expect(derivePlayerRating(cheap, [expensive,cheap]).rating).toBe(derivePlayerRating(cheap,[cheap]).rating);
  });
  it("keeps a provider rating as the primary rating", () => {
    expect(derivePlayerRating({ rating: 7.43 }, [], 60)).toEqual({ rating: 7.4, ratingSource: "provider" });
  });

  it("sorts the highest available player first", () => {
    const players = sortSquadPlayersByRating([
      { name: "Unavailable star", rating: 9, unavailable: true },
      { name: "Available star", rating: 8 },
      { name: "Squad player", marketValueEur: 100_000 },
    ], 60);
    expect(players.map((player) => player.name)).toEqual(["Available star", "Squad player", "Unavailable star"]);
  });

  it("marks inferred ratings instead of presenting them as provider data", () => {
    expect(derivePlayerRating({ name: "Player" }, [], 65)).toEqual({ rating: 6.8, ratingSource: "teamprofiel-indicatie" });
  });
});
