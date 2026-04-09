# FootyAI tweewekelijkse AI-digest

Periode: 2026-03-27 t/m 2026-04-09

AI bundel over de laatste 14 dagen: 4 hoofdthema's uit 7 monitorbevindingen.

- Runs: 2
- Bevindingen: 7
- Thema's: 4

## Hoofdpunten
- H2H niet gevuld (2x, severity: medium)
  - Trek H2H verder uit historische competitiebestanden en bewaak fallbackdekking in de worker.
- Bookmakersignalen missen (2x, severity: medium)
  - Verbred de interland-oddsbron en toon dekking per bookmaker in de kaart.
- Historische scheidsdata matcht te weinig (2x, severity: low)
  - Trek bredere referee-archieven per land/competitie in cache en onderhoud aliasen.
- Minute-logica nog dubbel (1x, severity: low)
  - Houd minute parsing centraal in de helper en verwijder resterende duplicaten.

## Reviewbranch voorstel
- codex/review-20260409
- AI reviewvoorstel voor 2026-04-09: 3 aandachtspunt(en) met patchadvies, niet automatisch live.

## Mailstatus
- Mailverzending vereist nog aparte mailcredentials of een mailservice. De bundel wordt nu wel automatisch opgebouwd en opgeslagen.
