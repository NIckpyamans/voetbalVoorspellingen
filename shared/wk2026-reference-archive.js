export function buildWk2026ReferenceManifest({ sourceUrl, capturedAt, datasets }) {
  return {
    schemaVersion: "wk2026-orakel-reference-v1",
    capturedAt,
    source: {
      url: sourceUrl,
      kind: "public-static-data",
      usage: "reference_only",
      policy: "Do not treat imported ratings, predictions, squads or source claims as independently verified. The club-only prediction pipeline must not consume this archive.",
    },
    datasets,
  };
}
