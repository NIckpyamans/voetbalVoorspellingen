export function standingLabel(league = "") {
  const label = String(league || "");
  if (label === "Europe - Champions League") return "UCL";
  if (label === "Europe - Europa League") return "UEL";
  if (label === "Europe - Conference League") return "UECL";
  const country = label.split(" - ")[0];
  const countryCodes = { Netherlands: "NL", England: "ENG", Germany: "DE", France: "FR" };
  return countryCodes[country] || country.slice(0, 3).toUpperCase();
}
