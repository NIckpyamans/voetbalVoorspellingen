// Dagelijkse voorspellingsmonitor.
// Gebruik: node scripts/daily-prediction-monitor.js [--ledger pad] [--date YYYY-MM-DD]
// Standaard: ledger = data/recovery/ledger-latest.json.gz (door fetch-prediction-ledger.js), datum = gisteren (Europe/Amsterdam).
//
// Vergelijkt per afgeronde wedstrijd de voorspelling met de uitslag en splitst de
// fouten op de factoren die meewegen: competitietype, thuis/uit-bias, rustdagen,
// Elo-verschil en totaal-xG. Schrijft data/monitor/<datum>.md en .json.
// Verandert nooit de live voorspelmodellen; voorstellen staan in het rapport.

import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const ledgerPath = path.resolve(root, arg("--ledger", "data/recovery/ledger-latest.json.gz"));
const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
const targetDate = arg("--date", yesterday);

function loadLedger(file) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"));
}

function mean(values) {
  const xs = values.filter((x) => Number.isFinite(x));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function rate(items, pred) {
  const measured = items.map(pred).filter(value => typeof value === 'boolean');
  return measured.length ? measured.filter(Boolean).length / measured.length : null;
}

const percent = value => value == null ? null : value * 100;

function fmt(x, digits = 3) {
  return x == null || !Number.isFinite(x) ? "n/a" : x.toFixed(digits);
}

function bucketBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (key == null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, items]) => ({
    key,
    n: items.length,
    outcomeHit: rate(items, (r) => r.outcomeHit),
    over25Hit: rate(items, (r) => r.over25Hit),
    bttsHit: rate(items, (r) => r.bttsHit),
    brier: mean(items.map((r) => r.brierScore)),
    totalGoalBias: mean(items.map((r) => r.totalGoalBias)),
  }));
}

