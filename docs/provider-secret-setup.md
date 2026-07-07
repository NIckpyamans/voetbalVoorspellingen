# Provider Secret Setup

Deze app kan providerdata automatisch verwerken via GitHub Actions. Secrets zelf moeten handmatig in GitHub/Vercel worden toegevoegd, omdat bestaande GitHub secrets niet uitleesbaar zijn en nieuwe provideraccounts niet door code kunnen worden aangemaakt.

## Vercel sync

Voeg deze GitHub repository secret toe als automatische synchronisatie naar Vercel gewenst is:

- `VERCEL_TOKEN`

Daarna kan de workflow `Sync odds secret to Vercel` deze waarden naar Production, Preview en Development kopieren.

De workflow synchroniseert ook Cloudflare R2-cachevariabelen en optionele frontend-analytics naar Vercel.

## Cloudflare Web Analytics

Optioneel:

- `VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN`

Maak deze token in Cloudflare Web Analytics. Zet hem als GitHub repository secret en draai daarna `Sync odds secret to Vercel`. De frontend laadt Cloudflare Web Analytics alleen wanneer deze Vite-env bestaat. Zonder token blijft de app normaal werken.

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
- `MYSPORTS_API_KEY` wordt ook ondersteund als alias voor dezelfde key.
- `SPORTMONKS_ODDS_API_URL_TEMPLATE`

Gebruik in templates `{apiKey}`, `{homeTeam}`, `{awayTeam}`, `{league}`, `{kickoff}`, `{matchId}` en optioneel `{sport}`. De worker probeert providers in volgorde en stopt zodra bruikbare 1X2 odds zijn gevonden.

Voor een eerste Sportmonks key/quota-test is alleen `MYSPORTS_API_KEY` genoeg. Voor echte odds-capture moet daarnaast `SPORTMONKS_ODDS_API_URL_TEMPLATE` gevuld zijn met een endpoint dat odds teruggeeft, bijvoorbeeld een Sportmonks round- of fixture-endpoint met `include=fixtures.odds.market;fixtures.odds.bookmaker;fixtures.participants`.
