import { describe, expect, it } from "vitest";
import { standingLabel } from "../../shared/standingsLabel.js";

describe("competition-specific position labels", () => {
  it("uses distinct codes for UEFA league-phase standings", () => {
    expect(standingLabel("Europe - Champions League")).toBe("UCL");
    expect(standingLabel("Europe - Europa League")).toBe("UEL");
    expect(standingLabel("Europe - Conference League")).toBe("UECL");
  });

  it("uses a country code for followed domestic tables", () => {
    expect(standingLabel("Netherlands - Eerste Divisie")).toBe("NL");
    expect(standingLabel("Germany - Bundesliga")).toBe("DE");
  });
});
