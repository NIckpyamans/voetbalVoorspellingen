function positionFromMember(member, groupTitle) {
  const role = String(member?.role?.key || member?.role?.fallback || "").toLowerCase();
  const group = String(groupTitle || "").toLowerCase();
  const position = String(member?.positionIdsDesc || "").trim();
  if (position) return position;
  if (/keeper|goalkeeper/.test(`${role} ${group}`)) return "Goalkeeper";
  if (/defender|back/.test(`${role} ${group}`)) return "Defender";
  if (/midfield/.test(`${role} ${group}`)) return "Midfielder";
  if (/forward|attacker|striker|winger/.test(`${role} ${group}`)) return "Forward";
  return "";
}

export function parseFotMobSquad(payload) {
  const groups = Array.isArray(payload?.squad?.squad) ? payload.squad.squad : [];
  return groups.flatMap((group) => {
    if (/coach|manager|staff/i.test(String(group?.title || ""))) return [];
    return (Array.isArray(group?.members) ? group.members : []).map((member) => ({
      id: member?.id ? `fotmob:${member.id}` : "",
      name: String(member?.name || "").trim(),
      position: positionFromMember(member, group.title),
      shirtNumber: member?.shirtNumber ?? null,
      nationality: String(member?.cname || member?.ccode || "").trim(),
      dateBorn: member?.dateOfBirth || null,
      rating: Number(member?.rating || 0) || null,
      marketValueEur: Number(member?.transferValue || 0) || null,
      status: member?.injury ? "geblesseerd" : "beschikbaar",
      availability: member?.injury ? "geblesseerd" : "beschikbaar",
      injury: member?.injury || null,
      loan: false,
      source: "FotMob",
      sources: ["FotMob"],
    })).filter((player) => player.name && player.position);
  });
}

export async function fetchFotMobSquad({ teamName, teamIds = [], fetchJson }) {
  if (typeof fetchJson !== "function") return null;
  const fotmobId = [...teamIds]
    .map((value) => String(value || ""))
    .map((value) => value.match(/(?:fotmob[:-])?(\d+)/i)?.[1] || "")
    .find(Boolean);
  if (!fotmobId) return null;
  const payload = await fetchJson(`https://www.fotmob.com/api/data/teams?id=${encodeURIComponent(fotmobId)}`);
  const players = parseFotMobSquad(payload);
  if (!players.length) return null;
  return {
    providerTeamId: fotmobId,
    providerTeamName: String(payload?.details?.name || payload?.details?.teamName || teamName),
    players,
  };
}
