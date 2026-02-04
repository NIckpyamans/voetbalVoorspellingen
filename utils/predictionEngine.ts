
import { Team, Prediction } from '../types';

export function poisson(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function factorial(n: number): number {
  if (n === 0 || n === 1) return 1;
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

export function generateScoreMatrix(hxg: number, axg: number) {
  const matrix: { [key: string]: number } = {};
  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      matrix[`${h}-${a}`] = poisson(hxg, h) * poisson(axg, a);
    }
  }
  return matrix;
}

/**
 * Geavanceerde berekening met Form en Elo weging
 */
export function calculatePrediction(home: Team, away: Team): Prediction {
  const homeAdv = 1.18; // Licht verhoogd voor modern thuisvoordeel
  const avgLeagueGoals = 1.35;
  
  // Bereken Form Factor (W=1.2, D=1.0, L=0.8)
  const calculateFormModifier = (form?: string) => {
    if (!form) return 1.0;
    const points = form.split('').reduce((acc, char) => {
      if (char === 'W') return acc + 1.2;
      if (char === 'D') return acc + 1.0;
      return acc + 0.8;
    }, 0);
    return points / form.length;
  };

  const homeFormMod = calculateFormModifier(home.form);
  const awayFormMod = calculateFormModifier(away.form);

  // xG berekening met Form integratie
  const homeXG = avgLeagueGoals * (home.attack / away.defense) * homeAdv * homeFormMod;
  const awayXG = avgLeagueGoals * (away.attack / home.defense) * awayFormMod;
  
  const matrix = generateScoreMatrix(homeXG, awayXG);
  
  let homeProb = 0;
  let drawProb = 0;
  let awayProb = 0;
  let bestScore = '1-1';
  let maxScoreProb = 0;

  Object.entries(matrix).forEach(([score, prob]) => {
    const [h, a] = score.split('-').map(Number);
    if (h > a) homeProb += prob;
    else if (h < a) awayProb += prob;
    else drawProb += prob;

    if (prob > maxScoreProb) {
      maxScoreProb = prob;
      bestScore = score;
    }
  });

  const [predH, predA] = bestScore.split('-').map(Number);
  const eloDiff = Math.abs(home.elo - away.elo);
  
  // Confidence nu ook gebaseerd op de consistentie van de vorm
  const confidence = Math.min(0.98, (maxScoreProb * 2.5) + (eloDiff / 3500) + (Math.abs(homeFormMod - awayFormMod) / 5));

  return {
    matchId: '', 
    homeProb,
    drawProb,
    awayProb,
    homeXG,
    awayXG,
    predHomeGoals: predH,
    predAwayGoals: predA,
    exactProb: maxScoreProb,
    confidence
  };
}
