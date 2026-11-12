import { aliasVariants, dbAliasKey, getSql } from "./database.js";

// De worker las per wedstrijd zes tot acht keer Neon: club-ID's, aliassen,
// clubnamen, de fixture-resolve, team_season_stats, h2h_edges en het
// feature-bundel. Deze module doet dezelfde lookups in één keer voor het hele
// datumvenster, met dezelfde prioriteitsorde en dezelfde uitvoervorm als
// readDatabaseFeatureContext(). De per-wedstrijd variant blijft bestaan als
// fallback wanneer de batch niets oplevert.
//
//   const contexts = await readDatabaseFeatureContextBatch(requests);
//   contexts.get("ss-123") // of .has(...) === false → zelf ophalen

const CLUB_ID_QUERY = `
  /* dfb:club-ids */
  select club_id::text as club_id
  from clubs
  where club_id = any($1::text[])
`;

const CLUB_ALIAS_QUERY = `
  /* dfb:club-aliases */
  select normalized_alias, club_id::text as club_id
  from club_aliases
  where normalized_alias = any($1::text[])
`;

const CLUB_NAME_QUERY = `
  /* dfb:club-names */
  select club_id::text as club_id, name
  from clubs
  where lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) = any($1::text[])
`;

// Eén query voor alle drie de resolutiestappen; de keuze volgorde (match-ID,
// dan datum + clubs, dan datum + namen) wordt hieronder in JS toegepast.
const MATCH_QUERY = `
  /* dfb:matches */
  select match_id::text as match_id,
    date_key,
    home_club_id::text as home_club_id,
    away_club_id::text as away_club_id,
    lower(home_team_name) as home_name,
    lower(away_team_name) as away_name
  from matches
  where match_id = any($1::text[])
     or (
       identity_status = 'resolved'
       and date_key = any($2::text[])
       and (
         (home_club_id = any($3::text[]) and away_club_id = any($4::text[]))
         or (lower(home_team_name) = any($5::text[]) and lower(away_team_name) = any($6::text[]))
       )
     )
  order by kickoff_at nulls last, updated_at desc
`;

const BUNDLE_QUERY = `
  /* dfb:bundles */
  select m.match_id::text as match_id,
    m.weather_payload,
    to_jsonb(ms) as match_stats_row,
    coalesce(
      (
        select jsonb_agg(to_jsonb(tms) order by tms.side)
        from team_match_stats tms
        where tms.match_id = m.match_id
      ),
      '[]'::jsonb
    ) as team_match_stats_payload,
    (
      select jsonb_build_object(
        'samples', count(*),
        'avgHome', avg(home),
        'avgDraw', avg(draw),
        'avgAway', avg(away),
        'closingSamples', count(*) filter (where closing_home > 1),
        'avgClosingHome', avg(closing_home) filter (where closing_home > 1),
        'avgClosingDraw', avg(closing_draw) filter (where closing_draw > 1),
        'avgClosingAway', avg(closing_away) filter (where closing_away > 1)
      )
      from historical_odds_snapshots
      where match_id = m.match_id
        and odds_role in ('opening', 'prematch', 'closing')
        and captured_at is not null
    ) as historical_odds_payload,
    (
      select sr.payload
      from source_records sr
      where sr.entity_type = 'lineup'
        and sr.entity_key = m.match_id
        and coalesce(sr.source_timestamp, sr.fetched_at) <= m.kickoff_at
      order by (sr.payload->'lineupSummary'->>'confirmed')::boolean desc,
        coalesce(sr.source_timestamp, sr.fetched_at) desc
      limit 1
    ) as lineup_payload
  from matches m
  left join match_stats ms on ms.match_id = m.match_id
  where m.match_id = any($1::text[])
`;

const SEASON_QUERY = `
  /* dfb:season */
  select club_id::text as club_id, style_profile, xg_for, xg_against, matches_played, updated_at
  from team_season_stats
  where club_id = any($1::text[])
  order by updated_at desc
`;

const H2H_QUERY = `
  /* dfb:h2h */
  select *
  from h2h_edges
  where (least(home_club_id, away_club_id), greatest(home_club_id, away_club_id))
    in (select * from unnest($1::text[], $2::text[]))
  order by updated_at desc
`;

function sqlNameKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function pairKey(homeClubId, awayClubId) {
  return homeClubId < awayClubId ? `${homeClubId}|${awayClubId}` : `${awayClubId}|${homeClubId}`;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

export async function readDatabaseFeatureContextBatch(requests = [], options = {}) {
  const sql = options.sql || getSql();
  const list = (Array.isArray(requests) ? requests : []).filter((request) => request && request.matchId);
  if (!sql || !list.length) return new Map();

  const requestedClubIds = uniqueValues(list.flatMap((request) => [request.homeClubId, request.awayClubId]));
  const variantList = uniqueValues(
    list.flatMap((request) => [
      ...aliasVariants(request.homeTeamName),
      ...aliasVariants(request.awayTeamName),
    ])
  );

  const [clubRows, aliasRows, nameRows] = await Promise.all([
    requestedClubIds.length ? sql.query(CLUB_ID_QUERY, [requestedClubIds]) : [],
    variantList.length ? sql.query(CLUB_ALIAS_QUERY, [variantList]) : [],
    variantList.length ? sql.query(CLUB_NAME_QUERY, [variantList]) : [],
  ]);

  const knownClubIds = new Set((clubRows || []).map((row) => String(row.club_id)));
  const aliasByVariant = new Map();
  for (const row of aliasRows || []) {
    const alias = String(row.normalized_alias || "");
    if (alias && !aliasByVariant.has(alias)) aliasByVariant.set(alias, String(row.club_id));
  }
  const clubByName = new Map();
  for (const row of nameRows || []) {
    const key = sqlNameKey(row.name);
    if (key && !clubByName.has(key)) clubByName.set(key, { clubId: String(row.club_id), name: row.name });
  }

  // Zelfde prioriteit als resolveClubIdByAlias(): exacte ID, dan alias, dan naam.
  function resolveClub(providedId, teamName) {
    const id = providedId ? String(providedId) : null;
    if (id && knownClubIds.has(id)) return { clubId: id, source: "provided_id" };
    const variants = aliasVariants(teamName);
    for (const variant of variants) {
      const hit = aliasByVariant.get(variant);
      if (hit) return { clubId: hit, source: "club_aliases", matchedAlias: variant };
    }
    for (const variant of variants) {
      const hit = clubByName.get(variant);
      if (hit) return { clubId: hit.clubId, source: "club_name", matchedAlias: dbAliasKey(hit.name) };
    }
    return { clubId: id, source: "unresolved" };
  }

  const prepared = list.map((request) => {
    const homeResolution = resolveClub(request.homeClubId, request.homeTeamName);
    const awayResolution = resolveClub(request.awayClubId, request.awayTeamName);
    return {
      request,
      homeResolution,
      awayResolution,
      homeClubId: homeResolution.clubId,
      awayClubId: awayResolution.clubId,
      dateKey: request.dateKey || null,
      homeName: request.homeTeamName ? String(request.homeTeamName).toLowerCase() : null,
      awayName: request.awayTeamName ? String(request.awayTeamName).toLowerCase() : null,
    };
  });

  const matchIds = uniqueValues(prepared.map((item) => item.request.matchId));
  const dateKeys = uniqueValues(prepared.map((item) => item.dateKey));
  const clubIdList = uniqueValues(prepared.flatMap((item) => [item.homeClubId, item.awayClubId]));
  const nameList = uniqueValues(prepared.flatMap((item) => [item.homeName, item.awayName]));

  const matchRows = dateKeys.length
    ? await sql.query(MATCH_QUERY, [matchIds, dateKeys, clubIdList, clubIdList, nameList, nameList])
    : await sql.query(MATCH_QUERY, [matchIds, [], clubIdList, clubIdList, nameList, nameList]);

  const resolvedMatches = new Map();
  for (const item of prepared) {
    const wantedMatchId = String(item.request.matchId);
    let resolved = (matchRows || []).find((row) => String(row.match_id) === wantedMatchId);
    let source = "provided_match_id";
    if (!resolved && item.dateKey && item.homeClubId && item.awayClubId) {
      resolved = (matchRows || []).find(
        (row) =>
          String(row.date_key || "") === item.dateKey &&
          String(row.home_club_id || "") === item.homeClubId &&
          String(row.away_club_id || "") === item.awayClubId
      );
      source = "date_club_fixture";
    }
    if (!resolved && item.dateKey && item.homeName && item.awayName) {
      resolved = (matchRows || []).find(
        (row) =>
          String(row.date_key || "") === item.dateKey &&
          String(row.home_name || "") === item.homeName &&
          String(row.away_name || "") === item.awayName
      );
      source = "date_team_name_fixture";
    }
    resolvedMatches.set(item.request.matchId, resolved
      ? { matchId: String(resolved.match_id), source }
      : { matchId: null, source: "unresolved" });
  }

  const resolvedMatchIds = uniqueValues([...resolvedMatches.values()].map((resolution) => resolution.matchId));
  const seasonClubIds = uniqueValues(prepared.flatMap((item) => [item.homeClubId, item.awayClubId]));
  const h2hPairs = prepared.filter((item) => item.homeClubId && item.awayClubId);

  const [bundleRows, seasonRows, h2hRows] = await Promise.all([
    resolvedMatchIds.length ? sql.query(BUNDLE_QUERY, [resolvedMatchIds]) : [],
    seasonClubIds.length ? sql.query(SEASON_QUERY, [seasonClubIds]) : [],
    h2hPairs.length
      ? sql.query(H2H_QUERY, [h2hPairs.map((item) => item.homeClubId), h2hPairs.map((item) => item.awayClubId)])
      : [],
  ]);

  const bundleByMatchId = new Map((bundleRows || []).map((row) => [String(row.match_id), row]));
  const seasonByClubId = new Map();
  for (const row of seasonRows || []) {
    const key = String(row.club_id);
    if (!seasonByClubId.has(key)) seasonByClubId.set(key, []);
    seasonByClubId.get(key).push(row);
  }
  const h2hByPair = new Map();
  for (const row of h2hRows || []) {
    const key = pairKey(String(row.home_club_id), String(row.away_club_id));
    if (!h2hByPair.has(key)) h2hByPair.set(key, []);
    h2hByPair.get(key).push(row);
  }

  const contexts = new Map();
  for (const item of prepared) {
    const resolution = resolvedMatches.get(item.request.matchId);
    const bundle = resolution.matchId ? bundleByMatchId.get(resolution.matchId) || null : null;
    const statsRow = bundle?.match_stats_row || null;
    // De enkelvoudige variant beperkt team_season_stats tot vier rijen voor het
    // clubpaar; dat gedrag blijft gelijk door hier op updated_at te sorteren.
    const teamSeasonStyle = [item.homeClubId, item.awayClubId]
      .filter(Boolean)
      .flatMap((clubId) => seasonByClubId.get(clubId) || [])
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
      .slice(0, 4)
      .map((row) => ({
        club_id: row.club_id,
        style_profile: row.style_profile,
        xg_for: row.xg_for,
        xg_against: row.xg_against,
        matches_played: row.matches_played,
      }));
    const h2hCandidates = item.homeClubId && item.awayClubId
      ? (h2hByPair.get(pairKey(item.homeClubId, item.awayClubId)) || []).filter(
          (row) => !item.request.competitionId || String(row.competition_id || "") === String(item.request.competitionId)
        )
      : [];
    const lineupPayload = bundle?.lineup_payload || null;
    const matchedByAlias =
      item.homeResolution.source === "club_aliases" ||
      item.homeResolution.source === "club_name" ||
      item.awayResolution.source === "club_aliases" ||
      item.awayResolution.source === "club_name";

    contexts.set(item.request.matchId, {
      matchId: resolution.matchId || item.request.matchId,
      requestedMatchId: item.request.matchId || null,
      matchResolution: resolution,
      requestedHomeClubId: item.request.homeClubId || null,
      requestedAwayClubId: item.request.awayClubId || null,
      resolvedHomeClubId: item.homeClubId,
      resolvedAwayClubId: item.awayClubId,
      homeResolution: item.homeResolution,
      awayResolution: item.awayResolution,
      aliasMatched: matchedByAlias,
      dateKey: item.dateKey,
      matchStats: statsRow
        ? {
            homeXg: statsRow.home_xg,
            awayXg: statsRow.away_xg,
            homeShots: statsRow.home_shots,
            awayShots: statsRow.away_shots,
            homeCorners: statsRow.home_corners,
            awayCorners: statsRow.away_corners,
            statsSource: statsRow.stats_source,
          }
        : {},
      teamMatchStats: bundle?.team_match_stats_payload || [],
      historicalOdds: bundle?.historical_odds_payload || null,
      weather: bundle?.weather_payload || null,
      teamSeasonStyle,
      h2hEdge: h2hCandidates[0] || null,
      lineupSummary: lineupPayload?.lineupSummary || null,
      lineupSource: lineupPayload?.provider || lineupPayload?.lineupSummary?.source || null,
      lineupCapturedAt: lineupPayload?.capturedAt || null,
      featureSources: [
        statsRow?.stats_source ? "match_stats" : null,
        bundle?.team_match_stats_payload?.length ? "team_match_stats" : null,
        bundle?.historical_odds_payload?.samples ? "historical_odds_snapshots" : null,
        teamSeasonStyle.length ? "team_season_stats" : null,
        h2hCandidates.length ? "h2h_edges" : null,
        lineupPayload?.lineupSummary ? "source_records.lineup" : null,
      ].filter(Boolean),
    });
  }

  return contexts;
}
