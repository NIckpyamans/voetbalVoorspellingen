#!/usr/bin/env node
// Eenmalige, deterministische toepassing van de R2-first leesroute.
// De runner heeft een werkende toolchain (tsc/vitest) terwijl de lokale
// ontwikkelmachine in deze sessie geen processen kan starten; daarom wordt de
// wijziging hier toegepast en in dezelfde run getypecheckt en getest.
//
//   node scripts/apply-r2-first-read-path.js
import fs from "node:fs";

const EDITS = [
  {
    file: "api/_dataSource.ts",
    before: `export async function fetchServerStore() {
  if (databaseConfigured()) {
    try {
      const databaseStore = await readDatabaseServerStore();
      if (databaseStore?.store) return databaseStore;
    } catch (err: any) {
      logger.warning("database_server_store_fetch_failed", { error: getErrorDetails(err) });
    }
  }

  const cached = readCache("server_data.json");`,
    after: `export async function fetchServerStore() {
  const cached = readCache("server_data.json");`,
  },
  {
    file: "api/_dataSource.ts",
    before: `  throw new Error(lastError || "Kon server_data.json niet ophalen");`,
    after: `  // Neon-egress is de limiet die bij overschrijding de hele compute opschort
  // (HTTP 402, ook op \`select 1\`). De R2/GitHub-store en de dagcache zijn
  // gratis, dus Neon is hier de laatste strohalm: pas na een echte miss.
  if (databaseConfigured()) {
    try {
      const databaseStore = await readDatabaseServerStore();
      if (databaseStore?.store) {
        writeCache("server_data.json", {
          data: databaseStore.store,
          branch: databaseStore.branch,
          sourceUrl: databaseStore.sourceUrl,
        });
        return databaseStore;
      }
    } catch (err: any) {
      logger.warning("database_server_store_fetch_failed", { error: getErrorDetails(err) });
    }
  }

  throw new Error(lastError || "Kon server_data.json niet ophalen");`,
  },
  {
    file: "api/predict.ts",
    before: `      } else {
      const dbDay = databaseConfigured() ? await readDatabaseDay(date).catch(() => null) : null;
      if (dbDay?.matches?.length || dbDay?.predictions?.length) {
        predictions = dbDay.predictions || [];
        matches = dbDay.matches || [];
        branch = "postgres";
      } else {
      const [dayResponse, metaResponse] = await Promise.all([
        fetchDayData(date),
        fetchMetaData().catch(() => ({ data: {}, branch: "split-data" })),
      ]);
      const day = dayResponse.data || {};
      const meta = metaResponse.data || {};
      predictions = Array.isArray(day.predictions) ? day.predictions : [];
      matches = Array.isArray(day.matches) ? day.matches : [];
      reviews = day.reviews || {};
      branch = dayResponse.branch || branch;
      lastRun = day.lastRun || meta.lastRun || null;
      reviewCount = Number(meta.reviewCount || Object.keys(reviews).length || 0);
      }
      }`,
    after: `      } else {
      // Splitdag eerst: die komt uit R2/GitHub en kost geen Neon-egress. Neon
      // is de dure bron (5 GB/maand) en wordt pas gebruikt als de dag echt
      // niet op te halen is.
      try {
        const [dayResponse, metaResponse] = await Promise.all([
          fetchDayData(date),
          fetchMetaData().catch(() => ({ data: {}, branch: "split-data" })),
        ]);
        const day = dayResponse.data || {};
        const meta = metaResponse.data || {};
        predictions = Array.isArray(day.predictions) ? day.predictions : [];
        matches = Array.isArray(day.matches) ? day.matches : [];
        reviews = day.reviews || {};
        branch = dayResponse.branch || branch;
        lastRun = day.lastRun || meta.lastRun || null;
        reviewCount = Number(meta.reviewCount || Object.keys(reviews).length || 0);
      } catch (splitError) {
        const dbDay = databaseConfigured() ? await readDatabaseDay(date).catch(() => null) : null;
        if (dbDay?.matches?.length || dbDay?.predictions?.length) {
          predictions = dbDay.predictions || [];
          matches = dbDay.matches || [];
          branch = "postgres";
        } else {
          throw splitError;
        }
      }
      }`,
  },
  {
    file: "api/Matches.ts",
    before: `          const dateStr = addDaysToDateKey(targetDate, offset);
          try {
            const dbDay = databaseConfigured() ? await readDatabaseDay(dateStr).catch(() => null) : null;
            if (dbDay?.matches?.length) {
              return { date: dateStr, matches: dbDay.matches.map((match: any) => attachReviewAndNormalize(match, {})), branch: "postgres", error: null };
            }
            const day = await readSplitDay(dateStr);
            return {
              date: dateStr,
              matches: day.matches.map((match: any) => attachReviewAndNormalize(match, day.reviews)),
              branch: day.branch || "split-data",
              error: null,
            };
          } catch (error: any) {
            return { date: dateStr, matches: [], branch: null, error: error?.message || String(error) };
          }`,
    after: `          const dateStr = addDaysToDateKey(targetDate, offset);
          // Splitdag eerst (R2/GitHub, gratis egress); Neon alleen voor dagen
          // die echt ontbreken, zodat een kalenderverzoek het egressbudget
          // niet opbrandt.
          try {
            const day = await readSplitDay(dateStr);
            return {
              date: dateStr,
              matches: day.matches.map((match: any) => attachReviewAndNormalize(match, day.reviews)),
              branch: day.branch || "split-data",
              error: null,
            };
          } catch (splitError: any) {
            const dbDay = databaseConfigured() ? await readDatabaseDay(dateStr).catch(() => null) : null;
            if (dbDay?.matches?.length) {
              return { date: dateStr, matches: dbDay.matches.map((match: any) => attachReviewAndNormalize(match, {})), branch: "postgres", error: null };
            }
            return { date: dateStr, matches: [], branch: null, error: splitError?.message || String(splitError) };
          }`,
  },
  {
    file: "api/Matches.ts",
    before: `      } else {
      const dbDay = !detailRequest && databaseConfigured() ? await readDatabaseDay(targetDate).catch(() => null) : null;
      if (dbDay?.matches?.length) {
        baseMatches = dbDay.matches.map((match: any) => attachReviewAndNormalize(match, {}));
        sourceBranch = "postgres";
      } else {
        const day = await readSplitDay(targetDate);
        baseMatches = day.matches.map((match: any) => attachReviewAndNormalize(match, day.reviews));
        lastRun = day.lastRun || lastRun;
        workerVersion = day.workerVersion || workerVersion;
        sourceBranch = day.branch || sourceBranch;
      }
      }`,
    after: `      } else {
      // Splitdag eerst (R2/GitHub); Neon pas als de dag niet op te halen is.
      try {
        const day = await readSplitDay(targetDate);
        baseMatches = day.matches.map((match: any) => attachReviewAndNormalize(match, day.reviews));
        lastRun = day.lastRun || lastRun;
        workerVersion = day.workerVersion || workerVersion;
        sourceBranch = day.branch || sourceBranch;
      } catch (splitError) {
        const dbDay = !detailRequest && databaseConfigured() ? await readDatabaseDay(targetDate).catch(() => null) : null;
        if (dbDay?.matches?.length) {
          baseMatches = dbDay.matches.map((match: any) => attachReviewAndNormalize(match, {}));
          sourceBranch = "postgres";
        } else {
          throw splitError;
        }
      }
      }`,
  },
  {
    file: "tests/unit/calendar-api.test.js",
    before: `    expect(vi.mocked(fetchDayData).mock.calls.map(([date]) => date)).toEqual([
      addDaysToDateKey("2026-10-03", -1),
      "2026-10-03",
      addDaysToDateKey("2026-10-03", 1),
    ]);
  });
});`,
    after: `    expect(vi.mocked(fetchDayData).mock.calls.map(([date]) => date)).toEqual([
      addDaysToDateKey("2026-10-03", -1),
      "2026-10-03",
      addDaysToDateKey("2026-10-03", 1),
    ]);
  });
});

describe("matches API keeps Neon out of the read path unless a day is missing", () => {
  it("serves a split day without querying Neon", async () => {
    const { databaseConfigured, readDatabaseDay } = await import("../../shared/database.js");
    vi.mocked(databaseConfigured).mockReturnValue(true);
    vi.mocked(readDatabaseDay).mockClear();

    const req = { query: { date: "2026-10-03" }, method: "GET", headers: {} };
    const res = responseStub();
    await handler(req, res);

    expect(res.result.statusCode).toBe(200);
    expect(res.result.body.matches).toHaveLength(1);
    expect(readDatabaseDay).not.toHaveBeenCalled();
    vi.mocked(databaseConfigured).mockReturnValue(false);
  });

  it("queries Neon once when the split day cannot be loaded", async () => {
    const { databaseConfigured, readDatabaseDay } = await import("../../shared/database.js");
    vi.mocked(databaseConfigured).mockReturnValue(true);
    vi.mocked(readDatabaseDay).mockResolvedValue({
      matches: [{
        id: "db-fixture",
        date: "2026-10-03",
        kickoff: "2026-10-03T15:00:00.000Z",
        league: "Netherlands - Eredivisie",
        homeTeamName: "Ajax",
        awayTeamName: "PSV Eindhoven",
      }],
    });
    fetchDayDataMock.mockImplementation(async () => {
      throw new Error("missing split day");
    });

    const req = { query: { date: "2026-10-03" }, method: "GET", headers: {} };
    const res = responseStub();
    await handler(req, res);

    expect(res.result.statusCode).toBe(200);
    expect(res.result.body.sourceBranch).toBe("postgres");
    expect(vi.mocked(readDatabaseDay).mock.calls).toHaveLength(1);
    vi.mocked(readDatabaseDay).mockResolvedValue(null);
    vi.mocked(databaseConfigured).mockReturnValue(false);
  });
});`,
  },
];

function replaceOnce(file, oldText, newText) {
  const source = fs.readFileSync(file, "utf8");
  const variants = [
    [oldText, newText],
    [oldText.replace(/\n/g, "\r\n"), newText.replace(/\n/g, "\r\n")],
  ];
  for (const [before, after] of variants) {
    const occurrences = source.split(before).length - 1;
    if (occurrences === 1) {
      fs.writeFileSync(file, source.replace(before, after));
      return true;
    }
    if (occurrences > 1) {
      throw new Error(`${file}: patroon komt ${occurrences}x voor; weiger te gokken`);
    }
  }
  throw new Error(`${file}: patroon niet gevonden; bestand is gewijzigd t.o.v. de aanname`);
}

let applied = 0;
for (const edit of EDITS) {
  if (replaceOnce(edit.file, edit.before, edit.after)) applied += 1;
  console.log(`[r2-first] toegepast: ${edit.file}`);
}
if (applied !== EDITS.length) {
  console.error(`[r2-first] ${applied}/${EDITS.length} toegepast; afbreken`);
  process.exit(1);
}
console.log(`[r2-first] ${applied}/${EDITS.length} vervangingen toegepast`);
