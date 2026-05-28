# Database readiness

`schema.sql` bevat de Postgres-tabellen voor matches, prediction snapshots, odds snapshots, uitslagen, evaluaties en source-audit.

## Zonder database credentials

De app blijft werken met JSON/JSONL-bestanden. Draai:

```bash
npm run readiness
```

Daarmee zie je of het schema bestaat, of er al een database URL is gezet, hoeveel trainingsrijen beschikbaar zijn en of de Tailwind CDN is vervangen.

## Met Postgres of Supabase

Zet een van deze environment variables:

```bash
DATABASE_URL=
POSTGRES_URL=
SUPABASE_DB_URL=
```

Voer daarna uit:

```bash
npm run db:schema:apply
```

De helper gebruikt lokaal `psql` en stopt bewust als er geen databaseverbinding bestaat. Er worden geen credentials gelogd.