const measuredNumber = value => value == null || value === '' ? NaN : Number(value);
export function buildRows(ledger) {
  const snapshots = ledger.predictionSnapshots || {};
  const rows = [];
  const seen = new Set();
  for (const review of Object.values(ledger.postMatchReviews || {})) {
    const key = review.predictionId || `${review.matchId}|${review.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const snap = snapshots[review.predictionId];
    const p = snap?.prediction || {};
    const predictedTotal = measuredNumber(review.predictedTotalGoals ?? (measuredNumber(p.homeXG) + measuredNumber(p.awayXG)));
    const actualTotal = measuredNumber(review.actualTotalGoals);
    rows.push({
      predictionId: review.predictionId,
      matchId: review.matchId,
      date: String(review.date || ""),
      league: String(review.league || ""),
      friendly: /friendl/i.test(String(review.league || "")),
      homeName: review.homeTeamName,
      awayName: review.awayTeamName,
      predictedScore: review.predictedScore,
      actualScore: review.actualScore,
      predictedOutcome: review.predictedOutcome,
      actualOutcome: review.actualOutcome,
      outcomeHit: typeof review.outcomeHit === 'boolean' ? review.outcomeHit : null,
      over25Hit: typeof review.over25Hit === 'boolean' ? review.over25Hit : null,
      bttsHit: typeof review.bttsHit === 'boolean' ? review.bttsHit : null,
      brierScore: measuredNumber(review.brierScore),
      totalGoalBias: Number.isFinite(predictedTotal) && Number.isFinite(actualTotal) ? predictedTotal - actualTotal : null,
      homeRestDays: measuredNumber(p.homeRestDays),
      awayRestDays: measuredNumber(p.awayRestDays),
      homeClubElo: measuredNumber(p.homeClubElo),
      awayClubElo: measuredNumber(p.awayClubElo),
      totalXG: measuredNumber(p.homeXG) + measuredNumber(p.awayXG),
    });
  }
  return rows;
}

function restBucket(diff) {
  if (!Number.isFinite(diff)) return null;
  if (diff <= -2) return "uit veel rustiger (<=-2)";
  if (diff < 0) return "uit iets rustiger (-1..-0,5)";
  if (diff === 0) return "gelijke rust";
  if (diff < 2) return "thuis iets rustiger (0,5..2)";
  return "thuis veel rustiger (>=2)";
}

function eloBucket(diff) {
  if (!Number.isFinite(diff)) return null;
  if (diff <= -150) return "uit duidelijk sterker (<=-150)";
  if (diff < -50) return "uit iets sterker (-150..-50)";
  if (diff <= 50) return "gelijk (-50..50)";
  if (diff < 150) return "thuis iets sterker (50..150)";
  return "thuis duidelijk sterker (>=150)";
}

function xgBucket(total) {
  if (!Number.isFinite(total)) return null;
  if (total < 2.2) return "laag (<2,2)";
  if (total < 2.8) return "midden (2,2..2,8)";
  return "hoog (>=2,8)";
}

function proposals(rows) {
  const out = [];
  const outcomeCounts = { H: 0, D: 0, A: 0 };
  for (const r of rows) if (r.predictedOutcome in outcomeCounts) outcomeCounts[r.predictedOutcome] += 1;
  const drawPredicted = outcomeCounts.D;
  const drawActual = rows.filter((r) => r.actualOutcome === "D").length;
  if (rows.length >= 30 && drawPredicted === 0 && drawActual / rows.length > 0.2) {
    out.push(`Remise wordt nooit voorspeld terwijl ${(100 * drawActual / rows.length).toFixed(0)}% gelijk speelde: onderzoek gelijkspel-kans.`);
  }
  const totalBias = mean(rows.map((r) => r.totalGoalBias));
  if (rows.length >= 30 && totalBias != null && Math.abs(totalBias) > 0.4) {
    out.push(`Gemiddelde totaal-doelpunten-bias ${totalBias.toFixed(2)}: ${totalBias > 0 ? "te veel" : "te weinig"} doelpunten voorspeld.`);
  }
  return out;
}

function main() {
  const ledger = loadLedger(ledgerPath);
  const all = buildRows(ledger);
  const dayRows = all.filter((r) => r.date === targetDate);
  const lastDate = all.map((r) => r.date).filter(Boolean).sort().at(-1);

  const lines = [];
  const payload = { generatedAt: new Date().toISOString(), targetDate, ledgerPath: path.basename(ledgerPath), ledgerLastReviewDate: lastDate, matches: dayRows.length };
  lines.push(`# Voorspellingsmonitor ${targetDate}`, "");
  lines.push(`Ledger: \`${path.basename(ledgerPath)}\`. Laatste review in ledger: ${lastDate}.`, "");

  if (!dayRows.length) {
    lines.push(`Geen afgeronde wedstrijden voor ${targetDate} in deze ledger.`);
    lines.push("Onbekend of er wedstrijden ontbreken: vergelijk de wedstrijdkalender en de actualiteit van de export. Dit bewijst geen modelfout of datagat.");
    payload.status = "no-matches-for-date";
  } else {
    const hitOutcome = rate(dayRows, (r) => r.outcomeHit);
    const hitOver = rate(dayRows, (r) => r.over25Hit);
    const hitBtts = rate(dayRows, (r) => r.bttsHit);
    const brier = mean(dayRows.map((r) => r.brierScore));
    lines.push(`## Samenvatting (n=${dayRows.length})`, "");
    lines.push(`- Uitkomst (1X2) juist: ${fmt(percent(hitOutcome), 1)}%`);
    lines.push(`- Over 2.5 juist: ${fmt(percent(hitOver), 1)}%`);
    lines.push(`- BTTS juist: ${fmt(percent(hitBtts), 1)}%`);
    lines.push(`- Gemiddelde Brier: ${fmt(brier)}`, "");

    const sections = [
      ["Competitietype", (r) => (r.friendly ? "vriendschappelijk" : "competitie")],
      ["Totaal-xG", (r) => xgBucket(r.totalXG)],
      ["Rustdagen (thuis - uit)", (r) => restBucket(r.homeRestDays - r.awayRestDays)],
      ["Elo-verschil (thuis - uit)", (r) => eloBucket(r.homeClubElo - r.awayClubElo)],
    ];
    for (const [title, keyFn] of sections) {
      lines.push(`## ${title}`, "", "| groep | n | 1X2 | over2.5 | BTTS | Brier | tot-bias |", "|---|---|---|---|---|---|---|");
      for (const b of bucketBy(dayRows, keyFn)) {
        lines.push(`| ${b.key} | ${b.n} | ${fmt(percent(b.outcomeHit), 0)}% | ${fmt(percent(b.over25Hit), 0)}% | ${fmt(percent(b.bttsHit), 0)}% | ${fmt(b.brier)} | ${fmt(b.totalGoalBias, 2)} |`);
      }
      lines.push("");
    }

    const bad = dayRows.filter((r) => r.outcomeHit === false).sort((a, b) => (b.brierScore || 0) - (a.brierScore || 0)).slice(0, 15);
    lines.push("## Grootste misses", "", "| wedstrijd | voorspeld | uitslag | Brier |", "|---|---|---|---|");
    for (const r of bad) lines.push(`| ${r.homeName} - ${r.awayName} (${r.league}) | ${r.predictedScore} ${r.predictedOutcome} | ${r.actualScore} | ${fmt(r.brierScore)} |`);
    lines.push("");

    const props = proposals(dayRows);
    payload.proposals = props;
    lines.push("## Voorstellen (niet automatisch toegepast)", "");
    lines.push(...(props.length ? props.map((p) => `- ${p}`) : ["- Geen voorstel: onvoldoende afwijking op deze steekproef."]));
    lines.push("");
    payload.status = "ok";
    payload.summary = { outcomeHit: hitOutcome, over25Hit: hitOver, bttsHit: hitBtts, brier };
  }

  const outDir = path.join(root, "data", "monitor");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${targetDate}.md`), lines.join("\n"), "utf8");
  fs.writeFileSync(path.join(outDir, `${targetDate}.json`), JSON.stringify(payload, null, 2), "utf8");
  console.log(lines.join("\n"));
  console.log(`\nGeschreven: data/monitor/${targetDate}.md`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
