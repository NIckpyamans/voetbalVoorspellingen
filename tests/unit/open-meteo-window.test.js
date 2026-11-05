import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { openMeteoUrl, weatherRiskLevel } from "../../shared/openMeteo.js";

const ROOT = process.cwd();
const NOW = new Date("2026-11-05T09:00:00Z");

describe("open-meteo endpoint window", () => {
  it("vraagt de forecast-API voor een wedstrijd die nog moet spelen", () => {
    const url = openMeteoUrl({ latitude: 51.9, longitude: 4.4, dateKey: "2026-11-08", now: NOW });
    expect(url).toContain("//api.open-meteo.com/v1/forecast?");
    expect(url).toContain("start_date=2026-11-08");
    expect(url).toContain("end_date=2026-11-08");
  });

  it("houdt recente wedstrijden op de forecast-API in plaats van het archief", () => {
    const url = openMeteoUrl({ latitude: 1, longitude: 2, dateKey: "2026-10-20", now: NOW });
    expect(url).toContain("/v1/forecast?");
  });

  it("valt voor oude wedstrijden terug op het archief", () => {
    const url = openMeteoUrl({ latitude: 1, longitude: 2, dateKey: "2025-05-01", now: NOW });
    expect(url).toContain("archive-api.open-meteo.com/v1/archive?");
  });

  it("kan het archief expliciet forceren als terugval", () => {
    const url = openMeteoUrl({ latitude: 1, longitude: 2, dateKey: "2026-11-08", now: NOW, forceArchive: true });
    expect(url).toContain("archive-api.open-meteo.com");
  });

  it("vraagt neerslagkans alleen op bij de forecast-API", () => {
    const forecast = openMeteoUrl({ latitude: 1, longitude: 2, dateKey: "2026-11-08", now: NOW, includeProbability: true });
    expect(forecast).toContain("precipitation_probability");
    const archive = openMeteoUrl({ latitude: 1, longitude: 2, dateKey: "2025-05-01", now: NOW, includeProbability: true });
    expect(archive).not.toContain("precipitation_probability");
  });
});

describe("weerrisico", () => {
  it("geeft hoog risico bij harde wind of zware neerslag", () => {
    expect(weatherRiskLevel({ windSpeed: 30 })).toBe("high");
    expect(weatherRiskLevel({ precipitation: 5 })).toBe("high");
    expect(weatherRiskLevel({ precipitationProbability: 80 })).toBe("high");
  });

  it("geeft middelmatig risico bij matige wind of regen", () => {
    expect(weatherRiskLevel({ windSpeed: 22 })).toBe("medium");
    expect(weatherRiskLevel({ precipitation: 1.5 })).toBe("medium");
    expect(weatherRiskLevel({})).toBe("low");
  });

  it("laat de neerslagkans voorgaan op de hoeveelheid als die beschikbaar is", () => {
    expect(weatherRiskLevel({ precipitation: 6, precipitationProbability: 5 })).toBe("low");
    expect(weatherRiskLevel({ precipitation: 0, precipitationProbability: 55 })).toBe("medium");
  });
});

describe("weerimport-bedrading", () => {
  const source = fs.readFileSync(path.join(ROOT, "scripts", "import-free-sources.js"), "utf8");

  it("gebruikt de endpointkeuze en telt lege antwoorden als fout", () => {
    expect(source).toContain("openMeteoUrl(");
    expect(source).toContain("geen uurlijkse waarden");
    expect(source).toContain("geen temperatuur of wind");
  });

  it("geocodeert ook clubs waarvan de venue nog geen coordinaten heeft", () => {
    expect(source).toContain("v.latitude is null");
    expect(source).toContain("row.venue_id ||");
  });
});

describe("weerfetch in de server-worker", () => {
  const source = fs.readFileSync(path.join(ROOT, "scripts", "server-worker.js"), "utf8");

  it("gebruikt dezelfde endpointkeuze als de import", () => {
    expect(source).toContain('import { openMeteoUrl, weatherRiskLevel } from "../shared/openMeteo.js";');
    expect(source).toContain("openMeteoUrl({ latitude: lat, longitude: lon, dateKey: date, includeProbability: true })");
    expect(source).toContain("weatherRiskLevel({ windSpeed, precipitationProbability, precipitation })");
  });

  it("valt terug op de weercontext uit de database als de live fetch leeg blijft", () => {
    expect(source).toContain("dbFeatureContext.weather.riskLevel || weatherRiskLevel(dbFeatureContext.weather)");
  });

  it("leest de actuele windveldnaam uit het antwoord", () => {
    expect(source).toContain("json.hourly.wind_speed_10m");
    expect(source).not.toContain("json.hourly.windspeed_10m");
  });
});

describe("weerfeatures in de voorspelling", () => {
  const source = fs.readFileSync(path.join(ROOT, "scripts", "worker", "prediction.js"), "utf8");

  it("gebruikt dbFeatureContext.weather als input.weather ontbreekt", () => {
    expect(source).toContain("input.weather || dbFeatureContext.weather");
    expect(source).toContain("db_weather_wind_speed: Number(dbWeather.windSpeed ?? 0)");
    expect(source).toContain("db_weather_precipitation: Number(dbWeather.precipitation ?? 0)");
  });
});
