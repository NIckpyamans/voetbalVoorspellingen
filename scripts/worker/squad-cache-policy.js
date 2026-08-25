function rosterTimestamp(profile) {
  if (!profile) return 0;
  return Math.max(
    Number(profile.rosterSourceCheckedAt || 0),
    Date.parse(profile.fetchedAt || profile.checkedAt || "") || 0,
  );
}

export function selectFreshestSquadProfile(idProfile, nameProfile) {
  if (!idProfile) return nameProfile || null;
  if (!nameProfile) return idProfile;
  const idRosterAt = rosterTimestamp(idProfile);
  const nameRosterAt = rosterTimestamp(nameProfile);
  if (nameRosterAt !== idRosterAt) return nameRosterAt > idRosterAt ? nameProfile : idProfile;
  return Number(nameProfile.lastComputedAt || 0) > Number(idProfile.lastComputedAt || 0) ? nameProfile : idProfile;
}
