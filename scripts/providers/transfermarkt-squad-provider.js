import fs from "fs";
import path from "path";
import { normalizeClubName } from "../sync-transfermarkt-datasets.js";

export function fetchTransfermarktDatasetSquad({ teamName, root = process.cwd() }) {
  const file = path.join(root, "data", "transfermarkt-compact-profiles.json");
  if (!fs.existsSync(file)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    const profile = payload?.clubs?.[normalizeClubName(teamName)];
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
