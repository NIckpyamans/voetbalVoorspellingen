import fs from "fs";
import path from "path";
import { normalizeTransfermarktClubName } from "./transfermarkt-dataset-utils.js";

export function fetchTransfermarktDatasetSquad({ teamName, root = process.cwd() }) {
  const file = path.join(root, "data", "transfermarkt-compact-profiles.json");
  if (!fs.existsSync(file)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    const profile = payload?.clubs?.[normalizeTransfermarktClubName(teamName)];
    if (!profile?.players?.length) return null;
    return {
      providerTeamId: profile.providerClubId,
      providerTeamName: profile.providerTeamName || teamName,
      players: profile.players,
    };
  } catch {
    return null;
  }
}
