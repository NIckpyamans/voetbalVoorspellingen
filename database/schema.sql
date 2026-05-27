-- FootyAI prediction storage schema
-- Purpose: reconstruct, evaluate and train from immutable pre-match prediction snapshots.

create table if not exists matches (
  match_id text primary key,
  source_match_id text,
  data_source text,
  league text,
  season text,
  kickoff_at timestamptz,
  home_team_id text,
  away_team_id text,
  home_team_name text not null,
  away_team_name text not null,
  team_identity jsonb not null default '{}'::jsonb,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
create index if not exists idx_prediction_snapshots_match_generated on prediction_snapshots(match_id, generated_at desc);
create index if not exists idx_prediction_snapshots_model_generated on prediction_snapshots(model_version, generated_at desc);
create index if not exists idx_prediction_evaluations_evaluated on prediction_evaluations(evaluated_at desc);
create index if not exists idx_prediction_evaluations_match on prediction_evaluations(match_id);
create index if not exists idx_odds_snapshots_prediction on odds_snapshots(prediction_id);
create index if not exists idx_source_audit_prediction_field on source_audit(prediction_id, field_name);
