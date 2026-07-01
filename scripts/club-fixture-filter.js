export const CLUB_ONLY_FIXTURE_WHERE = `
  and m.identity_status = 'resolved'
  and m.home_club_id is not null
  and m.away_club_id is not null
  and coalesce(m.league, '') !~* '(world|fifa|international|friendl|national team|nations league|euro qualification|world cup)'
  and coalesce(m.home_team_name, '') !~* '(\\bu-?\\d{2}\\b|women|national)'
  and coalesce(m.away_team_name, '') !~* '(\\bu-?\\d{2}\\b|women|national)'
`;

