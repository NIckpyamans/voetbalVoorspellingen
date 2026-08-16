import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const ROOT = process.cwd();

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
}

function readWorkflow(file) {
  return YAML.parse(fs.readFileSync(path.join(ROOT, ".github", "workflows", file), "utf8"));
}

describe("improvement audit automation contract", () => {
  it("schedules exactly five audits per month", () => {
    const workflow = readWorkflow("biweekly-review-digest.yml");
    expect(workflow.on.schedule).toEqual([{ cron: "15 6 1,7,13,19,25 * *" }]);
    expect(workflow.jobs["build-digest"].permissions).toMatchObject({ contents: "write", actions: "write" });
  });

  it("publishes five unique, executable improvement actions", () => {
    const report = readJson("monitor/biweekly-review-digest.json");
    const workflows = report.actionPlan.map((item) => item.workflow);
    expect(report.cadence).toBe("5x per maand");
    expect(report.actionPlan).toHaveLength(5);
    expect(new Set(workflows).size).toBe(5);
    for (const workflow of workflows) {
      expect(fs.existsSync(path.join(ROOT, ".github", "workflows", workflow))).toBe(true);
    }
  });

  it("keeps automatic model maintenance in shadow mode", () => {
    const workflow = readWorkflow("nightly-model-maintenance.yml");
    expect(workflow.on.workflow_dispatch.inputs.apply_live.default).toBe(false);
    expect(workflow.jobs.maintain.steps.some((step) => step.name === "Recalibrate league/model profiles in shadow mode")).toBe(true);
  });
});
