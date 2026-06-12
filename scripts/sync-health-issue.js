#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const root = process.cwd();
const proposalPath = path.join(root, "monitor", "review-branch-proposal.json");
const dryRun = process.argv.includes("--dry-run") || !process.env.GITHUB_ACTIONS;

if (!fs.existsSync(proposalPath)) {
  console.log(JSON.stringify({ skipped: true, reason: "proposal_missing" }));
  process.exit(0);
}

const proposal = JSON.parse(fs.readFileSync(proposalPath, "utf8"));
const relevant = (proposal.findings || []).filter((item) => ["high", "medium"].includes(item.severity));
if (!relevant.length) {
  console.log(JSON.stringify({ skipped: true, reason: "no_relevant_findings" }));
  process.exit(0);
}

const marker = "<!-- footyai-health-check -->";
const title = `[Health] FootyAI aandachtspunten ${proposal.date}`;
const body = [
  marker,
  `## Automatische health-check ${proposal.date}`,
  "",
  proposal.summary,
  "",
  "## Bevindingen",
  ...relevant.flatMap((item) => [
    `### ${item.priority}. ${item.key} (${item.severity})`,
    item.message,
    "",
    `Impact: ${item.whyItMatters}`,
    "",
    `Patchvoorstel: controleer en wijzig indien nodig \`${(item.recommendedFiles || []).join("`, `")}\`.`,
    "",
  ]),
  "## Guardrail",
  "Dit issue bevat alleen een patchvoorstel. Wijzigingen mogen pas na review en geslaagde checks worden gemerged.",
].join("\n");

if (dryRun) {
  console.log(JSON.stringify({ dryRun: true, title, relevantFindings: relevant.length, body }, null, 2));
  process.exit(0);
}

function gh(args) {
  const result = spawnSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(result.stderr || `gh ${args.join(" ")} failed`);
  return result.stdout.trim();
}

const existing = gh(["issue", "list", "--state", "open", "--label", "health-check", "--search", marker, "--json", "number", "--jq", ".[0].number"]);
if (existing) {
  gh(["issue", "edit", existing, "--title", title, "--body", body]);
  console.log(JSON.stringify({ updated: true, issue: Number(existing), findings: relevant.length }));
} else {
  const url = gh(["issue", "create", "--title", title, "--body", body, "--label", "health-check,needs-triage"]);
  console.log(JSON.stringify({ created: true, url, findings: relevant.length }));
}
