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

## Niet doen

- Geen grote JSON exports opnieuw in Git committen.
- Geen raw providerpayloads permanent in Neon houden als de data al is genormaliseerd.
- Geen CLV/ROI publiceren op historische oddsprofielen; daarvoor blijven echte prematch en closing timestamps nodig.
