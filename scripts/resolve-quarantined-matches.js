#!/usr/bin/env node

import crypto from "crypto";
import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);

const slug = (value) => String(value || "").toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/\b(fc|cf|afc|sc|club)\b/g, " ")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const digest = (value) => crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 18);
const codeMap = {
  E0: ["England", 1], E1: ["England", 2], N1: ["Netherlands", 1], N2: ["Netherlands", 2],
  D1: ["Germany", 1], SP1: ["Spain", 1], SP2: ["Spain", 2], I1: ["Italy", 1], F1: ["France", 1],
  B1: ["Belgium", 1], P1: ["Portugal", 1], P2: ["Spain", 2],
};
const leagueProfiles = {
  "Belgium - Pro League": { id: "competition-belgium-l1", country: "Belgium", level: 1, name: "Belgium - Pro League" },
  "Netherlands - Eerste Divisie": { id: "competition-netherlands-l2", country: "Netherlands", level: 2, name: "Netherlands - Eerste Divisie" },
  "France - Ligue 2": { id: "competition-france-l2", country: "France", level: 2, name: "France - Ligue 2" },
  "Italy - Serie B": { id: "competition-italy-l2", country: "Italy", level: 2, name: "Italy - Serie B" },
  "Portugal - Liga Portugal": { id: "competition-portugal-l1", country: "Portugal", level: 1, name: "Portugal - Liga Portugal" },
  "Europe - Champions League": { id: "competition-europe-champions-league", country: "Europe", level: 1, name: "Europe - Champions League" },
  "Europe - Europa League": { id: "competition-europe-europa-league", country: "Europe", level: 2, name: "Europe - Europa League" },
  "Europe - Conference League": { id: "competition-europe-conference-league", country: "Europe", level: 3, name: "Europe - Conference League" },
};

async function ensureCompetition(profile, evidence, confidence) {
  const countryId = `country-${slug(profile.country)}`;
  await sql.query(
    "insert into countries(country_id,name) values($1,$2) on conflict(country_id) do update set name=excluded.name",
    [countryId, profile.country]
  );
  await sql.query(
    `insert into competitions(competition_id,name,country_id,country_name,level,provider_ids)
     values($1,$2,$3,$4,$5,$6::jsonb) on conflict(competition_id) do update set
       name=excluded.name,country_id=excluded.country_id,country_name=excluded.country_name,level=excluded.level,updated_at=now()`,
    [profile.id, profile.name, countryId, profile.country, profile.level, JSON.stringify({ resolver: evidence })]
  );
  return { competition_id: profile.id, country_id: countryId, country_name: profile.country, level: profile.level, evidence, confidence };
}

function providerCode(matchId) {
  return String(matchId || "").match(/^ss-fd-([A-Z0-9]+)-/)?.[1] || null;
}

async function resolveCompetition(match) {
  const code = providerCode(match.match_id);
  const mapped = codeMap[code];
  if (mapped) {
    const [row] = await sql.query(
      "select competition_id,country_id,country_name,level from competitions where lower(country_name)=lower($1) and level=$2 order by updated_at desc limit 1",
      mapped
    );
    if (row) return { ...row, evidence: `provider_code:${code}`, confidence: 0.98 };
    const profile = {
      id: `competition-${slug(mapped[0])}-l${mapped[1]}`,
      country: mapped[0],
      level: mapped[1],
      name: `${mapped[0]} - Level ${mapped[1]}`,
    };
    return ensureCompetition(profile, `provider_code_created:${code}`, 0.94);
  }
  const [exact] = await sql.query(
    "select competition_id,country_id,country_name,level from competitions where lower(name)=lower($1) order by updated_at desc limit 1",
    [match.league]
  );
  if (exact) return { ...exact, evidence: "league_exact", confidence: 0.9 };
  const profile = leagueProfiles[match.league];
  return profile ? ensureCompetition(profile, "league_profile_created", 0.9) : null;
}

