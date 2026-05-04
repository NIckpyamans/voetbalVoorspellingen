const REPO_RAW_BASE = "https://raw.githubusercontent.com/NIckpyamans/voetbalVoorspellingen";

function unique(values: Array<string | undefined | null>) {
  return [...new Set(values.filter(Boolean) as string[])];
}

function candidateBranches() {
  return unique([
    process.env.DATA_BRANCH,
    process.env.VERCEL_GIT_COMMIT_REF,
    "codex/step3b-layout",
    "main",
  ]);
}

function urlsForBranch(branch: string) {
  return branch.includes("/")
    ? [
        `${REPO_RAW_BASE}/refs/heads/${branch}/server_data.json`,
        `${REPO_RAW_BASE}/${branch}/server_data.json`,
      ]
    : [`${REPO_RAW_BASE}/${branch}/server_data.json`];
}

export async function fetchServerStore() {
  const branches = candidateBranches();
  let lastError: string | null = null;

  for (const branch of branches) {
    for (const baseUrl of urlsForBranch(branch)) {
      try {
        const response = await fetch(`${baseUrl}?t=${Date.now()}`, {
          headers: { "Cache-Control": "no-cache" },
        });
        if (!response.ok) {
          lastError = `${branch}: GitHub ${response.status}`;
          continue;
        }

        const store = await response.json();
        return { store, branch, sourceUrl: baseUrl };
      } catch (err: any) {
        lastError = `${branch}: ${err?.message || "unknown fetch error"}`;
      }
    }
  }

  throw new Error(lastError || "Kon server_data.json niet ophalen");
}
