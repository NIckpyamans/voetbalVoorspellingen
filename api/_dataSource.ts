const REPO_RAW_BASE = "https://raw.githubusercontent.com/NIckpyamans/voetbalVoorspellingen";
const DATA_CACHE_TTL_MS = Number(process.env.DATA_CACHE_TTL_MS || 60_000);

type CachedJson = {
  ts: number;
  data: any;
  branch: string;
  sourceUrl: string;
};

const jsonCache = new Map<string, CachedJson>();

function readCache(key: string) {
  const cached = jsonCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.ts > DATA_CACHE_TTL_MS) {
    jsonCache.delete(key);
    return null;
  }
  return cached;
}

function writeCache(key: string, value: Omit<CachedJson, "ts">) {
  const cached = { ...value, ts: Date.now() };
  jsonCache.set(key, cached);
  return cached;
}

function unique(values: Array<string | undefined | null>) {
  return [...new Set(values.filter(Boolean) as string[])];
}

function candidateBranches() {
  const explicitDataBranch = process.env.DATA_BRANCH;
  const deployBranch = process.env.VERCEL_GIT_COMMIT_REF;

  // Production currently still deploys from main sometimes, while the freshest
  // worker data lives on the active Codex branch. Prefer that data branch before
  // the deploy branch, otherwise Vercel can accidentally read stale main data.
  return unique([
    explicitDataBranch,
    "codex/step3b-layout",
    deployBranch,
    "main",
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
  const cached = readCache("server_data.json");
  if (cached) {
    return {
      store: cached.data,
      branch: cached.branch,
      sourceUrl: cached.sourceUrl,
      cached: true,
    };
  }

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
        const cachedStore = writeCache("server_data.json", {
          data: store,
          branch,
          sourceUrl: baseUrl,
        });
        return { store: cachedStore.data, branch, sourceUrl: baseUrl, cached: false };
      } catch (err: any) {
        lastError = `${branch}: ${err?.message || "unknown fetch error"}`;
      }
    }
  }

  throw new Error(lastError || "Kon server_data.json niet ophalen");
}

export async function fetchRepoJson(relativePath: string) {
  const cached = readCache(relativePath);
  if (cached) {
    return {
      data: cached.data,
      branch: cached.branch,
      sourceUrl: cached.sourceUrl,
      cached: true,
    };
  }

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
        const data = await response.json();
        const cachedJson = writeCache(relativePath, { data, branch, sourceUrl: url });
        return { data: cachedJson.data, branch, sourceUrl: url, cached: false };
      } catch (err: any) {
        lastError = `${branch}: ${err?.message || "unknown fetch error"}`;
      }
    }
  }

  throw new Error(lastError || `Kon ${relativePath} niet ophalen`);
}

export async function fetchDayData(dateKey: string) {
  return fetchRepoJson(`data/days/${dateKey}.json`);
}

export async function fetchMetaData() {
  return fetchRepoJson("data/meta.json");
}

export async function fetchStandingsData() {
  return fetchRepoJson("data/standings.json");
}
