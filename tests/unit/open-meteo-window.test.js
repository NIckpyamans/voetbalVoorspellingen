import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { openMeteoUrl } from "../../shared/openMeteo.js";

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
