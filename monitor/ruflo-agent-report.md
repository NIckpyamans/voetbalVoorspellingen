# Ruflo-style AI monitor

Datum: 2026-05-04

Ruflo draait als extra agentlaag naast de app: hij leest monitor/data/reviews, zoekt gratis oplossingen en maakt patchadvies zonder blind live te wijzigen.

## Agents
- Data: Datalaag: H2H 50%, bookmakers 100%, refs 0%.
- Leren: Leerlaag: 270 reviews, exact 12%, winnaar/gelijk 46%, top-5 exact 4%.
- Controle: Ontwikkelcontrole: 0 actieve monitorissues op 2026-05-04; digest 2026-04-21 t/m 2026-05-04.

## Gratis acties
1. [high] Top-5 exact-score selectie herwegen (learning) - Geef exact-score selectie meer gewicht aan bronkwaliteit, lage goal-error competities en modelagreement; verlaag pure confidence-only weging.
2. [high] Faalsignaal aanpakken: low_model_agreement (learning) - Laat dit signaal terugkomen als penalty in confidence en als uitleg in de matchkaart.
3. [medium] H2H-backfill verder vullen (data) - Gebruik openfootball en football-data rows per competitie als historische H2H fallback voordat de UI 'leeg' toont.
4. [medium] Outcome learning zwaarder laten meewegen (learning) - Gebruik teamLearning-bias alleen bij teams met genoeg reviews en temper hem bij interlands/friendlies.
5. [low] Scheidsrechter-cache slimmer matchen (data) - Combineer referee-naamaliases per land/competitie en laat korte achternaam + initialen fallback meetellen met lagere confidence.

## Guardrails
- Geen betaalde API key verplicht maken.
- Geen externe AI blind laten pushen naar productie.
- Scraping alleen via cache/snapshots en met fallback, zodat de app niet breekt bij rate limits.
- GitHub/Vercel meldingen blijven buiten de app; rapporten worden lokaal in monitor opgeslagen.
