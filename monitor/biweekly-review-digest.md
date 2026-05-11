# FootyAI tweewekelijkse AI-digest

Periode: 2026-04-28 t/m 2026-05-11

AI bundel over de laatste 14 dagen: 5 hoofdthema's uit 14 monitorbevindingen.

- Runs: 25
- Bevindingen: 14
- Thema's: 5

## Hoofdpunten
- Historische scheidsdata matcht te weinig (5x, severity: low)
  - Trek bredere referee-archieven per land/competitie in cache en onderhoud aliasen.
- Bookmakersignalen missen (4x, severity: medium)
  - Verbred de interland-oddsbron en toon dekking per bookmaker in de kaart.
- H2H niet gevuld (2x, severity: medium)
  - Trek H2H verder uit historische competitiebestanden en bewaak fallbackdekking in de worker.
- Geen speeldagdata (2x, severity: medium)
  - Controleer brondekking en dagfilter in de worker voor vandaag + morgen.
- Bekerschema leeg (1x, severity: medium)
  - Gebruik het reviewbranch-voorstel als veilige volgende patchronde.

## Reviewbranch voorstel
- Geen voorstel nodig.

## Mailstatus
- Mailverzending vereist nog aparte mailcredentials of een mailservice. De bundel wordt nu wel automatisch opgebouwd en opgeslagen.
