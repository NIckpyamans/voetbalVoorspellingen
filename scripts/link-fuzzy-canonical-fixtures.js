#!/usr/bin/env node

import crypto from "crypto";
import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  process.stderr.write("DATABASE_URL of POSTGRES_URL ontbreekt.\n");
  process.exit(2);
}

const APPLY = process.argv.includes("--apply");
const MIN_SIDE_SCORE = Number(process.env.FUZZY_FIXTURE_MIN_SIDE_SCORE || 0.84);
const MIN_AVG_SCORE = Number(process.env.FUZZY_FIXTURE_MIN_AVG_SCORE || 0.88);
const startedAt = Date.now();

const TEAM_EQUIVALENTS = new Map(Object.entries({
  "ath madrid": "atletico madrid",
  "club atletico madrid": "atletico madrid",
  "atletico de madrid": "atletico madrid",
  "ath bilbao": "athletic bilbao",
  "athletic club": "athletic bilbao",
  "barca": "barcelona",
  "fc barcelona": "barcelona",
  "bayern munchen": "bayern munich",
  "fc bayern munchen": "bayern munich",
  "borussia monchengladbach": "borussia monchengladbach",
  "monchengladbach": "borussia monchengladbach",
  "m gladbach": "borussia monchengladbach",
  "ein frankfurt": "eintracht frankfurt",
  "fc koln": "koln",
  "cologne": "koln",
  "inter": "internazionale",
  "fc internazionale milano": "internazionale",
  "internazionale milano": "internazionale",
  "juve": "juventus",
  "psg": "paris saint germain",
  "paris sg": "paris saint germain",
  "paris saint germain": "paris saint germain",
  "rayo vallecano de madrid": "rayo vallecano",
  "vallecano": "rayo vallecano",
  "real sociedad de futbol": "real sociedad",
  "sociedad": "real sociedad",
  "deportivo alaves": "alaves",
  "real betis balompie": "real betis",
  "betis": "real betis",
  "rcd espanyol de barcelona": "espanyol",
  "espanol": "espanyol",
  "rcd mallorca": "mallorca",
  "for sittard": "fortuna sittard",
  "nijmegen": "nec",
  "nec nijmegen": "nec",
  "fc twente 65": "twente",
  "fc twente": "twente",
  "psv eindhoven": "psv",
  "afc ajax": "ajax",
  "az alkmaar": "az",
  "fc groningen": "groningen",
  "go ahead eagles": "go ahead",
  "sheffield weds": "sheffield wednesday",
  "qpr": "queens park rangers",
  "leverkusen": "bayer leverkusen",
  "bayer 04 leverkusen": "bayer leverkusen",
  "dortmund": "borussia dortmund",
  "rb leipzig": "leipzig",
  "stade brestois 29": "brest",
  "brestois": "brest",
  "stade rennais 1901": "rennes",
  "stade rennais": "rennes",
  "rennais": "rennes",
  "angers sco": "angers",
  "olympique lyonnais": "lyon",
  "ol lyonnais": "lyon",
  "olympique de marseille": "marseille",
  "om": "marseille",
  "paris fc": "paris fc",
  "rc strasbourg alsace": "strasbourg",
  "rc strasbourg": "strasbourg",
  "fc nantes": "nantes",
  "fc lorient": "lorient",
  "toulouse fc": "toulouse",
  "havre ac": "le havre",
  "le havre ac": "le havre",
  "as monaco": "monaco",
  "fc metz": "metz",
  "osc lille": "lille",
  "losc lille": "lille",
  "sl benfica": "benfica",
  "sport lisboa e benfica": "benfica",
  "sporting cp": "sporting lisbon",
  "sporting clube de portugal": "sporting lisbon",
  "fc porto": "porto",
  "sc braga": "braga",
  "sporting braga": "braga",
  "vitoria guimaraes": "guimaraes",
  "vitoria sc": "guimaraes",
  "gil vicente fc": "gil vicente",
  "rio ave fc": "rio ave",
  "fc famalicao": "famalicao",
  "estrela amadora": "estrela",
  "cf estrela amadora": "estrela",
  "avs futebol sad": "avs",
  "cd nacional": "nacional",
  "cd santa clara": "santa clara",
  "fc arouca": "arouca",
  "gd estoril praia": "estoril",
  "estoril praia": "estoril",
  "moreirense fc": "moreirense",
}));

