import { expect, it } from "vitest";
import { isInDatabaseSyncWindow } from "../../shared/database.js";
it("does not replay unrelated or undated archived reviews in bounded refreshes", () => {
  const dates = new Set(["2026-11-08"]);
  expect(isInDatabaseSyncWindow(dates, undefined, {}, { date: "2026-08-01" })).toBe(false);
  expect(isInDatabaseSyncWindow(dates, undefined, {})).toBe(false);
  expect(isInDatabaseSyncWindow(dates, undefined, { kickoff: "2026-11-08T17:00:00Z" })).toBe(true);
  expect(isInDatabaseSyncWindow(null, {})).toBe(true);
});
