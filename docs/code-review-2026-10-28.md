# Code-audit 2026-10-28

Volledige controle van de code op fouten, plus de vijf aanpassingen die deze
ronde zijn doorgevoerd.

## Werkwijze

De lokale shell van de ontwikkelomgeving is geblokkeerd (EPERM), daarom loopt alle
controle via de CI-poort `pull-request-quality.yml`: `tsc --noEmit`, `vitest run`,
`vite build`, archief-retentie, repo-grootte, regressie-assertions en de
Playwright-e2e-suite. Een wijziging geldt pas als doorgevoerd wanneer die poort
groen is.

## Status

In behandeling.
