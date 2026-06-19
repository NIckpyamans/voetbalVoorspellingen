#!/usr/bin/env node

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";

const npmCliPath =
  process.env.npm_execpath ||
  join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

if (!existsSync(npmCliPath)) {
  process.stderr.write(`[quality-workflow] npm CLI not found: ${npmCliPath}\n`);
  process.exit(1);
}

const steps = [
  [process.execPath, [npmCliPath, "run", "check"]],
  [process.execPath, [npmCliPath, "run", "monitor:regressions"]],
  [process.execPath, [npmCliPath, "run", "monitor:orchestration"]],
  [process.execPath, [npmCliPath, "run", "build"]],
];

for (const [command, args] of steps) {
  const label = `npm ${args.slice(1).join(" ")}`;
  process.stdout.write(`\n[quality-workflow] ${label}\n`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.stderr.write(`[quality-workflow] failed: ${label}\n`);
    process.exit(result.status || 1);
  }
}

process.stdout.write("\n[quality-workflow] ok\n");
