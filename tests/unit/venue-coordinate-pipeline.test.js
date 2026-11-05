import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const ROOT = process.cwd();

function weatherJobSteps() {
  const text = fs.readFileSync(path.join(ROOT, ".github", "workflows", "free-source-batches.yml"), "utf8");
  const workflow = YAML.parse(text);
  const job = Object.values(workflow.jobs || {}).find((item) =>
    (item?.steps || []).some((step) => String(step?.run || "").includes("--source=weather"))
  );
  expect(job).toBeTruthy();
  return job.steps || [];
}

describe("venue-coordinate pipeline", () => {
  it("resolves stadium coordinates before the scheduled weather import", () => {
    const steps = weatherJobSteps();
    const venues = steps.findIndex((step) => String(step.run || "").includes("--source=venues"));
    const weather = steps.findIndex((step) => String(step.run || "").includes("--source=weather"));
    expect(venues).toBeGreaterThanOrEqual(0);
    expect(weather).toBeGreaterThanOrEqual(0);
    // Zonder geocodeerstap blijft venues.latitude leeg en vult het weer nooit.
    expect(venues).toBeLessThan(weather);
  });

  it("bounds the geocoding budget per run", () => {
    const step = weatherJobSteps().find((item) => String(item.run || "").includes("--source=venues"));
    expect(step.env.DATABASE_URL).toBeTruthy();
    expect(Number(step.env.VENUE_GEOCODE_LIMIT)).toBeGreaterThan(0);
    expect(Number(step.env.VENUE_GEOCODE_LIMIT)).toBeLessThanOrEqual(60);
  });
});
