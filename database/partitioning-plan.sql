-- Execute only after partition_migration_registry marks a table migration_recommended.
-- Safe method: create shadow partitioned table, enable dual writes, backfill in batches, validate, then swap.
-- Never convert a live table directly because foreign keys and primary keys require coordinated migration.

-- Example template for historical_odds_snapshots:
-- create table historical_odds_snapshots_partitioned (like historical_odds_snapshots including defaults including constraints)
-- partition by range (captured_at);
-- create table historical_odds_snapshots_2026_06 partition of historical_odds_snapshots_partitioned
-- for values from ('2026-06-01') to ('2026-07-01');
