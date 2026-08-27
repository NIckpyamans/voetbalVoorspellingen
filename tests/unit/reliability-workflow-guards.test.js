import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("reliability workflow guards", () => {
  it("keeps model reliability files out of live-score commits", () => {
    const workflow = read(".github/workflows/live-score.yml");
    expect(workflow).toContain(":!data/phase-reliability.json");
    expect(workflow).toContain(":!data/history-summary.json");
  });

  it("repairs late final scores after midnight", () => {
    const workflow = read(".github/workflows/live-score.yml");
    const orchestrator = read("scripts/workflow-orchestrator.js");
    expect(workflow).toContain('cron: "10 0,2,5,22 * * *"');
    expect(orchestrator).toContain("for (let offset = -1; offset <= 7; offset += 1)");
    expect(orchestrator).toContain("resultRefreshWindow.length");
    expect(orchestrator).toContain("!fixture.finalStatus");
  });

  it("checks Neon recovery periodically and gates replay on writability", () => {
    const workflow = read(".github/workflows/storage-recovery.yml");
    expect(workflow).toContain('cron: "23 */6 * * *"');
    expect(workflow).toContain("steps.database.outputs.databaseWritable == 'true'");
    expect(workflow).toContain("data/phase-reliability.json monitor/database-availability.json");
  });

  it("runs bounded squad batches four times daily", () => {
    const workflow = read(".github/workflows/team-squad-enrichment.yml");
    expect(workflow).toContain('cron: "17 3,8,13,18 * * *"');
    expect(workflow).toContain('SQUAD_ENRICHMENT_MAX_TEAMS: "32"');
  });
});
