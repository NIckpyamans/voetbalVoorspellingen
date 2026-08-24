import { describe, expect, it } from "vitest";
import { buildHistoricalForm, buildHistoricalH2H } from "../../scripts/backfill-recent-match-context.js";

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
});
