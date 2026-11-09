# Workflowherstel 9 november 2026

## Vastgestelde oorzaken
- StatsBomb finalize 42460906238 en bronbatches 42472804176: merge-canonical-fixtures laadde alle kolommen van alle wedstrijden; Neon weigert respons boven 64 MiB (HTTP 507).
- Kalender 42478169867: Node heap uitgeput na de voorspellingassemblage bij opnieuw verwerken van historische snapshots. Modelonderhoud 42489200766 crashte eveneens tijdens ledgerverrijking.
- Post-match 42467194135: alle zeven dagcheckpoints slaagden; R2-opslag en export waren klaar. De databasesync liep vervolgens tot de 20-minutentimeout. Het datumfilter liet beoordelingen zonder wedstrijd in de actuele store door.

## Reparaties
- Canonieke samenvoeging leest uitsluitend benodigde identiteits-/kwaliteitsvelden, met keysetpagina's van 1000 records. Alle pagina's worden gelezen voor mutaties starten.
- Snapshotpublicatie hergebruikt reeds geladen immutable maanddata wanneer de actuele R2-contenthash overeenkomt. Gewijzigde shards worden opnieuw geladen; andere maanden blijven behouden.
- Modelonderhoud publiceert alleen gewijzigde beoordelingen en raakt alleen bijbehorende maanden.
- Een begrensde databasesync sluit records zonder aantoonbare datum in het gekozen venster uit; volledige herstelruns zonder datumfilter blijven onbeperkt.

## Lokale verificatie
148 testbestanden, 767 tests geslaagd; TypeScriptcontrole geslaagd. Nieuwe tests controleren datumselectie, hashgebaseerd hergebruik en behoud van gelijktijdig toegevoegde snapshots.

Eerdere lokale oktoberwijzigingen zijn veilig opgeslagen in Git-stashes; de nieuwste branch bevat inmiddels aanvullende reparaties. Deze worden niet blind overschreven.

Live herstelruns en productie-uitrol moeten na publicatie afzonderlijk worden gecontroleerd; historische rode runs worden niet gewist.
