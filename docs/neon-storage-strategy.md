# Neon Storage Strategy

Doel: Neon onder de gratis 512 MB projectlimiet houden zonder voorspellingen, fixtures, H2H, oddsstatus of bronlineage kwijt te raken.

## Huidige policy

- Neon is de hot database voor genormaliseerde data: wedstrijden, voorspellingen, evaluaties, H2H, oddsstatus, teamstats en bronlineage.
- Ruwe `source_records.payload` is tijdelijk debugmateriaal. Na 7 dagen wordt alleen de raw payload gecompact naar `{}`; provider, URL, entity key, content hash, trust score en timestamps blijven bestaan.
- Prediction snapshots worden per wedstrijd beperkt. De nieuwste snapshots, geevalueerde snapshots, snapshots met odds en top exact/confidence picks blijven bewaard.
- `db:neon-storage:maintain` draait de volledige onderhoudsketen: cache cleanup, snapshot compaction, source payload compaction en een nameting.

## Drempels

- Onder 80%: normaal bewaren.
- Vanaf 80%: pressure mode, korte cache-retentie en strengere backup-retentie.
- Vanaf 95%: maintenance mag falen zodat GitHub Actions direct waarschuwt.

## Volgende schaalstap

Verplaats cold raw payloads en grote exportbestanden naar object storage:

- Cloudflare R2: beste gratis cold-storage kandidaat door ruime free tier en lage egresskosten.
- Vercel Blob: technisch passend bij Vercel, vooral handig voor exports die de frontend direct kan ophalen.
- GitHub Releases/artifacts: alleen geschikt voor incidentele snapshots, niet voor dagelijkse muterende data.

Neon bewaart dan alleen:

- `object_storage_url`
- `content_hash`
- `payload_bytes`
- `provider`
- `entity_type`
- `entity_key`
- `fetched_at`

## Cloudflare R2 configuratie

De code ondersteunt Cloudflare R2 via de S3-compatible API. Als de secrets ontbreken, blijft de maintenance veilig werken zonder R2 en worden oude payloads direct in Neon gecompact. Als de secrets aanwezig zijn, worden oude `source_records.payload` records eerst als `json.gz` naar R2 geschreven en daarna in Neon leeg gemaakt.

R2 wordt nu gebruikt voor:

- Oude raw `source_records.payload` archieven.
- Repo/server exports zoals `server_data.json`, `data/meta.json` en `data/standings.json`.
- Oude, niet-essentiele prediction snapshots voordat ze uit Neon worden verwijderd.
- Dashboard day-cache voor recente dagen, zodat Vercel API-routes later uit R2 kunnen lezen wanneer de R2-envs ook in Vercel staan.

Benodigde GitHub Actions secrets:

- `CLOUDFLARE_R2_ACCOUNT_ID`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- `CLOUDFLARE_R2_BUCKET`

Optionele GitHub Actions secret:

- `CLOUDFLARE_R2_PREFIX`, standaard `voetbalvoorspellingen/raw`

Voor Vercel API-cache lezen zijn dezelfde R2-envs in Vercel nodig plus:

- `DASHBOARD_R2_CACHE_ENABLED=true`

Cloudflare Web Analytics is apart van R2. Als `VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN` in Vercel staat, laadt de frontend automatisch Cloudflare Web Analytics. Dit vergroot Neon/R2-verbruik niet en is alleen bedoeld voor lichte bezoekers- en performance-inzichten.

Aanbevolen R2 bucket:

- Naam: `voetbalvoorspellingen-cold-storage`
- Public access: uit
- Lifecycle rule: bewaar raw archives bijvoorbeeld 90 tot 180 dagen, daarna verwijderen of naar goedkopere cold policy verplaatsen wanneer beschikbaar.

Cloudflare dashboardroute:

1. Ga naar `Storage & databases`.
2. Open `R2 Object Storage`.
3. Maak een bucket aan.
4. Maak een R2 API token/access key met alleen toegang tot deze bucket.
5. Zet de waarden als GitHub Actions secrets en, alleen als Vercel functies dit direct moeten gebruiken, ook als Vercel environment variables.

## Niet doen

- Geen grote JSON exports opnieuw in Git committen.
- Geen raw providerpayloads permanent in Neon houden als de data al is genormaliseerd.
- Geen CLV/ROI publiceren op historische oddsprofielen; daarvoor blijven echte prematch en closing timestamps nodig.
