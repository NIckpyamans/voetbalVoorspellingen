// Gezondheidsoordeel over het model en de wedstrijdopslag.
//
// Het modelrapport bevat veel losse cijfers. Zonder samenvatting is niet te zien
// of een voorspelling op betrouwbare invoer rust. Deze module vertaalt de
// metingen naar één status met uitlegbare checks:
//
//   ok        - alle checks binnen de grens;
//   degraded  - het model werkt, maar één of meer bronnen zijn zwak;
//   blocked   - de basis klopt niet (lege opslag, te veel ongeldige records).
//
// De drempels zijn expliciet en conservatief. Ze zijn een signaal, geen
// automatische poort: de workflow rapporteert de status en gaat door, zodat een
// tijdelijke dip geen voorspellingen stillegt.

function pct(value) {
  return Math.round(Number(value) * 10) / 10;
}

export function assessModelHealth({
  store = {},
  integrity = {},
  calibration = {},
  dataQuality = {},
  marketBaseline = {},
  backtest = null,
} = {}) {
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });

  const matches = Number(store.matches || 0);
  if (!(matches > 0)) {
    add("opslag", "blocked", "geen wedstrijden in de compacte opslag");
  } else {
    add("opslag", "ok", `${matches} wedstrijden`);
  }

  const total = Number(integrity.total || 0);
  const dropped = Number(integrity.dropped || 0);
  if (total > 0) {
    const share = (dropped / total) * 100;
    if (share >= 5) add("integriteit", "blocked", `${pct(share)}% van de records ongeldig`);
    else if (dropped > 0) add("integriteit", "degraded", `${dropped} van ${total} records verwijderd`);
    else add("integriteit", "ok", "alle records geldig");
  }

  const fresh = dataQuality.freshness || {};
  const withDq = Number(dataQuality.withDq || 0);
  if (withDq > 0) {
    const weak = Number(fresh.old || 0) + Number(fresh.unknown || 0);
    const share = (weak / withDq) * 100;
    if (share >= 50) add("odds-versheid", "degraded", `${pct(share)}% van de odds is oud of ongedateerd`);
    else add("odds-versheid", "ok", `${pct(share)}% oud of ongedateerd`);
  } else {
    add("odds-versheid", "degraded", "geen odds-leeftijd vastgelegd");
  }

  const calN = Number(calibration.n || 0);
  const ece = Number(calibration.ece);
  if (calN >= 50 && Number.isFinite(ece)) {
    if (ece > 0.08) add("kalibratie", "degraded", `ECE ${ece} bij ${calN} beoordelingen`);
    else add("kalibratie", "ok", `ECE ${ece} bij ${calN} beoordelingen`);
  } else {
    add("kalibratie", "degraded", `te weinig beoordelingen (${calN})`);
  }

  const pairN = Number(marketBaseline?.probability?.modelN || 0);
  if (pairN >= 30) add("marktbenchmark", "ok", `${pairN} gekoppelde duels`);
  else add("marktbenchmark", "degraded", `te weinig gekoppelde duels (${pairN})`);

  if (backtest) {
    if (backtest.verdict === "baseline-beter") {
      add("sterktemodel", "degraded", "baseline zonder clubsterktes voorspelt beter");
    } else if (backtest.verdict) {
      add("sterktemodel", "ok", String(backtest.verdict));
    }
  }

  const statuses = checks.map((check) => check.status);
  const status = statuses.includes("blocked")
    ? "blocked"
    : statuses.includes("degraded")
      ? "degraded"
      : "ok";

  return {
    status,
    checks,
    summary: checks.filter((check) => check.status !== "ok").map((check) => `${check.id}: ${check.detail}`),
  };
}
