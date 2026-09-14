import { describe, expect, it } from "vitest";
import { buildHistoricalForm, buildHistoricalH2H, mergeHistoricalContext } from "../../scripts/backfill-recent-match-context.js";

const row = (date, home, away, score) => ({
  id: `${date}-${home}-${away}`,
  date,
  _dateKey: date,
  _kickoffMs: Date.parse(`${date}T15:00:00Z`),
  kickoff: `${date}T15:00:00Z`,
  homeTeamName: home,
  awayTeamName: away,
  score,
  status: "FT",
});

describe("recent match context backfill", () => {
  const history = [
    row("2026-01-01", "Brighton", "Aston Villa", "2-1"),
    row("2026-02-01", "Aston Villa FC", "Brighton", "0-0"),
    row("2026-03-01", "Brighton", "Chelsea", "3-0"),
    row("2026-04-01", "Arsenal", "Brighton", "1-0"),
    row("2026-05-01", "Brighton", "Leeds", "2-2"),
    row("2026-06-01", "Liverpool", "Brighton", "0-1"),
    row("2026-07-01", "Brighton", "Everton", "2-0"),
  ];
  const target = { ...row("2026-08-23", "Brighton", "Aston Villa", "4-0"), homeTeamId: "brighton", awayTeamId: "villa" };

  it("uses only earlier direct meetings and orients the winner", () => {
    const h2h = buildHistoricalH2H(target, history);
    expect(h2h).toMatchObject({ played: 2, homeWins: 1, draws: 1, awayWins: 0 });
    expect(h2h.results).toHaveLength(2);
  });

  it("builds form exclusively from matches before kickoff", () => {
    const form = buildHistoricalForm(target, [...history, target], "Brighton");
    expect(form.gamesPlayed).toBe(7);
    expect(form.form).toBe("WLDWW");
    expect(form.recentMatches.every((match) => match.date < target.date)).toBe(true);
  });

  it("does not include the target result in its own H2H context", () => {
    const h2h = buildHistoricalH2H(target, [...history, target]);
    expect(h2h.played).toBe(2);
    expect(h2h.results.some((result) => result.date === target.date)).toBe(false);
  });

  it("keeps the target result out even when the source row uses compact names", () => {
    const compactTarget = {
      eventId: target.id,
      date: target.date,
      home: target.homeTeamName,
      away: target.awayTeamName,
      score: target.score,
    };
    const h2h = buildHistoricalH2H(target, [...history, target]);
    expect(h2h.results).not.toContainEqual(compactTarget);
  });
  it("preserves valid provider history when removing the target with a sparse local archive", () => {
    const homeRecent = buildHistoricalForm({ ...target, date: "2026-09-01", kickoff: "2026-09-01T15:00:00Z" }, [...history, target], "Brighton");
    const h2h = { played: 3, results: [...buildHistoricalH2H(target, history).results, { eventId: target.id, date: target.date, home: "Brighton", away: "Aston Villa", score: "4-0" }] };
    const input = { ...target, homeRecent, h2h, postMatchStats: { source: "test" }, predictionId: "immutable" };
    const result = mergeHistoricalContext(input, [history[6], target]);
    expect(result.homeRecent.gamesPlayed).toBe(7);
    expect(result.h2h.played).toBe(2);
    expect(result.predictionId).toBe("immutable");
    expect(result.postMatchStats).toEqual(input.postMatchStats);
    expect(input.h2h.played).toBe(3);
    expect(mergeHistoricalContext(result, [history[6], target])).toEqual(result);
  });

  it("removes future form and H2H even when the target itself is absent", () => {
    const future = row("2026-09-01", "Brighton", "Aston Villa", "5-0");
    const result = mergeHistoricalContext({ ...target,
      homeRecent: { gamesPlayed: 1, recentMatches: [{ date: future.date, opponent: "Aston Villa", venue: "H", goalsFor: 5, goalsAgainst: 0 }] },
      h2h: { played: 1, results: [{ date: future.date, home: "Brighton", away: "Aston Villa", score: "5-0" }] },
    }, []);
    expect(result.homeRecent).toBeUndefined();
    expect(result.h2h).toBeUndefined();
    expect(result.homeForm).toBe("");
  });

});