function digest(value, size = 24) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, size);
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeTeam(value) {
  const raw = slug(value)
    .replace(/\b(football club|futbol club|club de futbol|de futbol|fc|afc|cf|sc|ssc|ac|as|calcio|club|stade|olympique|royal|koninklijke|de|la|the)\b/g, " ")
    .replace(/\b(19|18|20)?\d{2}\b/g, " ")
    .replace(/\butd\b/g, "united")
    .replace(/\bmunchen\b/g, "munich")
    .replace(/\bkoln\b/g, "koln")
    .replace(/\s+/g, " ")
    .trim();
  return TEAM_EQUIVALENTS.get(raw) || raw;
}

function tokens(value) {
  return new Set(normalizeTeam(value).split(" ").filter(Boolean));
}

function similarity(left, right) {
  const a = normalizeTeam(left);
  const b = normalizeTeam(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 5 && b.includes(a)) return 0.94;
  if (b.length >= 5 && a.includes(b)) return 0.94;
  const aTokens = tokens(a);
  const bTokens = tokens(b);
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size || 1;
  const jaccard = intersection / union;
  const containment = intersection / Math.min(aTokens.size || 1, bTokens.size || 1);
  return Math.max(jaccard, containment >= 0.8 ? 0.9 : containment * 0.88);
}

function hasPlaceholderTeam(match) {
  const value = `${match.home_team_name || ""} ${match.away_team_name || ""}`.toLowerCase();
  return /\b(group|third place|winner|runner-up|2nd place|3rd place)\b/.test(value);
}

function quality(row) {
  return Number(Boolean(row.home_club_id)) * 8 +
    Number(Boolean(row.away_club_id)) * 8 +
    Number(Boolean(row.competition_id)) * 6 +
    Number(Boolean(row.season_id)) * 4 +
    Number(Boolean(row.has_result)) * 10 +
    Number(Boolean(row.has_stats)) * 6 +
    Number(row.source_links || 0);
}

class DisjointSet {
  constructor(items) {
    this.parent = new Map(items.map((item) => [item, item]));
  }
  find(item) {
    const parent = this.parent.get(item);
    if (parent === item) return item;
    const root = this.find(parent);
    this.parent.set(item, root);
    return root;
  }
  union(left, right) {
    const a = this.find(left);
    const b = this.find(right);
    if (a !== b) this.parent.set(b, a);
  }
}

const rows = await sql.query(`
  select m.*,
    exists(select 1 from match_results mr where mr.match_id=m.match_id) as has_result,
    exists(select 1 from match_stats ms where ms.match_id=m.match_id) as has_stats,
    (select count(1)::int from match_source_records msr where msr.match_id=m.match_id) as source_links
  from matches m
  where m.date_key::date between current_date - 90 and current_date + 180
    and m.date_key is not null
    and m.home_team_name is not null
    and m.away_team_name is not null
`);

const buckets = new Map();
for (const row of rows.filter((row) => !hasPlaceholderTeam(row))) {
  const key = `${row.date_key}|${slug(row.league || "")}`;
  const bucket = buckets.get(key) || [];
  bucket.push(row);
  buckets.set(key, bucket);
}

const candidateGroups = [];
for (const bucket of buckets.values()) {
  if (bucket.length < 2) continue;
  const ds = new DisjointSet(bucket.map((row) => row.match_id));
  const byId = new Map(bucket.map((row) => [row.match_id, row]));
  const edges = [];
  for (let i = 0; i < bucket.length; i += 1) {
    for (let j = i + 1; j < bucket.length; j += 1) {
      const left = bucket[i];
      const right = bucket[j];
      if (left.match_id === right.match_id) continue;
      if (left.data_source && right.data_source && left.data_source === right.data_source) continue;
      const homeScore = similarity(left.home_team_name, right.home_team_name);
      const awayScore = similarity(left.away_team_name, right.away_team_name);
      const avgScore = (homeScore + awayScore) / 2;
      if (homeScore >= MIN_SIDE_SCORE && awayScore >= MIN_SIDE_SCORE && avgScore >= MIN_AVG_SCORE) {
        ds.union(left.match_id, right.match_id);
        edges.push({ left: left.match_id, right: right.match_id, homeScore, awayScore, avgScore });
      }
    }
  }
  const components = new Map();
  for (const row of bucket) {
    const root = ds.find(row.match_id);
    const group = components.get(root) || [];
    group.push(row);
    components.set(root, group);
  }
  for (const group of components.values()) {
    if (group.length < 2) continue;
    const providers = new Set(group.map((row) => row.data_source || "unknown"));
    if (providers.size < 2) continue;
    group.sort((a, b) => quality(b) - quality(a) || String(a.match_id).localeCompare(String(b.match_id)));
    const target = group.find((row) => row.canonical_fixture_id) || group[0];
    const canonicalFixtureId = target.canonical_fixture_id || `fuzzy_fixture_${digest(`${target.date_key}|${slug(target.league || "")}|${normalizeTeam(target.home_team_name)}|${normalizeTeam(target.away_team_name)}`)}`;
    candidateGroups.push({
      canonicalFixtureId,
      target,
      matches: group,
      providers: [...providers].sort(),
      edges: edges.filter((edge) => group.some((row) => row.match_id === edge.left) && group.some((row) => row.match_id === edge.right)),
    });
  }
}

