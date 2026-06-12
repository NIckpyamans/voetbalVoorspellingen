# Competition season policy

FootyAI preserves every season as a separate competition archive.

## Rollover rules

- Never empty or delete the previous season archive.
- Create the next season under `data/competitions/<season>/`.
- New season files start with empty `matches` and `standings`.
- `membershipStatus: discovery_pending` means no participant should be assumed.
- `membershipStatus: partial_confirmed` means the listed teams are useful context, but the list is incomplete.
- Source discovery may replace a planned entry only after real fixtures or confirmed memberships arrive.
- The preparation script must never replace an active entry that already contains matches.

Run:

```bash
npm run season:prepare-next
```

The read-only FootyAI knowledge endpoint indexes both historical and planned competition files.
