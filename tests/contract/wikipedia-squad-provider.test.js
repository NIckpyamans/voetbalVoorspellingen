import { describe, expect, it } from "vitest";
import { parseWikipediaSquad, wikipediaTitleMatchesTeam } from "../../scripts/providers/wikipedia-squad-provider.js";

describe("Wikipedia squad provider", () => {
  it("requires the meaningful club-name tokens", () => {
    expect(wikipediaTitleMatchesTeam("FC CSKA 1948 Sofia", "CSKA 1948 Sofia")).toBe(true);
    expect(wikipediaTitleMatchesTeam("PFC CSKA Sofia", "CSKA 1948 Sofia")).toBe(false);
  });

  it("parses squad templates and keeps loan status separate", () => {
    const text = [
      "{{Fs player|no=1|nat=NED|pos=GK|name=[[Test Keeper]]}}",
      "==Out on loan==",
      "{{Football squad player|no=9|nat=BEL|pos=FW|name=[[Loan Player]]}}",
    ].join("\n");
    const players = parseWikipediaSquad(text);
    expect(players).toEqual([
      expect.objectContaining({ name: "Test Keeper", position: "GK", loan: false, availability: "onbekend" }),
      expect.objectContaining({ name: "Loan Player", position: "FW", loan: true, availability: "verhuurd" }),
    ]);
  });
});
