# Club strength source policy

The app separates current strength from historical European performance.

## Active rating

- ClubElo is the primary external rating. One daily snapshot is enough; the worker caches the result and resolves aliases locally.
- `clubStrength.rating` is an internal 0-100 display score based on ClubElo, the current verified squad, availability, form, standings and, when present, the confirmed lineup.
- These inputs already feed the prediction model separately. The combined display score is not added again as a model feature, preventing double counting.

## UEFA coefficient

- The official five-season sporting coefficient is a European seeding and historical-performance signal, not a current-form rating.
- It may receive only a small, competition-specific model weight after shadow evaluation.
- The field stays empty until the value comes from an authorised or explicitly licensed feed. Missing values must never be inferred or presented as official.

## Sources not ingested automatically

- Euro Club Index forbids copying or duplicating its information without written permission and states that its information is not intended for trading.
- Opta/Stats Perform website material is restricted to personal, non-commercial use and may not be republished without consent.
- Both can be used as human benchmarks. Their scores and probabilities must not be scraped, stored or republished by this application without a licence.

## Interpretation

- ClubElo: current cross-league team strength.
- Club strength: transparent app-specific summary of current team and squad strength.
- UEFA coefficient: five-season European pedigree and seeding, when licensed data is available.
- Market odds: separate provider data with source timestamps; model probabilities from rankings are not bookmaker odds.
