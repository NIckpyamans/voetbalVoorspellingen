#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";

const ROOT = process.cwd();
loadLocalEnv(ROOT);

const sql = getSql();
if (!sql) {
  console.error("DATABASE_URL of POSTGRES_URL ontbreekt.");
  process.exit(2);
}

const daysAhead = Math.max(1, Number(process.env.LINEUP_MONITOR_DAYS_AHEAD || 14));
const limit = Math.max(1, Number(process.env.LINEUP_MONITOR_LIMIT || 120));

function objectAt(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || null;
}

function hasConfirmedLineup(snapshot = {}) {
  const lineup = objectAt(
    snapshot.input_snapshot?.lineupSummary,
    snapshot.prediction_payload?.lineupSummary,
    snapshot.prediction_payload?.lineups
  );
  return Boolean(lineup?.confirmed || (lineup?.home?.confirmed && lineup?.away?.confirmed));
}

function hasProjectedLineup(snapshot = {}) {
  const lineup = objectAt(
    snapshot.input_snapshot?.lineupSummary,
    snapshot.prediction_payload?.lineupSummary,
    snapshot.prediction_payload?.lineups
  );
  return Boolean(lineup?.projected || lineup?.home || lineup?.away);
}

function hasAvailability(snapshot = {}) {
  const availability = objectAt(
    snapshot.input_snapshot?.availabilitySummary,
    snapshot.prediction_payload?.availabilitySummary
  );
  const homeInjuries = objectAt(snapshot.input_snapshot?.homeInjuries, snapshot.prediction_payload?.homeInjuries);
  const awayInjuries = objectAt(snapshot.input_snapshot?.awayInjuries, snapshot.prediction_payload?.awayInjuries);
  return Boolean(
    Number(availability?.coverage || 0) > 0 ||
      (homeInjuries && awayInjuries) ||
      Number(snapshot.features?.availability_coverage || 0) > 0
  );
}

function latestSnapshotForMatch(rows, matchId) {
  return rows.find((row) => row.match_id === matchId) || null;
}

const matches = await sql.query(
  `select match_id, date_key, league, home_team_name, away_team_name, kickoff_at
   from matches
   where kickoff_at > now()
     and kickoff_at <= now() + ($1::text || ' days')::interval
     and identity_status = 'resolved'
   order by kickoff_at asc
   limit $2`,
  [String(daysAhead), limit]
);

const snapshots = matches.length
  ? await sql.query(
      `select distinct on (match_id) match_id, generated_at, input_snapshot, prediction_payload, features
       from prediction_snapshots
       where match_id = any($1::text[])
       order by match_id, generated_at desc`,
      [matches.map((match) => match.match_id)]
    )
  : [];

let confirmed = 0;
let projected = 0;
let availability = 0;
let withoutSnapshot = 0;
const samples = [];

for (const match of matches) {
  const snapshot = latestSnapshotForMatch(snapshots, match.match_id);
  if (!snapshot) withoutSnapshot += 1;
  const confirmedLineup = hasConfirmedLineup(snapshot || {});
  const projectedLineup = hasProjectedLineup(snapshot || {});
  const availabilityCovered = hasAvailability(snapshot || {});
  if (confirmedLineup) confirmed += 1;
  if (projectedLineup) projected += 1;
  if (availabilityCovered) availability += 1;
  if (samples.length < 40 && (!confirmedLineup || !availabilityCovered || !snapshot)) {
    samples.push({
      matchId: match.match_id,
      kickoff: match.kickoff_at,
      league: match.league,
      home: match.home_team_name,
      away: match.away_team_name,
      latestSnapshotAt: snapshot?.generated_at || null,
      confirmedLineup,
      projectedLineup,
      availabilityCovered,
      reason: !snapshot
        ? "Geen prediction snapshot voor deze toekomstige wedstrijd."
        : !confirmedLineup && !availabilityCovered
          ? "Opstelling en availability ontbreken of zijn alleen impliciet."
          : !confirmedLineup
            ? "Opstelling nog niet bevestigd."
            : "Availability/blessuredekking ontbreekt.",
    });
  }
}

const total = matches.length;
const report = {
  generatedAt: new Date().toISOString(),
  daysAhead,
  checked: total,
  confirmedLineups: confirmed,
  projectedLineups: projected,
  availabilityCovered: availability,
  withoutSnapshot,
  confirmedLineupCoverage: total ? Number((confirmed / total).toFixed(3)) : 0,
  projectedLineupCoverage: total ? Number((projected / total).toFixed(3)) : 0,
  availabilityCoverage: total ? Number((availability / total).toFixed(3)) : 0,
  samples,
  recommendation:
    total && confirmed / total < 0.45
      ? "Plan extra worker-refresh vlak voor kickoff en voeg een bredere lineups/availability provider toe."
      : total && availability / total < 0.75
        ? "Lineups zijn bruikbaar, maar blessures/schorsingen hebben extra brondekking nodig."
        : "Lineups en availability zijn voldoende voor het huidige venster.",
};

for (const [key, value] of [
  ["lineup_confirmed_coverage", report.confirmedLineupCoverage],
  ["lineup_projected_coverage", report.projectedLineupCoverage],
  ["availability_coverage", report.availabilityCoverage],
]) {
  await sql.query("insert into integrity_metric_snapshots(metric_key,metric_value,metadata) values($1,$2,$3::jsonb)", [
    `lineup_availability_${key}`,
    Number(value),
    JSON.stringify({ source: "lineup-availability-monitor", daysAhead }),
  ]);
}

fs.mkdirSync(path.join(ROOT, "monitor"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "monitor", "lineup-availability-monitor.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
