#!/usr/bin/env node

const { execSync } = require("child_process");

function run(command) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

try {
  const message = run("git log -1 --pretty=%B");
  const changedFiles = run("git diff-tree --no-commit-id --name-only -r HEAD")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);

  const workerOnlyFiles = new Set([
    "server_data.json",
    "training/training-snapshot.json",
    "monitor/daily-findings.json",
  ]);

  const onlyWorkerData =
    changedFiles.length > 0 && changedFiles.every((file) => workerOnlyFiles.has(file));
  const skipByMessage = /\[skip vercel\]/i.test(message);

  if (skipByMessage || onlyWorkerData) {
    console.log("[vercel-ignore-build] build overslaan voor worker/data-only commit");
    process.exit(0);
  }

  console.log("[vercel-ignore-build] codewijziging gevonden, build uitvoeren");
  process.exit(1);
} catch {
  console.log("[vercel-ignore-build] fallback naar build uitvoeren");
  process.exit(1);
}
