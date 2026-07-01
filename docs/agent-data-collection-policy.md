# Agent- en Datacollectiebeleid

Laatst bijgewerkt: 2026-07-01T10:30:16.893Z

## Principe
Voeg alleen agents of databronnen toe als ze meetbaar betere dekking, betrouwbaarheid of modelprestatie geven.

## Toegestane agents
- Data Collection Agent: deterministic service voor bronfetching en source diagnostics.
- Data Validation Agent: controleert scores, H2H, team IDs, status en bronconflicten.
- Prediction Agent: bestaande modelkern, modulair en reproduceerbaar.
- Season Archive Agent: sluit seizoenen af en opent nieuwe seizoenen zonder dataverlies.
- Self Improvement Agent: adviseert en prioriteert, maar wijzigt niet blind productiegedrag.

## Niet toestaan
- Agents die dezelfde bron opnieuw ophalen zonder hogere betrouwbaarheid.
- LLM-agents voor deterministische datanormalisatie.
- Nieuwe bronnen zonder rate-limit, bronkwaliteit en fallbackbeleid.

## Acceptatiecriteria voor nieuwe bron
- Providernaam, licentie/gebruik, rate-limit en dekking zijn vastgelegd.
- Source timestamp en fetched_at worden opgeslagen.
- Conflicten worden door Data Validation opgelost of als anomaly gemarkeerd.
- Geen modelgewicht op nieuwe bron voordat minimaal 50 gevalideerde reviews beschikbaar zijn.
