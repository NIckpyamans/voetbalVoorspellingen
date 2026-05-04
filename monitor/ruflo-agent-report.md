# Ruflo-style AI monitor

Datum: 2026-05-05

Ruflo draait als extra agentlaag naast de app: hij leest monitor/data/reviews, zoekt gratis oplossingen en maakt patchadvies zonder blind live te wijzigen.

## Agents
- Data: Datalaag: H2H 0%, bookmakers 50%, refs 0%.
- Leren: Leerlaag: 277 reviews, exact 13%, winnaar/gelijk 47%, top-5 exact 8%.
- Controle: Ontwikkelcontrole: 1 actieve monitorissues op 2026-05-05; digest 2026-04-21 t/m 2026-05-04.

## Gratis acties
1. [high] Top-5 exact-score selectie herwegen (learning) - Geef exact-score selectie meer gewicht aan bronkwaliteit, lage goal-error competities en modelagreement; verlaag pure confidence-only weging.
2. [high] Faalsignaal aanpakken: low_model_agreement (learning) - Laat dit signaal terugkomen als penalty in confidence en als uitleg in de matchkaart.
3. [high] Reviewbranch klaarzetten, niet blind live (control) - Maak codex/review-20260505 alleen als patchvoorstel en merge pas na build + workercheck.
4. [medium] H2H-backfill verder vullen (data) - Gebruik openfootball en football-data rows per competitie als historische H2H fallback voordat de UI 'leeg' toont.
5. [medium] Bookmakerdekking vergroten zonder betaalde API (data) - Gebruik football-data bookmakerkolommen per competitie en bewaar consensus + per-bookmaker betrouwbaarheid in marketProfiles.
6. [medium] Outcome learning zwaarder laten meewegen (learning) - Gebruik teamLearning-bias alleen bij teams met genoeg reviews en temper hem bij interlands/friendlies.
7. [medium] Alle wedstrijden van vandaag hebben lege H2H-data. (control) - Vul H2H uit openfootball/football-data competitiebestanden voordat de UI leeg toont.
8. [low] Scheidsrechter-cache slimmer matchen (data) - Combineer referee-naamaliases per land/competitie en laat korte achternaam + initialen fallback meetellen met lagere confidence.

## Guardrails
- Geen betaalde API key verplicht maken.
- Geen externe AI blind laten pushen naar productie.
- Scraping alleen via cache/snapshots en met fallback, zodat de app niet breekt bij rate limits.
- GitHub/Vercel meldingen blijven buiten de app; rapporten worden lokaal in monitor opgeslagen.
