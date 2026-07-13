#!/usr/bin/env node

import assert from "node:assert/strict";
import { normalizeApiFootball, normalizeSofaScore, normalizeSportmonks } from "./collect-pre-kickoff-lineups.js";

const apiPlayers = Array.from({ length: 11 }, (_, index) => ({
  player: { name: `API speler ${index + 1}`, number: index + 1, pos: index === 0 ? "G" : "M" },
}));
const api = normalizeApiFootball({
  response: [
    { formation: "4-3-3", startXI: apiPlayers, substitutes: [{ player: { name: "Wissel thuis" } }] },
    { formation: "4-2-3-1", startXI: apiPlayers, substitutes: [{ player: { name: "Wissel uit" } }] },
  ],
});
assert.equal(api?.confirmed, true);
assert.equal(api?.home?.starters, 11);
assert.equal(api?.away?.formation, "4-2-3-1");

const sportmonksRows = (teamId) => Array.from({ length: 11 }, (_, index) => ({
  team_id: teamId,
  type_id: 11,
  jersey_number: index + 1,
  player: { name: `Sportmonks ${teamId}-${index + 1}`, position: index === 0 ? "Goalkeeper" : "Midfielder" },
}));
const sportmonks = normalizeSportmonks({
  data: {
    participants: [{ id: 1, meta: { location: "home" } }, { id: 2, meta: { location: "away" } }],
    lineups: [...sportmonksRows(1), ...sportmonksRows(2)],
  },
});
assert.equal(sportmonks?.confirmed, true);
assert.equal(sportmonks?.home?.players?.[0]?.name, "Sportmonks 1-1");

const sofa = normalizeSofaScore({
  home: { formation: "4-3-3", players: apiPlayers.map((item) => ({ ...item, substitute: false })) },
  away: { formation: "4-4-2", players: apiPlayers.map((item) => ({ ...item, substitute: false })) },
});
assert.equal(sofa?.confirmed, true);
assert.equal(sofa?.away?.starters, 11);

console.log("[test-pre-kickoff-lineups] SofaScore, API-Football en Sportmonks contracten: PASS");
