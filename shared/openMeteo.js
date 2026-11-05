const HOURLY_FIELDS = "temperature_2m,precipitation,weather_code,wind_speed_10m";
// De forecast-API dekt ongeveer 90 dagen terug tot 15 dagen vooruit. Buiten dat
// venster heeft alleen het archief data; andersom geeft het archief niets voor
// wedstrijden die nog moeten spelen.
const FORECAST_PAST_DAYS = 90;
const FORECAST_FUTURE_DAYS = 15;

function dayStartMs(value) {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

export function openMeteoUrl({
  latitude,
  longitude,
  dateKey,
  now = new Date(),
  forceArchive = false,
  includeProbability = false,
} = {}) {
  const date = String(dateKey || "").slice(0, 10);
  const target = dayStartMs(date);
  const today = dayStartMs(now.toISOString().slice(0, 10));
  const daysAhead = target !== null && today !== null ? Math.round((target - today) / 86400000) : null;
  const useForecast =
    !forceArchive && daysAhead !== null && daysAhead >= -FORECAST_PAST_DAYS && daysAhead <= FORECAST_FUTURE_DAYS;
  const host = useForecast ? "api.open-meteo.com" : "archive-api.open-meteo.com";
  const endpoint = useForecast ? "forecast" : "archive";
  // precipitation_probability bestaat alleen in de forecast-API; het archief
  // weigert het veld, dus daar blijft het weg.
  const hourly = includeProbability && useForecast ? `${HOURLY_FIELDS},precipitation_probability` : HOURLY_FIELDS;
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: date,
    end_date: date,
    hourly,
    timezone: "UTC",
  });
  return `https://${host}/v1/${endpoint}?${params.toString()}`;
}

// Eén definitie van het weerrisico voor de worker, de import en de terugval op
// de database. Het archief levert geen neerslagkans; val daar terug op de
// hoeveelheid (mm), zodat een oude wedstrijd niet stil "laag risico" krijgt.
export function weatherRiskLevel(weather = {}) {
  const wind = Number(weather?.windSpeed ?? 0);
  const precipitation = Number(weather?.precipitation ?? 0);
  const probability = weather?.precipitationProbability;
  const hasProbability = probability !== null && probability !== undefined && probability !== "";
  const wetHigh = hasProbability ? Number(probability) >= 70 : precipitation >= 4;
  const wetMedium = hasProbability ? Number(probability) >= 50 : precipitation >= 1;
  if (wind >= 28 || wetHigh) return "high";
  if (wind >= 20 || wetMedium) return "medium";
  return "low";
}
