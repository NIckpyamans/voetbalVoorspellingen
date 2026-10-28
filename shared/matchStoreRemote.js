// Publicatie en lectura van de compacte wedstrijdopslag buiten de repository.
//
// De opslag werd tot nu toe alleen als bestand in de repo gebouwd. Daarmee is de
// live worker (die uit Neon/R2 leest) niet dezelfde bron als de analyses. Deze
// module legt de objectstructuur en het manifest vast, zodat de opslag naar R2
// geschreven en daar met dezelfde validatie weer gelezen kan worden.
//
// De functies hier zijn puur; het uploaden en downloaden gebeurt in
// shared/cloudflare-r2.js (putR2Object/getR2Object).

export const REMOTE_STORE_PREFIX = "match-store";
export const REMOTE_STORE_SCHEMA = "match-store-v2";

export const REMOTE_STORE_KEYS = {
  store: `${REMOTE_STORE_PREFIX}/store.json`,
  index: `${REMOTE_STORE_PREFIX}/index.json`,
  manifest: `${REMOTE_STORE_PREFIX}/manifest.json`,
};

// Manifest dat naast de objecten ligt. Zonder dit bestand is een los
// store.json-bestand niet te vertrouwen: je weet dan niet bij welke brondata of
// welke telling het hoort.
export function buildStoreManifest({ store = {}, index = {}, publishedAt = null } = {}) {
  const matches = Object.keys(store.matches || {}).length;
  const teams = Object.keys(index.byTeam || {}).length;
  const pairs = Object.keys(index.byPair || {}).length;
  const indexedSlots = Object.values(index.byTeam || {})
    .reduce((sum, ids) => sum + (Array.isArray(ids) ? ids.length : 0), 0);
  return {
    schema: REMOTE_STORE_SCHEMA,
    publishedAt: publishedAt || new Date().toISOString(),
    matches,
    teams,
    pairs,
    // Elke wedstrijd levert twee teamslots (thuis en uit). Wijkt dit af, dan
    // hoort de index niet bij deze opslag.
    indexedSlots,
    indexMatchesStore: matches > 0 && indexedSlots === matches * 2,
    sourceFingerprint: store.src || null,
    keys: REMOTE_STORE_KEYS,
  };
}

export function parseStoreManifest(value) {
  let manifest = value;
  if (Buffer.isBuffer(value)) manifest = value.toString("utf8");
  if (typeof manifest === "string") {
    try {
      manifest = JSON.parse(manifest);
    } catch {
      return null;
    }
  }
  if (!manifest || typeof manifest !== "object") return null;
  if (manifest.schema !== REMOTE_STORE_SCHEMA) return null;
  if (!Number.isFinite(Number(manifest.matches))) return null;
  if (manifest.indexMatchesStore !== true) return null;
  return manifest;
}

// Leest de opslag uit R2 en weigert een object dat niet bij het manifest past.
// `get` is standaard getR2Object; in tests wordt een stub meegegeven.
export async function readRemoteMatchStore({ get, config, keys = REMOTE_STORE_KEYS } = {}) {
  if (typeof get !== "function") {
    return { ok: false, reason: "geen-reader" };
  }
  const manifestResult = await get({ config, key: keys.manifest });
  if (!manifestResult?.ok) {
    return { ok: false, reason: manifestResult?.reason || "manifest-ontbreekt" };
  }
  const manifest = parseStoreManifest(manifestResult.body);
  if (!manifest) return { ok: false, reason: "manifest-ongeldig" };

  const [storeResult, indexResult] = await Promise.all([
    get({ config, key: keys.store }),
    get({ config, key: keys.index }),
  ]);
  if (!storeResult?.ok || !indexResult?.ok) {
    return { ok: false, reason: "object-ontbreekt", manifest };
  }
  let store = null;
  let index = null;
  try {
    store = JSON.parse(Buffer.from(storeResult.body).toString("utf8"));
    index = JSON.parse(Buffer.from(indexResult.body).toString("utf8"));
  } catch {
    return { ok: false, reason: "object-onleesbaar", manifest };
  }
  if (!store?.matches || !index?.byTeam) {
    return { ok: false, reason: "object-structuur-ongeldig", manifest };
  }
  if (Object.keys(store.matches).length !== manifest.matches) {
    return { ok: false, reason: "manifest-wijkt-af", manifest };
  }
  return { ok: true, store, index, manifest };
}