async function insertClubAlias(clubId, alias, source) {
  if (!clubId || !alias) return false;
  await sql.query(
    `insert into club_aliases (club_id, alias, normalized_alias, source)
     values ($1, $2, $3, $4)
     on conflict (club_id, normalized_alias) do nothing`,
    [clubId, alias, slug(alias).replace(/\s+/g, "-"), source]
  );
  return true;
}

async function registerFixtureAlias(canonicalFixtureId, targetMatchId, row) {
  const provider = String(row.data_source || "unknown");
  const sourceId = String(row.source_match_id || row.match_id);
  await sql.query(
    `insert into fixture_source_aliases (
       fixture_source_alias_id, canonical_fixture_id, canonical_match_id, source_match_id, provider, source_payload
     )
     values ($1, $2, $3, $4, $5, $6::jsonb)
     on conflict (provider, source_match_id) do update set
       canonical_fixture_id=excluded.canonical_fixture_id,
       canonical_match_id=excluded.canonical_match_id,
       source_payload=fixture_source_aliases.source_payload || excluded.source_payload,
       updated_at=now()`,
    [
      `alias_${digest(`${provider}|${sourceId}`)}`,
      canonicalFixtureId,
      targetMatchId,
      sourceId,
      provider,
      JSON.stringify({
        originalMatchId: row.match_id,
        dateKey: row.date_key,
        league: row.league,
        homeTeam: row.home_team_name,
        awayTeam: row.away_team_name,
        linkedBy: "fuzzy-canonical-fixtures-v1",
      }),
    ]
  );
}

let linkedMatches = 0;
let aliasesInserted = 0;
if (APPLY) {
  for (const group of candidateGroups) {
    const target = group.target;
    const homeClubId = target.home_club_id || group.matches.find((row) => row.home_club_id)?.home_club_id || null;
    const awayClubId = target.away_club_id || group.matches.find((row) => row.away_club_id)?.away_club_id || null;
    if (!target.canonical_fixture_id) {
      await sql.query(
        "update matches set canonical_fixture_id=$1, updated_at=now() where match_id=$2 and canonical_fixture_id is null",
        [group.canonicalFixtureId, target.match_id]
      );
    }
    for (const row of group.matches) {
      await registerFixtureAlias(group.canonicalFixtureId, target.match_id, row);
      if (await insertClubAlias(homeClubId, row.home_team_name, "fuzzy-fixture-link")) aliasesInserted += 1;
      if (await insertClubAlias(awayClubId, row.away_team_name, "fuzzy-fixture-link")) aliasesInserted += 1;
      linkedMatches += 1;
    }
  }
}

const examples = candidateGroups.slice(0, 25).map((group) => ({
  canonicalFixtureId: group.canonicalFixtureId,
  dateKey: group.target.date_key,
  league: group.target.league,
  providers: group.providers,
  matches: group.matches.map((row) => ({
    matchId: row.match_id,
    source: row.data_source,
    home: row.home_team_name,
    away: row.away_team_name,
    canonicalBefore: row.canonical_fixture_id,
  })),
  scores: group.edges.slice(0, 5).map((edge) => ({
    home: Number(edge.homeScore.toFixed(3)),
    away: Number(edge.awayScore.toFixed(3)),
    avg: Number(edge.avgScore.toFixed(3)),
  })),
}));

console.log(JSON.stringify({
  ok: true,
  mode: APPLY ? "apply" : "dry-run",
  thresholds: { minSideScore: MIN_SIDE_SCORE, minAvgScore: MIN_AVG_SCORE },
  scopedMatches: rows.length,
  candidateGroups: candidateGroups.length,
  candidateMatches: candidateGroups.reduce((sum, group) => sum + group.matches.length, 0),
  linkedMatches,
  aliasesInserted,
  examples,
  durationMs: Date.now() - startedAt,
}, null, 2));
