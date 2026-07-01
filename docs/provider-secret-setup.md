# Provider Secret Setup

Deze app kan providerdata automatisch verwerken via GitHub Actions. Secrets zelf moeten handmatig in GitHub/Vercel worden toegevoegd, omdat bestaande GitHub secrets niet uitleesbaar zijn en nieuwe provideraccounts niet door code kunnen worden aangemaakt.

## Vercel sync

Voeg deze GitHub repository secret toe als automatische synchronisatie naar Vercel gewenst is:

- `VERCEL_TOKEN`

Daarna kan de workflow `Sync odds secret to Vercel` deze waarden naar Production, Preview en Development kopieren.

## API-Football / RapidAPI

Benodigd:

- `API_KEY_API_FOOTBALL`
- repository variable `API_FOOTBALL_BASE_URL=https://api-football-v1.p.rapidapi.com/v3`

Als de integrity-run `http_403` of `quota_or_rate_limit` meldt, is de code correct gekoppeld maar blokkeert het providerplan, de subscription of het quotum.

## Extra odds provider

Voor betere dekking van UEFA qualifiers, kleine competities en friendlies kan een tweede of derde provider worden toegevoegd:

- `ODDS_PROVIDER_NAME_2`
- `ODDS_API_URL_TEMPLATE_2`
- `ODDS_API_KEY_2`
- `ODDS_PROVIDER_NAME_3`
- `ODDS_API_URL_TEMPLATE_3`
- `ODDS_API_KEY_3`

Voor Sportmonks:

- `SPORTMONKS_API_KEY`
- `SPORTMONKS_ODDS_API_URL_TEMPLATE`

Gebruik in templates `{apiKey}`, `{homeTeam}`, `{awayTeam}`, `{league}`, `{kickoff}`, `{matchId}` en optioneel `{sport}`. De worker probeert providers in volgorde en stopt zodra bruikbare 1X2 odds zijn gevonden.
