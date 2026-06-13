# FootyAI free operation

FootyAI does not require a paid AI API or an always-on personal server.

## Always available

- Vercel serves the website and read-only API.
- GitHub Actions refreshes full worker data twice per day and live scores every two hours.
- GitHub stores competition archives, daily data and health reports.
- The browser stores personal settings, learned prediction memory and FootyAI question history.
- The installable PWA caches the app shell and previously loaded API responses for temporary offline use.

## Optional local Ollama

Ollama is only an extra local answer engine. It works while the computer running Ollama is on.
Production keeps using the deterministic source-bound answer when Ollama is unavailable.

Example local configuration:

```env
FOOTYAI_OLLAMA_ENABLED=true
FOOTYAI_OLLAMA_URL=http://127.0.0.1:11434
FOOTYAI_OLLAMA_MODEL=llama3.2:3b
```

## Persistence limits

Vercel Functions do not provide a permanent local filesystem. Shared persistent writes must
therefore go through GitHub Actions or an optional database. Browser history is device-specific;
use the export button before clearing browser data or moving to another device.
