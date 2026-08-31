function hasObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function hasPredictionFeatureContract(prediction, options = {}) {
  const minimumFeatureCount = Math.max(1, Number(options.minimumFeatureCount ?? 20));
  const vector = prediction?.featureVector || prediction?.features;
  const metadata = prediction?.featureSourceMetadata || prediction?.feature_source_metadata;
  return {
    vector: hasObject(vector) && Object.keys(vector).length >= minimumFeatureCount,
    metadata: hasObject(metadata) && hasObject(metadata.fields) && hasObject(metadata.coverage),
  };
}

export function evaluateFeaturePublication(predictions, options = {}) {
  const rows = (Array.isArray(predictions) ? predictions : []).filter(Boolean);
  const minimumCoverage = Number(options.minimumCoverage ?? 0.95);
  const minimumMetadataCoverage = Number(options.minimumMetadataCoverage ?? 0.90);
  const contracts = rows.map((prediction) => hasPredictionFeatureContract(prediction, options));
  const featureCoverage = rows.length ? contracts.filter((item) => item.vector).length / rows.length : 1;
  const metadataCoverage = rows.length ? contracts.filter((item) => item.metadata).length / rows.length : 1;
  const allowed = featureCoverage >= minimumCoverage && metadataCoverage >= minimumMetadataCoverage;
  return {
    allowed,
    predictions: rows.length,
    featureCoverage: Number(featureCoverage.toFixed(3)),
    metadataCoverage: Number(metadataCoverage.toFixed(3)),
    minimumCoverage,
    minimumMetadataCoverage,
    reason: allowed ? "feature-contract-ok" : "feature-contract-regression",
  };
}

export function assertFeaturePublication(predictions, options = {}) {
  const result = evaluateFeaturePublication(predictions, options);
  if (!result.allowed) {
    throw new Error(
      `[feature-publication-gate] publicatie geblokkeerd: features ${(result.featureCoverage * 100).toFixed(1)}%, ` +
      `bronmetadata ${(result.metadataCoverage * 100).toFixed(1)}% voor ${result.predictions} voorspellingen`,
    );
  }
  return result;
}
