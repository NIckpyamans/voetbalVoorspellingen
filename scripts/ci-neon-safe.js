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
    /Your project has exceeded the data transfer quota/i.test(output) ||
    // psql-formaat (db:schema:apply draait via psql i.p.v. de Neon HTTP-driver):
    /Your account or project has exceeded the quota/i.test(output) ||
    /exceeded the quota/i.test(output) ||
    // Limiet-onafhankelijk: Neon meldt de projectgrootte in MB en die is al eens
    // verhoogd (512 → 1024), waardoor de oude vaste 512-tekst niet meer matchte.
    /project size limit[^\n]*exceeded/i.test(output) ||
    /(?:NeonDbError:)?[^\n]*could not extend file/i.test(output) ||
    /code:\s*['\"]53100['\"]/i.test(output);

  if (quotaExceeded) {
    console.warn(
      "[ci-neon-safe] Neon quota or project-size limit reached. Treating this data job as a soft skip; R2/local evidence remains available and the next run can replay writes after recovery."
    );
    process.exit(0);
  }

  const transientNeonFailure =
    /NeonDbError: Error connecting to database/i.test(output) ||
    /TypeError: fetch failed/i.test(output) ||
    /connect E(?:ACCES|CONNRESET|TIMEDOUT|HOSTUNREACH)/i.test(output);

  if (transientNeonFailure) {
    console.warn(
      "[ci-neon-safe] Neon/network temporarily unavailable. Treating this scheduled data job as a soft skip; the next orchestrated run can retry."
    );
    process.exit(0);
  }

  process.exit(code || 1);
});
