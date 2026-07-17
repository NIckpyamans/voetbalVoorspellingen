function rowKey(row) {
  return String(row?.predictionId || `${row?.matchId || "unknown"}:${row?.generatedAt || "latest"}`);
}

function rowQuality(row) {
  return (row?.snapshotBacked ? 100 : 0) + (row?.label ? 10 : 0) + (row?.featureVector ? 5 : 0) + (row?.review ? 1 : 0);
}

export function mergeTrainingSnapshots(previous, next) {
  const rows = new Map();
  for (const row of [...(previous?.rows || []), ...(next?.rows || [])]) {
    const key = rowKey(row);
    const existing = rows.get(key);
    if (!existing || rowQuality(row) >= rowQuality(existing)) rows.set(key, row);
  }
  const mergedRows = [...rows.values()].sort((a, b) =>
    String(a?.date || "").localeCompare(String(b?.date || "")) || String(a?.matchId || "").localeCompare(String(b?.matchId || ""))
  );
  return {
    ...(previous || {}),
    ...(next || {}),
    generatedAt: new Date().toISOString(),
    reviewCount: Math.max(Number(previous?.reviewCount || 0), Number(next?.reviewCount || 0)),
    rows: mergedRows,
    preservation: {
      previousRows: previous?.rows?.length || 0,
      generatedRows: next?.rows?.length || 0,
      mergedRows: mergedRows.length,
      snapshotBackedRows: mergedRows.filter((row) => row?.snapshotBacked).length,
    },
  };
}
