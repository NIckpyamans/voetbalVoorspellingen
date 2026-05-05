# Ruflo-style AI monitor

Datum: 2026-05-06

Ruflo draait als extra agentlaag naast de app: hij leest monitor/data/reviews, zoekt gratis oplossingen en maakt patchadvies zonder blind live te wijzigen.

## Agents
- Data: Datalaag: H2H 100%, bookmakers 0%, refs 0%.
- Leren: Leerlaag: 278 reviews, exact 11%, winnaar/gelijk 45%, top-5 exact 4%.
- Controle: Ontwikkelcontrole: 1 actieve monitorissues op 2026-05-06; digest 2026-04-21 t/m 2026-05-04.

## Gratis acties
1. [high] Top-5 exact-score selectie herwegen (learning) - Geef exact-score selectie meer gewicht aan bronkwaliteit, lage goal-error competities en modelagreement; verlaag pure confidence-only weging.
2. [high] Faalsignaal aanpakken: low_model_agreement (learning) - Laat dit signaal terugkomen als penalty in confidence en als uitleg in de matchkaart.
3. [high] Reviewbranch klaarzetten, niet blind live (control) - Maak codex/review-20260506 alleen als patchvoorstel en merge pas na build + workercheck.
4. [medium] Bookmakerdekking vergroten zonder betaalde API (data) - Gebruik football-data bookmakerkolommen per competitie en bewaar consensus + per-bookmaker betrouwbaarheid in marketProfiles.
5. [medium] Outcome learning zwaarder laten meewegen (learning) - Gebruik teamLearning-bias alleen bij teams met genoeg reviews en temper hem bij interlands/friendlies.
6. [medium] Alle wedstrijden missen bookmaker-signalen in de marktcalibratie. (control) - Gebruik gratis football-data odds-kolommen als per-bookmaker closing proxy.
7. [low] Scheidsrechter-cache slimmer matchen (data) - Combineer referee-naamaliases per land/competitie en laat korte achternaam + initialen fallback meetellen met lagere confidence.

## Guardrails
- Geen betaalde API key verplicht maken.
- Geen externe AI blind laten pushen naar productie.
- Scraping alleen via cache/snapshots en met fallback, zodat de app niet breekt bij rate limits.
- GitHub/Vercel meldingen blijven buiten de app; rapporten worden lokaal in monitor opgeslagen.
