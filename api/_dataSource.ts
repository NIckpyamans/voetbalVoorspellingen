const REPO_RAW_BASE = "https://raw.githubusercontent.com/NIckpyamans/voetbalVoorspellingen";

function unique(values: Array<string | undefined | null>) {
  return [...new Set(values.filter(Boolean) as string[])];
}

function candidateBranches() {
  const explicitDataBranch = process.env.DATA_BRANCH;
  const deployBranch = process.env.VERCEL_GIT_COMMIT_REF;

  // Scheduled GitHub Actions only run automatically on the default branch.
  // Production deployments can come from a feature branch, but live match data
  // must still prefer the branch that the worker refreshes every 10 minutes.
  return unique([
    explicitDataBranch,
    "main",
    deployBranch,
    "codex/step3b-layout",
  ]);
}

function urlsForBranchPath(branch: string, relativePath: string) {
  return branch.includes("/")
    ? [
        `${REPO_RAW_BASE}/refs/heads/${branch}/${relativePath}`,
        `${REPO_RAW_BASE}/${branch}/${relativePath}`,
      ]
    : [`${REPO_RAW_BASE}/${branch}/${relativePath}`];
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

export async function fetchRepoJson(relativePath: string) {
  const branches = candidateBranches();
  let lastError: string | null = null;

  for (const branch of branches) {
    for (const url of urlsForBranchPath(branch, relativePath)) {
      try {
        const response = await fetch(`${url}?t=${Date.now()}`, {
          headers: { "Cache-Control": "no-cache" },
        });
        if (!response.ok) {
          lastError = `${branch}: GitHub ${response.status}`;
          continue;
        }
        return { data: await response.json(), branch, sourceUrl: url };
      } catch (err: any) {
        lastError = `${branch}: ${err?.message || "unknown fetch error"}`;
      }
    }
  }

  throw new Error(lastError || `Kon ${relativePath} niet ophalen`);
}
