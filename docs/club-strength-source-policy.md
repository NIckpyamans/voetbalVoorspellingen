# Club strength source policy

The app separates current strength from historical European performance.

## Active rating (club-rating-v2)

The rating is an explicit initial heuristic, not a backtested claim of improved accuracy. It replaces the former form-derived squad score in the prediction's strength adjustment.

| Component | Nominal weight | Calculation |
| --- | --- | --- |
| Squad value | 45% | Average value of the 18 most valuable measured players; `clamp(50 + 20 * log10(meanEUR / 3,000,000), 1, 99)` |
| ClubElo | 35% | `clamp(50 + (Elo - 1500) / 10, 1, 99)` |
| Competition context | 15% | Same Elo scale applied to clubs in the actual domestic standings (provider ID or known alias, membership no older than 30 days, at least 60% Elo coverage), or to the division where ClubElo division metadata exists. Otherwise the 16 strongest clubs in the country form an explicitly labelled **country proxy**, not an official league ranking. At least six clubs are required. |
| Measured player performance | 5% | Mean provider rating for at least 11 players, contextualised as `leagueRating + 10 * (meanRating - 6.8)`, clamped to 1–99. No inferred player ratings are consumed. |

Values come from the existing FotMob/Transfermarkt-dataset squad adapters. Estimated transfer values are estimates, not transfer fees or objective ability ratings. No new arbitrary player prices are added. ClubElo's public CSV API remains primary; when it fails, the dated literal ranking table on https://clubelo.com/Ranking is parsed without executing page JavaScript. The complete snapshot is persisted in `data/club-elo-snapshot.json`; a failed refresh does not renew its source date. Names use the worker's existing aliases, including Manchester United / Man United. Sabah FK remains separate from Sabah.

At least 11 players and 60% of the roster must have positive finite values. Duplicate names are counted once. Missing prices never become zero-valued players. Squad evidence older than 30 days, Elo older than 14 days, and future evidence are excluded. A valid Elo or squad-value anchor is mandatory; league context alone cannot manufacture a club rating. Available component weights are normalised and missing components and source coverage are shown. Source coverage is **not** a win probability or measured predictive accuracy.

The country proxy cannot distinguish divisions and may overstate the competition context for lower-division clubs. It is a limited fallback, carries only 15% nominal weight, and is labelled in the interface. Richer verified domestic-division metadata should replace it when available. Players' raw match ratings are likewise only a small contextual signal, not an absolute talent scale.

For a pair of valid ratings, the goal model uses `exp(clamp((home-away)/60, -0.6, 0.6) * sqrt(minCoverage))` for the home adjustment and its inverse for away. This replaces the old Elo and squad goal adjustments. The independent squad ensemble component consumes the same new scale; the separate Elo ensemble component and heuristic Elo difference are disabled for such pairs. Other inputs (form, availability, venue, measured odds) remain active. National-team competitions do not consume club ratings. Version: `v25-club-rating`.

Validation: unit and integration tests verify missing-data behaviour, monotonic value changes, probability/goal effects, parsing and competition classification. `node scripts/audit-club-rating.js YYYY-MM-DD` replays current inputs for matches that have not started and writes `monitor/club-rating-validation.json`. This is **not** a historical backtest: present-day values must not be applied retroactively. Historical prediction snapshots remain immutable.

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
