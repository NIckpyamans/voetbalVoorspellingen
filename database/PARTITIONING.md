# Database partitioning plan

Partitioning is prepared, but activates only after a table reaches its threshold in
`partition_migration_registry`.

## Strategy

| Table | Key | Interval | Activation threshold |
|---|---|---:|---:|
| `matches` | `kickoff_at` | yearly | 5,000,000 rows |
| `historical_odds_snapshots` | `captured_at` | monthly | 10,000,000 rows |
| `odds_snapshots` | `captured_at` | monthly | 5,000,000 rows |
| `prediction_snapshots` | `generated_at` | monthly | 5,000,000 rows |
| `source_audit` | `source_audit_id` | blocks of 5,000,000 | 10,000,000 rows |
| `integrity_metric_snapshots` | `captured_at` | yearly | 1,000,000 rows |

## Safe migration sequence

1. Create a shadow partitioned table with equivalent constraints and indexes.
2. Enable dual writes from the original table to the shadow table.
3. Backfill immutable historical ranges in scheduled batches.
4. Compare row counts, checksums, foreign-key coverage and query plans.
5. Pause writes briefly, copy the remaining delta and atomically swap table names.
6. Keep the original table read-only during a rollback window.

Directly converting live tables is intentionally avoided because primary keys and
foreign keys require coordinated migration.
