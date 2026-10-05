# Neon Storage Strategy

Doel: Neon onder de gratis 512 MB projectlimiet houden zonder voorspellingen, fixtures, H2H, oddsstatus of bronlineage kwijt te raken.

## Huidige policy

- Neon is de hot database voor genormaliseerde data: wedstrijden, voorspellingen, evaluaties, H2H, oddsstatus, teamstats en bronlineage.
- Ruwe `source_records.payload` is tijdelijk debugmateriaal. Na **3 dagen** wordt alleen de raw payload gecompact naar `{}`; provider, URL, entity key, content hash, trust score en timestamps blijven bestaan. Payloads worden pas na bevestigde R2-upload gecompacteerd.
- Prediction snapshots worden per wedstrijd beperkt. De nieuwste snapshots, geëvalueerde snapshots, snapshots met odds en top exact/confidence picks blijven bewaard.
- R2 snapshots staan per UTC-maand in content-addressed `prediction-snapshots/year=YYYY/month=MM/` objecten. Een klein manifest verwijst naar maandshards; oudere maanden worden nooit vervangen door een nieuwe maand. Hashchecks en upload-voor-manifest volgorde beschermen tegen incomplete writes.
- De actieve R2-ledger migreert bestaande `active/ledger.json.gz`-data bij de eerste succesvolle schrijfbeurt naar deze maandshards. De migration vereist dat de bestaande ledger compleet leesbaar is; bestaande historie wordt niet verwijderd.
- `db:neon-storage:maintain` voert eerst de storage-analyse uit, archiveert daarna snapshots/payloads en stopt bij de eerste mislukte stap vóór verdere compaction.

## Drempels

- Onder 80%: normaal bewaren.
- Vanaf 80%: pressure mode, korte cache-retentie en strengere backup-retentie.
- Vanaf 95%: niet-destructieve R2-archivering loopt eerst; na archiefbevestiging mag maintenance compacte data opschonen. Zonder werkende Neon-verbinding kan cleanup niet op afstand worden geforceerd.

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

De code ondersteunt Cloudflare R2 via de S3-compatible API. Als R2 niet geconfigureerd is, stopt de cold-storageketen veilig zonder oude payloads/snapshots te compacteren. Als R2 wel beschikbaar is, worden oude `source_records.payload` records eerst als `json.gz` naar een uniek archief geschreven; pas na bevestigde upload wordt Neon gecompact.

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
