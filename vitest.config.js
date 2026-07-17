import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.js", "tests/contract/**/*.test.js"],
    coverage: { reporter: ["text", "json-summary"] },
  },
});
