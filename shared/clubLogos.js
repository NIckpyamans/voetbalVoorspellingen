const CLUB_ALIAS_MAP = new Map([
  ["ararat armenia", "FC Ararat-Armenia"],
  ["ararat-armenia", "FC Ararat-Armenia"],
  ["rigas", "Rigas Futbola Skola"],
  ["rfs", "Rigas Futbola Skola"],
  ["kauno zalgiris", "FK Kauno Zalgiris"],
  ["kauno zhalgiris", "FK Kauno Zalgiris"],
  ["drita", "FC Drita"],
  ["una strassen", "FC UNA Strassen"],
  ["la fiorita", "SP La Fiorita"],
  ["af elbasani", "AF Elbasani"],
  ["bate", "BATE Borisov"],
  ["ajax amsterdam", "Ajax"],
  ["fc twente", "Twente"],
  ["aberdeen fc", "Aberdeen"],
  ["panathinaikos", "Panathinaikos"],
  ["psg", "Paris Saint-Germain"],
  ["paris sg", "Paris Saint-Germain"],
  ["paris saint germain", "Paris Saint-Germain"],
  ["man city", "Manchester City"],
  ["fc barcelona", "Barcelona"],
  ["barca", "Barcelona"],
]);

export function normalizeClubName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(club de football|football club|voetbalvereniging|voetbal club)\b/g, " ")
    .replace(/\b(fc|cf|afc|sc|ac|as|cd|fk|bk|ik|if|sv|vfl|vfb|sk|sp|ks|kf|nk|rc|club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isGeneratedLogoUrl(url) {
  const text = String(url || "");
  if (!text) return true;
  return (
    text.startsWith("data:image/svg+xml") ||
    /generated|placeholder|fallback|initial/i.test(text)
  );
}

export function logoLookupNames(teamName) {
  const raw = String(teamName || "").trim();
  const normalized = normalizeClubName(raw);
  const candidates = new Set([raw]);
  if (CLUB_ALIAS_MAP.has(normalized)) candidates.add(CLUB_ALIAS_MAP.get(normalized));
  if (normalized) {
    candidates.add(normalized);
    candidates.add(normalized.replace(/\b(fc|cf|sc|afc|fk|bk|sk)\b/g, "").replace(/\s+/g, " ").trim());
  }
  if (/^fc\s+/i.test(raw)) candidates.add(raw.replace(/^fc\s+/i, ""));
  if (/\s+fc$/i.test(raw)) candidates.add(raw.replace(/\s+fc$/i, ""));
  return [...candidates].map((item) => String(item || "").trim()).filter(Boolean);
}
