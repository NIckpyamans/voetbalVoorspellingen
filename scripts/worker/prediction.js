export const PREDICTION_MODULE = {
  name: "prediction",
  owns: ["feature vector construction", "Poisson score matrix", "ensemble probabilities", "confidence calibration"],
};

export function factorial(n) {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
}

export function poisson(lambda, k) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

export function dixonColesAdjustment(h, a, homeXG, awayXG, rho = -0.13) {
  if (h === 0 && a === 0) return 1 - homeXG * awayXG * rho;
  if (h === 0 && a === 1) return 1 + homeXG * rho;
  if (h === 1 && a === 0) return 1 + awayXG * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

export function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