async function resolveSeason(competitionId, dateKey) {
  const year = Number(String(dateKey).slice(0, 4));
  const candidates = await sql.query(
    "select season_id,year_label from seasons where competition_id=$1 order by updated_at desc",
    [competitionId]
  );
  const found = candidates.find((row) => {
    const years = String(row.year_label || "").match(/20\d{2}/g)?.map(Number) || [];
    return years.includes(year) || years.includes(year - 1);
  }) || candidates[0] || null;
  if (found) return found;
  const month = Number(String(dateKey).slice(5, 7));
  const start = month >= 7 ? year : year - 1;
  const yearLabel = `${start}/${start + 1}`;
  const seasonId = `${competitionId}-${start}${start + 1}`;
  await sql.query(
    `insert into seasons(season_id,competition_id,year_label,status) values($1,$2,$3,'active')
     on conflict(season_id) do update set competition_id=excluded.competition_id,year_label=excluded.year_label,updated_at=now()`,
    [seasonId, competitionId, yearLabel]
  );
  await sql.query(
    `insert into competition_seasons(season_id,competition_id,year_label,status) values($1,$2,$3,'active')
     on conflict(season_id) do update set competition_id=excluded.competition_id,year_label=excluded.year_label,updated_at=now()`,
    [seasonId, competitionId, yearLabel]
  );
  return { season_id: seasonId, year_label: yearLabel };
}

async function resolveClub(name, competition) {
  const key = slug(name);
  const [alias] = await sql.query(
    `select c.club_id,c.name from club_aliases a join clubs c on c.club_id=a.club_id
     where a.normalized_alias=$1 order by (c.country_id=$2) desc, c.updated_at desc limit 1`,
    [key, competition.country_id]
  );
  if (alias) return { clubId: alias.club_id, evidence: "club_alias", confidence: 0.96 };
  const [named] = await sql.query(
    "select club_id,name from clubs where lower(regexp_replace(name,'[^a-zA-Z0-9]+','-','g'))=$1 order by (country_id=$2) desc limit 1",
    [key, competition.country_id]
  );
  if (named) return { clubId: named.club_id, evidence: "club_name", confidence: 0.91 };
  const clubId = `club-${slug(competition.country_name || "international")}-${key}`;
  await sql.query(
    `insert into clubs (club_id,name,country_id,country_name,history)
     values ($1,$2,$3,$4,$5::jsonb) on conflict (club_id) do update set updated_at=now()`,
    [clubId, name, competition.country_id, competition.country_name, JSON.stringify({ createdBy: "quarantine-resolver" })]
  );
  await sql.query(
    "insert into club_aliases (club_id,alias,normalized_alias,source) values ($1,$2,$3,'quarantine-resolver') on conflict (club_id,normalized_alias) do nothing",
    [clubId, name, key]
  );
  return { clubId, evidence: "controlled_club_create", confidence: 0.82 };
}

const limit = Math.max(1, Number(process.env.IDENTITY_RESOLVER_LIMIT || 1000));
const matches = await sql.query(
  "select * from matches where identity_status='quarantined' order by date_key desc limit $1",
  [limit]
);
let resolved = 0;
let retained = 0;
for (const match of matches) {
  const competition = await resolveCompetition(match);
  if (!competition) {
    retained += 1;
    continue;
  }
  const season = await resolveSeason(competition.competition_id, match.date_key);
  const home = await resolveClub(match.home_team_name, competition);
  const away = await resolveClub(match.away_team_name, competition);
  const confidence = Math.min(competition.confidence, home.confidence, away.confidence, season ? 0.9 : 0);
  const payload = { competition, season, home, away, confidence };
  if (!season || confidence < 0.8) {
    retained += 1;
    await sql.query(
      "update match_identity_quarantine set attempts=attempts+1,last_attempt_at=now(),resolution_payload=$2::jsonb,updated_at=now() where match_id=$1",
      [match.match_id, JSON.stringify(payload)]
    );
    continue;
  }
  await sql.query(
    `update matches set competition_id=$2,season_id=$3,home_club_id=$4,away_club_id=$5,
      team_identity=coalesce(team_identity,'{}'::jsonb)||$6::jsonb,updated_at=now() where match_id=$1`,
    [match.match_id, competition.competition_id, season.season_id, home.clubId, away.clubId,
      JSON.stringify({ resolver: "automatic-v1", evidence: payload, resolutionId: digest(match.match_id) })]
  );
  await sql.query(
    "update match_identity_quarantine set status='resolved',attempts=attempts+1,last_attempt_at=now(),resolved_at=now(),resolution_payload=$2::jsonb,updated_at=now() where match_id=$1",
    [match.match_id, JSON.stringify(payload)]
  );
  resolved += 1;
}
console.log(JSON.stringify({ candidates: matches.length, resolved, retained }, null, 2));
