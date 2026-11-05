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

export function openMeteoUrl({ latitude, longitude, dateKey, now = new Date(), forceArchive = false } = {}) {
  const date = String(dateKey || "").slice(0, 10);
  const target = dayStartMs(date);
  const today = dayStartMs(now.toISOString().slice(0, 10));
  const daysAhead = target !== null && today !== null ? Math.round((target - today) / 86400000) : null;
  const useForecast =
    !forceArchive && daysAhead !== null && daysAhead >= -FORECAST_PAST_DAYS && daysAhead <= FORECAST_FUTURE_DAYS;
  const host = useForecast ? "api.open-meteo.com" : "archive-api.open-meteo.com";
  const endpoint = useForecast ? "forecast" : "archive";
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: date,
    end_date: date,
    hourly: HOURLY_FIELDS,
    timezone: "UTC",
  });
  return `https://${host}/v1/${endpoint}?${params.toString()}`;
}
