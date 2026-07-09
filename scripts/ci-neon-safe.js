import { spawn } from "node:child_process";

const separator = process.argv.indexOf("--");
const command = separator >= 0 ? process.argv[separator + 1] : process.argv[2];
const args = separator >= 0 ? process.argv.slice(separator + 2) : process.argv.slice(3);

if (!command) {
  console.error("[ci-neon-safe] usage: node scripts/ci-neon-safe.js -- <command> [...args]");
  process.exit(2);
}

let output = "";
const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
const child = spawn(executable, args, {
  shell: false,
  stdio: ["inherit", "pipe", "pipe"],
  env: process.env,
});

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  output += text;
  process.stdout.write(chunk);
});

child.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  output += text;
  process.stderr.write(chunk);
});

child.on("error", (error) => {
  console.error(`[ci-neon-safe] failed to start ${command}: ${error.message}`);
  process.exit(1);
});

child.on("close", (code, signal) => {
  if (signal) {
    console.error(`[ci-neon-safe] ${command} stopped by signal ${signal}`);
    process.exit(1);
  }
  if (code === 0) {
    process.exit(0);
  }

  const quotaExceeded =
    /HTTP status 402/i.test(output) ||
    /exceeded the data transfer quota/i.test(output) ||
    /Your project has exceeded the data transfer quota/i.test(output);

  if (quotaExceeded) {
    console.warn(
      "[ci-neon-safe] Neon data-transfer quota exceeded. Treating this scheduled data job as a soft skip; upgrade/reset Neon quota or reduce DB traffic for fresh writes."
    );
    process.exit(0);
  }

  process.exit(code || 1);
});
