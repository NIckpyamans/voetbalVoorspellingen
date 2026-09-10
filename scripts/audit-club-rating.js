import fs from "node:fs";
import { predict, buildPossibleNames } from "./server-worker.js";
import { buildClubStrengthProfile, lookupClubEloProfile, domesticCompetitionStrength } from "./worker/club-strength.js";

const date = process.argv[2] || new Date().toISOString().slice(0,10);
const asOf = new Date().toISOString();
const snapshot = JSON.parse(fs.readFileSync("data/club-elo-snapshot.json", "utf8"));
const squads = JSON.parse(fs.readFileSync("data/team-squad-cache.json", "utf8")).teams;
const day = JSON.parse(fs.readFileSync(`data/days/${date}.json`, "utf8"));
const standings = JSON.parse(fs.readFileSync("data/standings.json", "utf8")).standings;
const rows = [];
for (const match of day.matches || []) {
  // Current source data must never be backdated into completed-match evidence.
  if (Date.parse(match.kickoff) <= Date.parse(asOf) || match.status !== "NS") continue;
  const input = structuredClone(match);
  for (const side of ["home", "away"]) {
    const name = match[`${side}TeamName`];
    const clubEloProfile = lookupClubEloProfile(snapshot, name, buildPossibleNames);
    const squadProfile = buildPossibleNames(name).map(key => squads[`name:${key}`]).find(Boolean) || match[`${side}TeamProfile`]?.squad;
    const leagueProfile = domesticCompetitionStrength(snapshot,standings,match[`${side}TeamId`],name,buildPossibleNames,asOf);
    const strength = buildClubStrengthProfile({snapshot, clubEloProfile, squadProfile, asOf, leagueProfile});
    input[`${side}ClubStrength`] = strength;
    input[`${side}ClubElo`] = clubEloProfile?.elo ?? null;
    input[`${side}TeamProfile`] = { ...input[`${side}TeamProfile`], squadRating: strength.rating, teamStrengthRating: strength.rating };
  }
  const result = predict(input);
  if (![result.homeProb,result.drawProb,result.awayProb,result.homeXG,result.awayXG].every(Number.isFinite)) throw new Error(`Non-finite prediction: ${match.id}`);
  if (Math.abs(result.homeProb+result.drawProb+result.awayProb-1)>0.001) throw new Error(`Invalid probability sum: ${match.id}`);
  rows.push({id:match.id,home:match.homeTeamName,away:match.awayTeamName,
    homeRating:input.homeClubStrength,awayRating:input.awayClubStrength,
    before:{storedPredictionId:match.predictionId,generatedAt:match.predictionGeneratedAt,homeRating:match.homeClubStrength?.rating,awayRating:match.awayClubStrength?.rating},
    replay:{score:`${result.predHomeGoals}-${result.predAwayGoals}`,homeProb:result.homeProb,drawProb:result.drawProb,awayProb:result.awayProb,homeXG:result.homeXG,awayXG:result.awayXG,signal:result.modelEdges.clubRating}});
}
const report = {generatedAt:asOf,date,method:"Current-input diagnostic replay; not an out-of-sample accuracy backtest",checked:rows.length,rows};
fs.writeFileSync("monitor/club-rating-validation.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({checked:rows.length,examples:rows.filter(r=>/Bayern|Manchester United/.test(r.home)).map(r=>({home:r.home,away:r.away,homeRating:r.homeRating.rating,awayRating:r.awayRating.rating,before:r.before,replay:r.replay}))},null,2));
