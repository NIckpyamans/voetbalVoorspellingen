import { describe, expect, it } from "vitest";
import { getR2Config } from "../../shared/cloudflare-r2.js";

describe("R2 configuration", () => {
  it("accepts the legacy R2_BUCKET_NAME secret alias", () => {
    expect(getR2Config({
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "access",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET_NAME: "archive",
    })).toMatchObject({ configured: true, bucket: "archive" });
  });
});
