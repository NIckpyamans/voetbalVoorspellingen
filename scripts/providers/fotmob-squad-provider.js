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

import {
  expectedLeagueKeys,
  isInternationalCompetitionLabel,
  providerLeagueMatches,
  providerTeamMatchesAliases,
} from "../worker/squad-team-matching.js";

const FOTMOB_SEARCH_URL = (term) => `https://www.fotmob.com/api/data/search/suggest?term=${encodeURIComponent(term)}`;
const FOTMOB_TEAM_URL = (id) => `https://www.fotmob.com/api/data/teams?id=${encodeURIComponent(id)}`;

function normalizeId(value) {
  return String(value || "").match(/(?:fotmob[:-])?(\d+)/i)?.[1] || "";
}

// Het zoek-endpoint levert een lijst groepen, maar soms één groep als object.
// Beide vormen moeten werken, anders vindt de provider bij zo'n respons geen
// enkel team en valt de hele verrijking terug naar de oude dekking.
function searchSuggestions(payload) {
  const groups = Array.isArray(payload) ? payload : payload ? [payload] : [];
  return groups.flatMap((group) => (Array.isArray(group?.suggestions) ? group.suggestions : []));
}

export function findExactFotMobTeam(payload, teamName, options = {}) {
  const expectedLeagues = Array.isArray(options.expectedLeagues) ? options.expectedLeagues : [];
  const suggestions = searchSuggestions(payload)
    .filter((item) => item?.type === "team" && item?.id && providerTeamMatchesAliases(item?.name, teamName));
  if (!expectedLeagues.length) return suggestions[0] || null;
  // Competitiegate: een gelijknamige club uit een andere competitie (Red Star
  // Belgrado voor Red Star FC 93) mag deze selectie niet leveren.
  const inCompetition = suggestions.filter((item) =>
    !isInternationalCompetitionLabel(item?.leagueName) && providerLeagueMatches(item?.leagueName, expectedLeagues)
  );
  if (inCompetition.length) return inCompetition[0];
  // Zonder nationale competitie in het zoekresultaat is de clubnaam het enige
  // bewijs; dan niet blokkeren.
  return suggestions.find((item) => !item?.leagueName || isInternationalCompetitionLabel(item.leagueName)) || null;
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

// Competitienamen die FotMob zelf over dit team levert. De fixtures-payload
// gebruikt dezelfde endpoint-data als de vormprovider, dus dit is een
// betrouwbare tweede bron naast de zoeksuggestie.
export function fotmobTeamLeagueNames(payload) {
  const fixtures = payload?.fixtures?.allFixtures?.fixtures || payload?.fixtures?.fixtures || [];
  return [...new Set(
    (Array.isArray(fixtures) ? fixtures : [])
      .map((fixture) => String(fixture?.tournament?.name || "").trim())
      .filter(Boolean)
  )];
}

function verifiedIdentity(payloadName, leagueNames, teamName, expectedLeagues) {
  if (payloadName && !providerTeamMatchesAliases(payloadName, teamName)) {
    return { ok: false, reason: "team_name_mismatch" };
  }
  // Alleen nationale competities zijn bruikbaar bewijs: bij een Champions
  // League-wedstrijd noemt FotMob soms alleen het continentale toernooi.
  const domesticLeagues = leagueNames.filter((name) => !isInternationalCompetitionLabel(name));
  if (expectedLeagues.length && domesticLeagues.length && !domesticLeagues.some((name) => providerLeagueMatches(name, expectedLeagues))) {
    // Alleen weigeren bij aantoonbare tegenspraak; ontbrekende competitiedata is
    // geen bewijs dat de club niet klopt.
    return { ok: false, reason: "competition_mismatch" };
  }
  return { ok: true, reason: null };
}

// identityVerified: het zoekresultaat is al op clubnaam én competitie
// gecontroleerd, dus de payload hoeft dat niet te herhalen.
async function loadFotMobTeam({ fotmobId, teamName, fetchJson, expectedLeagues, searchLeagueName = "", identityVerified = false }) {
  const payload = await fetchJson(FOTMOB_TEAM_URL(fotmobId));
  if (!payload) return null;
  const payloadName = String(payload?.details?.name || payload?.details?.teamName || "").trim();
  const leagueNames = [searchLeagueName, ...fotmobTeamLeagueNames(payload)].filter(Boolean);
  if (!identityVerified) {
    const identity = verifiedIdentity(payloadName, leagueNames, teamName, expectedLeagues);
    if (!identity.ok) return null;
  }
  const players = parseFotMobSquad(payload);
  if (!players.length) return null;
  return {
    providerTeamId: fotmobId,
    providerTeamName: payloadName || teamName,
    providerLeagueName: leagueNames[0] || null,
    players,
  };
}

export async function fetchFotMobSquad({ teamName, teamIds = [], competitions = [], fetchJson }) {
  if (typeof fetchJson !== "function") return null;
  const expectedLeagues = expectedLeagueKeys(competitions);
  const providedId = [...teamIds].map(normalizeId).find(Boolean) || "";
  // Een fixture-ID uit de dagdata kan naar een andere club wijzen (Monza bij AS
  // Roma). Verifieer hem; klopt hij niet, val terug op een zoekopdracht op naam
  // in plaats van de hele provider als "niet gevonden" te laten eindigen.
  if (providedId) {
    const fromId = await loadFotMobTeam({ fotmobId: providedId, teamName, fetchJson, expectedLeagues });
    if (fromId) return fromId;
  }
  if (!teamName) return null;
  const searchPayload = await fetchJson(FOTMOB_SEARCH_URL(teamName));
  const match = findExactFotMobTeam(searchPayload, teamName, { expectedLeagues });
  const fotmobId = normalizeId(match?.id);
  if (!fotmobId || fotmobId === providedId) return null;
  return loadFotMobTeam({
    fotmobId,
    teamName,
    fetchJson,
    expectedLeagues,
    searchLeagueName: String(match?.leagueName || ""),
    identityVerified: true,
  });
}
