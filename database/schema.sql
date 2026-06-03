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

create table if not exists clubs (
  club_id text primary key,
  name text not null,
  country_id text references countries(country_id),
  country_name text,
  stadium text,
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

create table if not exists matches (
  match_id text primary key,
  source_match_id text,
  data_source text,
  competition_id text references competitions(competition_id),
  season_id text references seasons(season_id),
  league text,
  season text,
  kickoff_at timestamptz,
  home_club_id text references clubs(club_id),
  away_club_id text references clubs(club_id),
  home_team_id text,
  away_team_id text,
  home_team_name text not null,
  away_team_name text not null,
  team_identity jsonb not null default '{}'::jsonb,
  status text,
  status_normalized text,
  neutral_venue boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
alter table matches add column if not exists season_id text references seasons(season_id);
alter table matches add column if not exists home_club_id text references clubs(club_id);
alter table matches add column if not exists away_club_id text references clubs(club_id);
alter table matches add column if not exists status_normalized text;
alter table matches add column if not exists neutral_venue boolean not null default false;

create table if not exists prediction_snapshots (
  prediction_id text primary key,
  match_id text not null references matches(match_id),
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
  status text not null default 'missing',
  missing_reason text,
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

create index if not exists idx_matches_kickoff on matches(kickoff_at);
create index if not exists idx_matches_competition_season on matches(competition_id, season_id);
create index if not exists idx_club_aliases_normalized on club_aliases(normalized_alias);
create index if not exists idx_source_records_entity on source_records(entity_type, entity_key, fetched_at desc);
create index if not exists idx_standings_snapshots_season on standings_snapshots(season_id, captured_at desc);
create index if not exists idx_team_season_stats_season_club on team_season_stats(season_id, club_id);
create index if not exists idx_prediction_snapshots_match_generated on prediction_snapshots(match_id, generated_at desc);
create index if not exists idx_prediction_snapshots_model_generated on prediction_snapshots(model_version, generated_at desc);
create index if not exists idx_prediction_evaluations_evaluated on prediction_evaluations(evaluated_at desc);
create index if not exists idx_prediction_evaluations_match on prediction_evaluations(match_id);
create index if not exists idx_odds_snapshots_prediction on odds_snapshots(prediction_id);
create index if not exists idx_source_audit_prediction_field on source_audit(prediction_id, field_name);
