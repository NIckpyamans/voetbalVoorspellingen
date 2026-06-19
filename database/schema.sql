-- FootyAI prediction storage schema
-- Purpose: reconstruct, evaluate and train from immutable pre-match prediction snapshots.

create table if not exists countries (
  country_id text primary key,
  name text not null,
  fifa_code text,
  region text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists competitions (
  competition_id text primary key,
  name text not null,
  country_id text references countries(country_id),
  country_name text,
  level integer,
  competition_type text not null default 'league',
  provider_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists competition_seasons (
  season_id text primary key,
  competition_id text references competitions(competition_id),
  year_label text not null,
  start_date date,
  end_date date,
  status text not null default 'planned',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists seasons (
  season_id text primary key,
  competition_id text references competitions(competition_id),
  year_label text not null,
  start_date date,
  end_date date,
  status text not null default 'planned',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists venues (
  venue_id text primary key,
  name text not null,
  city text,
  country_id text references countries(country_id),
  capacity integer,
  latitude numeric,
  longitude numeric,
  provider_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists clubs (
  club_id text primary key,
  name text not null,
  country_id text references countries(country_id),
  country_name text,
  stadium text,
  venue_id text references venues(venue_id),
  founded_year integer,
  provider_ids jsonb not null default '{}'::jsonb,
  history jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists club_aliases (
  alias_id bigserial primary key,
  club_id text not null references clubs(club_id),
  alias text not null,
  normalized_alias text not null,
  source text,
  created_at timestamptz not null default now(),
  unique (club_id, normalized_alias)
);

create table if not exists competition_season_clubs (
  season_id text not null references seasons(season_id),
  competition_id text not null references competitions(competition_id),
  club_id text not null references clubs(club_id),
  club_name text not null,
  status text not null default 'active',
  entry_reason text,
  previous_season_id text references seasons(season_id),
  previous_level integer,
  previous_standing_position integer,
  previous_standing_points integer,
  previous_standing_source text,
  current_level integer,
  source text,
  source_record_id text references source_records(source_record_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (season_id, club_id)
);

create table if not exists source_records (
  source_record_id text primary key,
  provider text not null,
  source_url text,
  entity_type text not null,
  entity_key text,
  fetched_at timestamptz not null default now(),
  source_timestamp timestamptz,
  content_hash text,
  trust_score numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists provider_trust_profiles (
  provider text primary key,
  base_trust_score numeric not null default 0.5,
  effective_trust_score numeric not null default 0.5,
  records_count integer not null default 0,
  timestamp_coverage numeric not null default 0,
  conflict_rate numeric not null default 0,
  resolution_win_rate numeric not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists provider_trust_history (
  provider_trust_history_id bigserial primary key,
  provider text not null,
  captured_at timestamptz not null default now(),
  effective_trust_score numeric not null,
  result_accuracy numeric,
  settled_records integer not null default 0,
  conflict_rate numeric,
  timestamp_coverage numeric,
  metrics jsonb not null default '{}'::jsonb
);

create table if not exists provider_field_trust_profiles (
  provider text not null,
  field_name text not null,
  effective_trust_score numeric not null default 0.5,
  raw_accuracy numeric,
  bayesian_accuracy numeric,
  wilson_lower_bound numeric,
  samples integer not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (provider, field_name)
);

create table if not exists provider_field_controls (
  provider text not null,
  field_name text not null,
  status text not null default 'active',
  reason text,
  consecutive_low_scores integer not null default 0,
  disabled_at timestamptz,
  trial_started_at timestamptz,
  trial_runs integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (provider, field_name)
);
alter table provider_field_controls add column if not exists trial_started_at timestamptz;
alter table provider_field_controls add column if not exists trial_runs integer not null default 0;

create table if not exists provider_competition_field_trust (
  provider text not null,
  competition_id text not null,
  field_name text not null,
  effective_trust_score numeric not null,
  samples integer not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(provider,competition_id,field_name)
);

create table if not exists club_merge_audit (
  club_merge_audit_id bigserial primary key,
  canonical_club_id text not null,
  merged_club_ids jsonb not null default '[]'::jsonb,
  canonical_snapshot jsonb not null default '{}'::jsonb,
  merged_club_snapshots jsonb not null default '[]'::jsonb,
  reference_counts jsonb not null default '{}'::jsonb,
  reference_snapshot jsonb not null default '{}'::jsonb,
  merge_reason text not null,
  merge_status text not null default 'applied',
  merged_at timestamptz not null default now(),
  rollback_status text not null default 'not_rolled_back',
  rollback_reason text,
  rolled_back_at timestamptz
);
alter table club_merge_audit add column if not exists reference_snapshot jsonb not null default '{}'::jsonb;

create table if not exists source_conflicts (
  source_conflict_id text primary key,
  entity_type text not null,
  entity_key text not null,
  field_name text not null,
  candidate_values jsonb not null default '[]'::jsonb,
  selected_source_record_id text references source_records(source_record_id),
  selected_value jsonb,
  resolution_method text,
  status text not null default 'pending',
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_key, field_name)
);

create table if not exists source_conflict_repairs (
  source_conflict_repair_id bigserial primary key,
  source_conflict_id text not null references source_conflicts(source_conflict_id),
  entity_key text not null,
  field_name text not null,
  previous_value jsonb,
  applied_value jsonb,
  source_record_id text references source_records(source_record_id),
  source_trust_score numeric,
  repair_status text not null,
  repair_reason text,
  repaired_at timestamptz not null default now(),
  rollback_status text not null default 'not_rolled_back',
  rollback_reason text,
  rolled_back_at timestamptz
);
alter table source_conflict_repairs add column if not exists rollback_status text not null default 'not_rolled_back';
alter table source_conflict_repairs add column if not exists rollback_reason text;
alter table source_conflict_repairs add column if not exists rolled_back_at timestamptz;

create table if not exists quality_alerts (
  alert_id text primary key,
  alert_type text not null,
  dimension_key text not null,
  severity text not null,
  status text not null default 'open',
  current_value numeric,
  previous_value numeric,
  delta numeric,
  threshold numeric,
  message text not null,
  evidence jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table quality_alerts drop constraint if exists quality_alerts_alert_type_dimension_key_status_key;

create table if not exists integrity_metric_snapshots (
  integrity_metric_snapshot_id bigserial primary key,
  captured_at timestamptz not null default now(),
  metric_key text not null,
  metric_value numeric not null,
  dimension_key text not null default 'global',
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists app_state_segments (
  segment_group text not null,
  segment_key text not null,
  payload jsonb not null default '{}'::jsonb,
  payload_bytes integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (segment_group, segment_key)
);

create table if not exists partition_migration_registry (
  table_name text primary key,
  partition_column text not null,
  partition_strategy text not null,
  recommended_interval text not null,
  current_rows bigint not null default 0,
  activate_after_rows bigint not null,
  migration_status text not null default 'planned',
  readiness jsonb not null default '{}'::jsonb,
  assessed_at timestamptz not null default now()
);

create table if not exists matches (
  match_id text primary key,
  canonical_fixture_id text,
  source_match_id text,
  data_source text,
  competition_id text references competitions(competition_id),
  season_id text references seasons(season_id),
  league text,
  season text,
  kickoff_at timestamptz,
  home_club_id text references clubs(club_id),
  away_club_id text references clubs(club_id),
  venue_id text references venues(venue_id),
  home_team_id text,
  away_team_id text,
  home_team_name text not null,
  away_team_name text not null,
  team_identity jsonb not null default '{}'::jsonb,
  status text,
  status_normalized text,
  identity_status text not null default 'resolved',
  identity_missing_fields jsonb not null default '[]'::jsonb,
  quarantined_at timestamptz,
  primary_source_record_id text references source_records(source_record_id),
  neutral_venue boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists match_identity_quarantine (
  quarantine_id text primary key,
  match_id text not null unique references matches(match_id),
  missing_fields jsonb not null default '[]'::jsonb,
  reason text not null default 'incomplete_match_identity',
  status text not null default 'pending',
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  quarantined_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists match_source_records (
  match_source_record_id text primary key,
  match_id text not null references matches(match_id),
  source_record_id text not null references source_records(source_record_id),
  provider text not null,
  source_match_id text,
  is_primary boolean not null default false,
  trust_score numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, source_record_id)
);

create table if not exists fixture_source_aliases (
  fixture_source_alias_id text primary key,
  canonical_fixture_id text not null,
  canonical_match_id text not null references matches(match_id),
  source_match_id text not null,
  provider text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, source_match_id)
);

create table if not exists match_stats (
  match_id text primary key references matches(match_id),
  halftime_home_goals integer,
  halftime_away_goals integer,
  home_xg numeric,
  away_xg numeric,
  home_shots integer,
  away_shots integer,
  home_shots_on_target integer,
  away_shots_on_target integer,
  home_corners integer,
  away_corners integer,
  home_yellow_cards integer,
  away_yellow_cards integer,
  home_red_cards integer,
  away_red_cards integer,
  home_possession numeric,
  away_possession numeric,
  stats_source text,
  source_record_id text references source_records(source_record_id),
  updated_at timestamptz not null default now()
);

create table if not exists team_match_stats (
  team_match_stats_id text primary key,
  match_id text not null references matches(match_id),
  club_id text references clubs(club_id),
  side text not null check (side in ('home', 'away')),
  goals integer,
  halftime_goals integer,
  xg numeric,
  shots integer,
  shots_on_target integer,
  corners integer,
  yellow_cards integer,
  red_cards integer,
  possession numeric,
  passes integer,
  tackles integer,
  offsides integer,
  stats_source text,
  source_record_id text references source_records(source_record_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, side)
);

create table if not exists standings_snapshots (
  standings_snapshot_id text primary key,
  competition_id text references competitions(competition_id),
  season_id text references seasons(season_id),
  captured_at timestamptz not null,
  source text,
  source_record_id text references source_records(source_record_id),
  standings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists team_season_stats (
  team_season_stats_id text primary key,
  season_id text references seasons(season_id),
  club_id text references clubs(club_id),
  matches_played integer,
  goals_for integer,
  goals_against integer,
  xg_for numeric,
  xg_against numeric,
  home_form jsonb not null default '{}'::jsonb,
  away_form jsonb not null default '{}'::jsonb,
  source_record_id text references source_records(source_record_id),
  updated_at timestamptz not null default now()
);

create table if not exists h2h_edges (
  h2h_edge_id text primary key,
  home_club_id text references clubs(club_id),
  away_club_id text references clubs(club_id),
  competition_id text references competitions(competition_id),
  played integer not null default 0,
  home_wins integer not null default 0,
  draws integer not null default 0,
  away_wins integer not null default 0,
  weighted_recent_balance numeric,
  results jsonb not null default '[]'::jsonb,
  source_record_id text references source_records(source_record_id),
  updated_at timestamptz not null default now(),
  unique (home_club_id, away_club_id, competition_id)
);

create table if not exists players (
  player_id text primary key,
  club_id text references clubs(club_id),
  name text not null,
  country_id text references countries(country_id),
  date_of_birth date,
  position text,
  preferred_foot text,
  market_value numeric,
  provider_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists squads (
  squad_id text primary key,
  season_id text references seasons(season_id),
  club_id text references clubs(club_id),
  player_id text references players(player_id),
  shirt_number integer,
  role text,
  start_date date,
  end_date date,
  source_record_id text references source_records(source_record_id),
  created_at timestamptz not null default now(),
  unique (season_id, club_id, player_id)
);

create table if not exists injuries (
  injury_id text primary key,
  player_id text references players(player_id),
  club_id text references clubs(club_id),
  match_id text references matches(match_id),
  injury_type text,
  status text not null default 'unknown',
  start_date date,
  expected_return_date date,
  source_record_id text references source_records(source_record_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists suspensions (
  suspension_id text primary key,
  player_id text references players(player_id),
  club_id text references clubs(club_id),
  competition_id text references competitions(competition_id),
  match_id text references matches(match_id),
  reason text,
  matches_remaining integer,
  start_date date,
  end_date date,
  source_record_id text references source_records(source_record_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists season_archives (
  season_archive_id text primary key,
  season_id text not null references seasons(season_id),
  archived_at timestamptz not null default now(),
  status text not null default 'archived',
  standings_snapshot_id text references standings_snapshots(standings_snapshot_id),
  prediction_count integer not null default 0,
  match_count integer not null default 0,
  archive_payload jsonb not null default '{}'::jsonb
);

alter table matches add column if not exists competition_id text references competitions(competition_id);
alter table matches add column if not exists canonical_fixture_id text;
alter table matches add column if not exists season_id text references seasons(season_id);
alter table matches add column if not exists home_club_id text references clubs(club_id);
alter table matches add column if not exists away_club_id text references clubs(club_id);
alter table matches add column if not exists venue_id text references venues(venue_id);
alter table matches add column if not exists status_normalized text;
alter table matches add column if not exists neutral_venue boolean not null default false;
alter table matches add column if not exists date_key text;
alter table matches add column if not exists raw_payload jsonb not null default '{}'::jsonb;
alter table clubs add column if not exists venue_id text references venues(venue_id);

create table if not exists prediction_snapshots (
  prediction_id text primary key,
  match_id text not null references matches(match_id),
  model_version_id text,
  generated_at timestamptz not null,
  cutoff_at timestamptz not null,
  model_version text,
  feature_schema_version text,
  algorithm_version text,
  input_snapshot_hash text,
  input_snapshot jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  probabilities jsonb not null default '{}'::jsonb,
  confidence numeric,
  confidence_raw numeric,
  calibration jsonb not null default '{}'::jsonb,
  expected_score jsonb not null default '{}'::jsonb,
  explanation jsonb not null default '{}'::jsonb,
  data_completeness jsonb not null default '{}'::jsonb,
  feature_source_metadata jsonb not null default '{}'::jsonb,
  leakage_guard jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint prediction_cutoff_before_generated_check check (cutoff_at <= generated_at),
  constraint prediction_generated_has_time_check check (generated_at is not null)
);

create table if not exists odds_snapshots (
  odds_snapshot_id text primary key,
  prediction_id text not null references prediction_snapshots(prediction_id),
  provider text not null,
  bookmaker text,
  market text not null default '1X2',
  home numeric,
  draw numeric,
  away numeric,
  captured_at timestamptz,
  closing_home numeric,
  closing_draw numeric,
  closing_away numeric,
  closing_captured_at timestamptz,
  odds_role text not null default 'unknown',
  available_before_kickoff boolean not null default false,
  minutes_before_kickoff integer,
  status text not null default 'missing',
  missing_reason text,
  created_at timestamptz not null default now()
);

create table if not exists historical_odds_snapshots (
  historical_odds_snapshot_id text primary key,
  match_id text not null references matches(match_id),
  provider text not null,
  bookmaker text,
  market text not null default '1X2',
  home numeric,
  draw numeric,
  away numeric,
  closing_home numeric,
  closing_draw numeric,
  closing_away numeric,
  captured_at timestamptz,
  closing_captured_at timestamptz,
  odds_role text not null default 'unknown',
  available_before_kickoff boolean not null default false,
  minutes_before_kickoff integer,
  source_record_id text references source_records(source_record_id),
  created_at timestamptz not null default now()
);

create table if not exists match_results (
  match_id text primary key references matches(match_id),
  final_home_goals integer,
  final_away_goals integer,
  actual_outcome text,
  result_source text,
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists prediction_evaluations (
  prediction_id text primary key references prediction_snapshots(prediction_id),
  match_id text not null references matches(match_id),
  exact_hit boolean,
  outcome_hit boolean,
  probability_outcome_hit boolean,
  brier_score numeric,
  log_loss numeric,
  roi numeric,
  roi_status text,
  clv numeric,
  clv_status text,
  evaluation_source text not null default 'prediction_snapshot',
  evaluated_at timestamptz not null default now()
);

create table if not exists model_versions (
  model_version_id text primary key,
  name text not null,
  model_type text not null default 'ensemble',
  feature_schema_version text,
  algorithm_version text,
  training_started_at timestamptz,
  training_completed_at timestamptz,
  training_rows integer,
  snapshot_backed_rows integer,
  parameters jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  status text not null default 'candidate',
  created_at timestamptz not null default now()
);

create table if not exists calibration_profiles (
  calibration_profile_id text primary key,
  model_version_id text references model_versions(model_version_id),
  competition_id text references competitions(competition_id),
  phase_bucket text,
  sample_size integer not null default 0,
  brier_score numeric,
  log_loss numeric,
  average_absolute_error numeric,
  confidence_bias numeric,
  probability_shrinkage numeric,
  profile jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now()
);

create table if not exists shadow_prediction_evaluations (
  shadow_evaluation_id text primary key,
  calibration_profile_id text not null references calibration_profiles(calibration_profile_id),
  prediction_id text not null references prediction_snapshots(prediction_id),
  match_id text not null references matches(match_id),
  competition_id text references competitions(competition_id),
  current_brier numeric not null,
  shadow_brier numeric not null,
  current_outcome_hit boolean not null,
  shadow_outcome_hit boolean not null,
  shadow_probabilities jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now(),
  unique(calibration_profile_id, prediction_id)
);

create table if not exists encrypted_database_backups (
  backup_id text primary key,
  backup_type text not null,
  algorithm text not null,
  key_reference text not null,
  iv text not null,
  auth_tag text not null,
  ciphertext text not null,
  record_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists coverage_repair_requests (
  request_id text primary key,
  competition_id text references competitions(competition_id),
  competition_label text,
  category text not null,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  attempts integer not null default 0,
  requested_by text,
  result_payload jsonb not null default '{}'::jsonb,
  last_error text
);

alter table prediction_snapshots add column if not exists model_version_id text;
alter table prediction_snapshots add column if not exists prediction_payload jsonb not null default '{}'::jsonb;
alter table matches add column if not exists weather_payload jsonb not null default '{}'::jsonb;
alter table matches add column if not exists source_coverage jsonb not null default '{}'::jsonb;
alter table matches add column if not exists identity_status text not null default 'resolved';
alter table matches add column if not exists identity_missing_fields jsonb not null default '[]'::jsonb;
alter table matches add column if not exists quarantined_at timestamptz;
alter table matches add column if not exists primary_source_record_id text references source_records(source_record_id);
alter table team_match_stats add column if not exists style_profile jsonb not null default '{}'::jsonb;
alter table team_season_stats add column if not exists style_profile jsonb not null default '{}'::jsonb;
alter table historical_odds_snapshots add column if not exists closing_captured_at timestamptz;
alter table historical_odds_snapshots add column if not exists odds_role text not null default 'unknown';
alter table historical_odds_snapshots add column if not exists available_before_kickoff boolean not null default false;
alter table historical_odds_snapshots add column if not exists minutes_before_kickoff integer;
alter table odds_snapshots add column if not exists odds_role text not null default 'unknown';
alter table odds_snapshots add column if not exists available_before_kickoff boolean not null default false;
alter table odds_snapshots add column if not exists minutes_before_kickoff integer;

create or replace function enforce_match_identity_status()
returns trigger language plpgsql as $$
begin
  new.identity_missing_fields :=
    (case when new.home_club_id is null then '["home_club_id"]'::jsonb else '[]'::jsonb end) ||
    (case when new.away_club_id is null then '["away_club_id"]'::jsonb else '[]'::jsonb end) ||
    (case when new.competition_id is null then '["competition_id"]'::jsonb else '[]'::jsonb end) ||
    (case when new.season_id is null then '["season_id"]'::jsonb else '[]'::jsonb end);
  new.identity_status := case when new.identity_missing_fields = '[]'::jsonb then 'resolved' else 'quarantined' end;
  new.quarantined_at := case
    when new.identity_status = 'resolved' then null
    else coalesce(new.quarantined_at, now())
  end;
  return new;
end;
$$;

drop trigger if exists match_identity_status_guard on matches;
create trigger match_identity_status_guard
before insert or update of home_club_id, away_club_id, competition_id, season_id on matches
for each row execute function enforce_match_identity_status();

create or replace function enforce_historical_odds_leakage_guard()
returns trigger language plpgsql as $$
declare kickoff timestamptz;
begin
  if new.odds_role not in ('unknown', 'prematch', 'closing_proxy', 'closing_timestamped', 'in_play') then
    raise exception 'Invalid odds_role: %', new.odds_role;
  end if;
  select kickoff_at into kickoff from matches where match_id = new.match_id;
  if new.available_before_kickoff then
    if new.odds_role <> 'prematch' or new.captured_at is null or kickoff is null or new.captured_at >= kickoff then
      raise exception 'Leakage guard rejected historical odds marked available before kickoff';
    end if;
    new.minutes_before_kickoff := floor(extract(epoch from (kickoff - new.captured_at)) / 60);
  else
    new.minutes_before_kickoff := null;
  end if;
  return new;
end;
$$;

drop trigger if exists historical_odds_leakage_guard on historical_odds_snapshots;
create trigger historical_odds_leakage_guard
before insert or update on historical_odds_snapshots
for each row execute function enforce_historical_odds_leakage_guard();

create or replace function enforce_prediction_odds_leakage_guard()
returns trigger language plpgsql as $$
declare kickoff timestamptz;
begin
  if new.odds_role not in ('unknown', 'prematch', 'closing_proxy', 'closing_timestamped', 'in_play') then
    raise exception 'Invalid odds_role: %', new.odds_role;
  end if;
  select m.kickoff_at into kickoff
  from prediction_snapshots ps join matches m on m.match_id = ps.match_id
  where ps.prediction_id = new.prediction_id;
  if new.available_before_kickoff then
    if new.odds_role <> 'prematch' or new.captured_at is null or kickoff is null or new.captured_at >= kickoff then
      raise exception 'Leakage guard rejected prediction odds marked available before kickoff';
    end if;
    new.minutes_before_kickoff := floor(extract(epoch from (kickoff - new.captured_at)) / 60);
  else
    new.minutes_before_kickoff := null;
  end if;
  return new;
end;
$$;

drop trigger if exists prediction_odds_leakage_guard on odds_snapshots;
create trigger prediction_odds_leakage_guard
before insert or update on odds_snapshots
for each row execute function enforce_prediction_odds_leakage_guard();

create table if not exists source_audit (
  source_audit_id bigserial primary key,
  prediction_id text not null references prediction_snapshots(prediction_id),
  field_name text not null,
  available boolean not null default false,
  source text,
  as_of timestamptz,
  source_timestamp_known boolean not null default false,
  note text
);

create or replace function audit_prediction_snapshot_insert()
returns trigger language plpgsql as $$
begin
  insert into source_audit(prediction_id,field_name,available,source,as_of,source_timestamp_known,note)
  values
    (new.prediction_id,'prediction_payload',new.prediction_payload <> '{}'::jsonb,'prediction-engine',new.generated_at,true,'automatic-trigger-v1'),
    (new.prediction_id,'features',new.features <> '{}'::jsonb,'prediction-engine',new.generated_at,true,'automatic-trigger-v1'),
    (new.prediction_id,'probabilities',new.probabilities <> '{}'::jsonb,'prediction-engine',new.generated_at,true,'automatic-trigger-v1'),
    (new.prediction_id,'data_completeness',new.data_completeness <> '{}'::jsonb,'prediction-engine',new.generated_at,true,'automatic-trigger-v1'),
    (new.prediction_id,'source_metadata',new.feature_source_metadata <> '{}'::jsonb,'prediction-engine',new.generated_at,true,'automatic-trigger-v1');
  return new;
end;
$$;

drop trigger if exists prediction_snapshot_source_audit on prediction_snapshots;
create trigger prediction_snapshot_source_audit
after insert on prediction_snapshots
for each row execute function audit_prediction_snapshot_insert();

create index if not exists idx_matches_kickoff on matches(kickoff_at);
create index if not exists idx_matches_date_key on matches(date_key);
create index if not exists idx_matches_competition_season on matches(competition_id, season_id);
create index if not exists idx_matches_identity_status on matches(identity_status, date_key);
create index if not exists idx_matches_quarantine_pending on matches(updated_at) where identity_status = 'quarantined';
create unique index if not exists idx_matches_canonical_fixture_unique on matches(canonical_fixture_id) where canonical_fixture_id is not null;
create index if not exists idx_match_identity_quarantine_status on match_identity_quarantine(status, updated_at);
create index if not exists idx_match_source_records_match on match_source_records(match_id, is_primary desc);
create index if not exists idx_match_source_records_source on match_source_records(source_record_id);
create index if not exists idx_fixture_source_aliases_canonical on fixture_source_aliases(canonical_fixture_id, canonical_match_id);
create index if not exists idx_competition_seasons_competition_status on competition_seasons(competition_id, status);
create index if not exists idx_competition_season_clubs_competition on competition_season_clubs(competition_id, season_id);
create index if not exists idx_competition_season_clubs_status on competition_season_clubs(status, entry_reason);
alter table competition_season_clubs add column if not exists previous_standing_position integer;
alter table competition_season_clubs add column if not exists previous_standing_points integer;
alter table competition_season_clubs add column if not exists previous_standing_source text;
create index if not exists idx_club_aliases_normalized on club_aliases(normalized_alias);
create index if not exists idx_coverage_repair_requests_status on coverage_repair_requests(status, requested_at);
create index if not exists idx_venues_country_city on venues(country_id, city);
create index if not exists idx_source_records_entity on source_records(entity_type, entity_key, fetched_at desc);
create index if not exists idx_source_conflicts_status on source_conflicts(status, detected_at desc);
create index if not exists idx_source_conflict_repairs_conflict_date on source_conflict_repairs(source_conflict_id, repaired_at desc);
create index if not exists idx_provider_field_trust_field_score on provider_field_trust_profiles(field_name, effective_trust_score desc);
create index if not exists idx_provider_field_controls_status on provider_field_controls(status, updated_at desc);
create index if not exists idx_club_merge_audit_status on club_merge_audit(merge_status, merged_at desc);
create index if not exists idx_quality_alerts_status_detected on quality_alerts(status, detected_at desc);
create index if not exists idx_provider_trust_history_provider_date on provider_trust_history(provider, captured_at desc);
create index if not exists idx_integrity_metric_snapshots_key_date on integrity_metric_snapshots(metric_key, dimension_key, captured_at desc);
create index if not exists idx_app_state_segments_updated on app_state_segments(updated_at desc);
create index if not exists idx_standings_snapshots_season on standings_snapshots(season_id, captured_at desc);
create index if not exists idx_team_season_stats_season_club on team_season_stats(season_id, club_id);
create index if not exists idx_team_match_stats_match on team_match_stats(match_id);
create index if not exists idx_h2h_edges_clubs on h2h_edges(home_club_id, away_club_id);
create index if not exists idx_players_club_position on players(club_id, position);
create index if not exists idx_squads_season_club on squads(season_id, club_id);
create index if not exists idx_injuries_player_status on injuries(player_id, status);
create index if not exists idx_suspensions_player_dates on suspensions(player_id, start_date, end_date);
create index if not exists idx_prediction_snapshots_match_generated on prediction_snapshots(match_id, generated_at desc);
create index if not exists idx_prediction_snapshots_model_generated on prediction_snapshots(model_version, generated_at desc);
create index if not exists idx_prediction_snapshots_model_version_id on prediction_snapshots(model_version_id);
create index if not exists idx_prediction_evaluations_evaluated on prediction_evaluations(evaluated_at desc);
create index if not exists idx_prediction_evaluations_match on prediction_evaluations(match_id);
create index if not exists idx_odds_snapshots_prediction on odds_snapshots(prediction_id);
create index if not exists idx_odds_snapshots_prematch on odds_snapshots(prediction_id, captured_at desc) where available_before_kickoff = true and odds_role = 'prematch';
create index if not exists idx_historical_odds_match on historical_odds_snapshots(match_id);
create index if not exists idx_historical_odds_prematch on historical_odds_snapshots(match_id, captured_at desc) where available_before_kickoff = true and odds_role = 'prematch';
create index if not exists idx_calibration_profiles_model_competition on calibration_profiles(model_version_id, competition_id);
create index if not exists idx_shadow_prediction_competition_date on shadow_prediction_evaluations(competition_id, evaluated_at desc);
create index if not exists idx_encrypted_database_backups_type_date on encrypted_database_backups(backup_type, created_at desc);
create index if not exists idx_source_audit_prediction_field on source_audit(prediction_id, field_name);
