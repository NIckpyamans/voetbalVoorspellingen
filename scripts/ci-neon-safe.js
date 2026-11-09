import { spawn } from "node:child_process";

const separator = process.argv.indexOf("--");
const command = separator >= 0 ? process.argv[separator + 1] : process.argv[2];
const args = separator >= 0 ? process.argv.slice(separator + 2) : process.argv.slice(3);

if (!command) {
  console.error("[ci-neon-safe] usage: node scripts/ci-neon-safe.js -- <command> [...args]");
  process.exit(2);
}

// De R2-snapshotrecovery en de post-matchbackfill bouwen de volledige ledger als
// objectgraaf op. Met de standaard 4 GB heap van de runner stopte Node daar
// middenin met "Ineffective mark-compacts near heap limit" en een SIGABRT; de
// run leek dan op een gewone fout terwijl het echt een capaciteitsgrens was.
const NODE_MAX_OLD_SPACE_MB = 8192;

function withNodeHeapLimit(options = "") {
  const withoutHeapLimit = String(options).replace(/--max-old-space-size=\d+/g, "").trim();
  return `${withoutHeapLimit} --max-old-space-size=${NODE_MAX_OLD_SPACE_MB}`.trim();
}

// Een onverklaarde fout belandde eerder als kale "Process completed with exit
// code 1" in de UI: de joblog is te groot om te openen en de annotatie was dan
// het enige spoor. We herhalen daarom de laatste regels, met credentials
// gemaskeerd, zodat de oorzaak zonder de volledige log leesbaar is.
const FAILURE_TAIL_LINES = 20;
const FAILURE_ANNOTATION_MAX_CHARS = 3000;

function redactSecrets(text = "") {
  return String(text)
    .replace(/\b(postgres(?:ql)?:\/\/)[^\s"'`]+/gi, "$1***")
    .replace(/([?&](?:api[_-]?key|key|token|access_token|secret|password|sig)=)[^&\s"'`]+/gi, "$1***")
    .replace(
      /\b((?:api[_-]?key|access[_-]?key|secret[_-]?access[_-]?key|token|secret|password|authorization)["']?\s*[:=]\s*["']?)[A-Za-z0-9_\-./+=]{12,}/gi,
      "$1***",
    )
    .replace(/\b(Bearer\s+)[A-Za-z0-9_\-./+=]{12,}/gi, "$1***");
}

function escapeAnnotation(text) {
  return String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function annotateFailure(output, code, signal) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  const lines = String(output)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const tail = lines.slice(-FAILURE_TAIL_LINES).join("\n");
  const detail = redactSecrets(tail) || "(geen uitvoer opgevangen)";
  const reason = signal ? `gestopt door signaal ${signal}` : `exit code ${code}`;
  const message = `${reason}\n${detail}`.slice(0, FAILURE_ANNOTATION_MAX_CHARS);
  console.log(`::error title=${escapeAnnotation(`${command} faalde`)}::${escapeAnnotation(message)}`);
}

let output = "";
const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
const child = spawn(executable, args, {
  shell: false,
  stdio: ["inherit", "pipe", "pipe"],
  env: { ...process.env, NODE_OPTIONS: withNodeHeapLimit(process.env.NODE_OPTIONS) },
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
    annotateFailure(output, null, signal);
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

  // Een soft skip houdt de run groen, maar mag niet onzichtbaar zijn: zonder
  // annotatie zag een volle database eruit als een geslaagde datarun.
  const annotateSoftSkip = (reason) => {
    if (process.env.GITHUB_ACTIONS === "true") {
      console.log(`::warning title=Neon soft skip::${reason}`);
    }
  };

  if (quotaExceeded) {
    const reason = "Neon quota of projectgrootte bereikt: data-job soft geskipt. R2-bewijs blijft staan; na herstel kan de volgende run opnieuw schrijven.";
    console.warn(`[ci-neon-safe] ${reason}`);
    annotateSoftSkip(reason);
    process.exit(0);
  }

  const transientNeonFailure =
    /NeonDbError: Error connecting to database/i.test(output) ||
    /TypeError: fetch failed/i.test(output) ||
    /connect E(?:ACCES|CONNRESET|TIMEDOUT|HOSTUNREACH)/i.test(output);

  if (transientNeonFailure) {
    const reason = "Neon/netwerk tijdelijk niet bereikbaar: data-job soft geskipt; de volgende georkestreerde run probeert opnieuw.";
    console.warn(`[ci-neon-safe] ${reason}`);
    annotateSoftSkip(reason);
    process.exit(0);
  }

  annotateFailure(output, code);
  process.exit(code || 1);
});
