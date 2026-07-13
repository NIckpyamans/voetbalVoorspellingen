#!/usr/bin/env node

import assert from "node:assert/strict";
import { selectUniqueTeamTopPicks } from "./worker/top-picks.js";

const candidates = [
  { matchId: "a", homeTeam: "La Fiorita", awayTeam: "UNA Strassen", score: 0.35 },
  { matchId: "b", homeTeam: "Spartak Trnava", awayTeam: "Besiktas", score: 0.29 },
  { matchId: "c", homeTeam: "Dynamo Malzenice", awayTeam: "Besiktas JK", score: 0.28 },
  { matchId: "d", homeTeam: "LASK", awayTeam: "Fenerbahce", score: 0.25 },
  { matchId: "e", homeTeam: "Iberia 1999", awayTeam: "Flora", score: 0.21 },
  { matchId: "f", homeTeam: "KuPS", awayTeam: "Vardar", score: 0.2 },
];

const normalizeTeam = (value) => String(value || "").toLowerCase().replace(/\bjk\b/g, "").trim();
const selected = selectUniqueTeamTopPicks(candidates, { limit: 5, normalizeTeam });

assert.deepEqual(selected.map((item) => item.matchId), ["a", "b", "d", "e", "f"]);
assert.equal(selected.filter((item) => /besiktas/i.test(item.awayTeam)).length, 1);
console.log("[test-top-picks] unique-team ranking passed");
