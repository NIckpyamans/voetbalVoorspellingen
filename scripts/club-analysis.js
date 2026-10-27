// Aggregeert de post-match reviews per club.
// Gebruik: node scripts/club-analysis.js [minimum-wedstrijden=8] [afwijking-in-procentpunten=15]
// Leest data/history-summary.json (één grote JSON-regel) met JSON.parse, dus geen shell-zoekopdrachten nodig.
// Alleen-lezen: schrijft niets weg, alleen naar stdout.
// Let op: scripts/package.json declareert "type": "module", dus dit script moet ES-modules gebruiken.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const minMatches = Number(process.argv[2] ?? 8);
const deviation = Number(process.argv[3] ?? 15);

const file = path.join(__dirname, "..", "data", "history-summary.json");
const summary = JSON.parse(fs.readFileSync(file, "utf8"));
const reviews = Object.values(summary.postMatchReviews || {});

const pct = (hits, n) => (n ? (hits / n) * 100 : 0);
const clubs = new Map();

function bump(name, league, side, review) {
  if (!name) return;
  if (!clubs.has(name)) {
    clubs.set(name, { league, n: 0, hit: 0, exact: 0, goalErr: 0, goalErrN: 0, home: 0, away: 0 });
  }
  const c = clubs.get(name);
  c.n += 1;
  c[side] += 1;
  if (review.outcomeHit) c.hit += 1;
  if (review.exactHit) c.exact += 1;
  if (typeof review.totalGoalError === "number") {
    c.goalErr += review.totalGoalError;
    c.goalErrN += 1;
  }
}

for (const r of reviews) {
  bump(r.homeTeamName, r.league, "home", r);
  bump(r.awayTeamName, r.league, "away", r);
}

const overall = {
  n: reviews.length,
  hit: reviews.filter((r) => r.outcomeHit).length,
  exact: reviews.filter((r) => r.exactHit).length,
};
const overallHit = pct(overall.hit, overall.n);

const rows = [...clubs.entries()]
  .filter(([, c]) => c.n >= minMatches)
  .map(([name, c]) => {
    const hitPct = pct(c.hit, c.n);
    const diff = hitPct - overallHit;
    return {
      name,
      league: c.league,
      n: c.n,
      home: c.home,
      away: c.away,
      hitPct,
      exactPct: pct(c.exact, c.n),
      goalErr: c.goalErrN ? c.goalErr / c.goalErrN : 0,
      diff,
      flag: Math.abs(diff) >= deviation ? "AFWIJKEND" : "",
    };
  })
  .sort((a, b) => b.n - a.n);

console.log(`Reviews: ${overall.n} | 1X2 algemeen: ${overallHit.toFixed(1)}% | exact: ${pct(overall.exact, overall.n).toFixed(1)}%`);
console.log(`Clubs met >= ${minMatches} wedstrijden: ${rows.length} (afwijking-drempel ${deviation} procentpunten)`);
console.log("");
console.log("| Club | Competitie | N | Thuis | Uit | 1X2% | Exact% | Gem. doelpuntfout | Verschil | Vlag |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  console.log(
    `| ${r.name} | ${r.league} | ${r.n} | ${r.home} | ${r.away} | ${r.hitPct.toFixed(1)} | ${r.exactPct.toFixed(1)} | ${r.goalErr.toFixed(2)} | ${r.diff >= 0 ? "+" : ""}${r.diff.toFixed(1)} | ${r.flag} |`
  );
}
