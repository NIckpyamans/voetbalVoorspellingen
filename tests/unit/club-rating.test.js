import { isSeniorInternationalTournament, predict } from "../../scripts/server-worker.js";
import { describe, it, expect } from "vitest";
import { calculateClubRating, squadValueEvidence, competitionStrength, clubRatingMatchSignal } from "../../scripts/worker/club-rating.js";
import { parseClubEloWebsite, domesticCompetitionStrength } from "../../scripts/worker/club-strength.js";
import { buildOutcomeEnsemble } from "../../scripts/worker/outcome-ensemble.js";
const asOf = "2026-09-10T12:00:00Z";
const squad = (value, rating = 7) => ({ fetchedAt: asOf, source: "fixture", players: Array.from({length:24},(_,i)=>({id:`p${i}`,name:`Player ${i}`,marketValueEur:value,rating})) });
const club = (value, elo, league = 70) => calculateClubRating({asOf, squadProfile:squad(value),clubEloProfile:{elo,asOf},leagueProfile:{rating:league,asOf,source:"fixture"}});
describe("club rating v2",()=>{
  it("compares absolute player value across clubs, independently of domestic form",()=>{
    const strong=club(30000000,1950,75), weak=club(1000000,1550,45);
    expect(strong.rating).toBeGreaterThan(weak.rating+20);
    expect(club(40000000,1950,75).rating).toBeGreaterThan(strong.rating);
    expect(clubRatingMatchSignal(strong,weak).homeMultiplier).toBeGreaterThan(1);
  });
  it("does not manufacture player values or reward a single priced star",()=>{
    const partial=squad(null); partial.players[0].marketValueEur=200000000;
    expect(squadValueEvidence(partial).valueRating).toBeNull();
    const p=calculateClubRating({asOf,squadProfile:partial});
    expect(p.rating).toBeNull();
    expect(p.missing).toContain("voldoende actuele spelerswaarden");
  });
  it("retains a labelled lower-coverage Elo rating when squad values are missing",()=>{
    const p=calculateClubRating({asOf,clubEloProfile:{elo:1600,asOf},squadProfile:squad(null)});
    expect(p.rating).toBe(60); expect(p.reliability).toBe(0.35);
    expect(p.valueEvidence.totalValueEur).toBeNull();
  });
  it("rejects stale and future evidence",()=>{
    for(const fetchedAt of ["2025-01-01","2026-10-01"]){
      const p=calculateClubRating({asOf,squadProfile:{...squad(30000000),fetchedAt},clubEloProfile:{elo:2100,asOf:fetchedAt}});
      expect(p.rating).toBeNull();
    }
  });
  it("deduplicates a player before summing value",()=>{
    const s=squad(1000000);s.players.push({...s.players[0]});
    expect(squadValueEvidence(s).totalValueEur).toBe(24000000);
  });
  it("makes equally performing players comparable through league context",()=>{
    const a=club(3000000,1700,80),b=club(3000000,1700,40);
    expect(a.rating).toBeGreaterThan(b.rating);
  });
  it("labels country proxies and does not infer a league from a tiny sample",()=>{
    const profiles=Object.fromEntries(Array.from({length:20},(_,i)=>[i,{club:`Club ${i}`,country:"ENG",elo:1900-i*10,level:null}]));
    expect(competitionStrength({profiles,asOf},{country:"ENG"})).toMatchObject({teams:16,method:"country-top16-median-proxy"});
    expect(competitionStrength({profiles:{a:profiles[0]},asOf},{country:"ENG"})).toBeNull();
  });
  it("uses symmetric bounded goal adjustments and no invented missing opponent",()=>{
    const a=club(40000000,2000),b=club(1000000,1500);
    const ab=clubRatingMatchSignal(a,b),ba=clubRatingMatchSignal(b,a);
    expect(ab.homeMultiplier).toBeCloseTo(ba.awayMultiplier);
    expect(ab.homeMultiplier*ab.awayMultiplier).toBeCloseTo(1);
    expect(ab.homeMultiplier).toBeLessThanOrEqual(Math.exp(.6));
    expect(clubRatingMatchSignal(a,{rating:null})).toBeNull();
  });
  it("does not add ClubElo as a second ensemble component when the composite is active",()=>{
    const e=buildOutcomeEnsemble({homeElo:2000,awayElo:1600,featureVector:{club_rating_active:1,club_rating_reliability:1,home_squad_rating:85,away_squad_rating:50}});
    expect(e.components.find(c=>c.key==='club_elo').active).toBe(false);
    expect(e.components.find(c=>c.key==='squad_strength').active).toBe(true);
  });
  it("parses literal ranking data with provenance without executing page scripts",()=>{
    const html=`<h1><a href="/2026-09-10/Ranking"></a></h1><script>const eloData = [['<td><img alt="AZE"><small>452</small><a>Sabah FK</a></td>', '1563', '0', '1']]; throw new Error('never execute');</script>`;
    expect(parseClubEloWebsite(html)?.profiles['sabah fk']).toMatchObject({elo:1563,country:"AZE",asOf:"2026-09-10"});
    expect(parseClubEloWebsite(html.replace("2026-09-10", "unknown"))).toBeNull();
  });
});

describe("club prediction integration", () => {
  it("keeps club competitions out of the national-team path", () => {
    for (const name of ["Europe - Champions League", "England - Premier League", "World - Club World Cup", "Europe - Europa League"]) expect(isSeniorInternationalTournament(name)).toBe(false);
    for (const name of ["World Cup", "UEFA Nations League", "International Friendlies"]) expect(isSeniorInternationalTournament(name)).toBe(true);
  });
  it("actually changes both goals and probabilities when club strength changes", () => {
    const recent={gamesPlayed:10,wins:5,draws:3,avgScored:1.5,avgConceded:1.2};
    const input={league:"Europe - Champions League",leagueType:"cup",homeTeamName:"Home",awayTeamName:"Away",homeRecent:recent,awayRecent:recent,homeTeamProfile:{},awayTeamProfile:{},homeClubStrength:club(3000000,1700),awayClubStrength:club(3000000,1700)};
    const equal=predict(input);
    const stronger=predict({...input,homeClubStrength:club(30000000,2000)});
    expect(stronger.modelEdges.clubRating).not.toBeNull();
    expect(stronger.homeXG).toBeGreaterThan(equal.homeXG);
    expect(stronger.homeProb).toBeGreaterThan(equal.homeProb);
    expect(stronger.awayXG).toBeLessThan(equal.awayXG);
  });
});

describe("domestic competition membership",()=>{
  it("uses the actual division rather than stronger clubs elsewhere in the country",()=>{
    const profiles=Object.fromEntries(Array.from({length:12},(_,i)=>[`club ${i}`,{club:`club ${i}`,elo:i<6?1900:1400,country:"ENG"}]));
    const table={label:"England - Championship",updated:Date.parse(asOf),rows:Array.from({length:6},(_,i)=>({team:`club ${i+6}`,teamId:`id${i+6}`}))};
    const p=domesticCompetitionStrength({profiles,asOf},{table},"id6","club 6",null,asOf);
    expect(p).toMatchObject({rating:40,teams:6,method:"domestic-membership-median"});
    expect(domesticCompetitionStrength({profiles,asOf},{table:{...table,label:"Europe - Champions League"}},"id6","club 6",null,asOf)).toBeNull();
  });
});
