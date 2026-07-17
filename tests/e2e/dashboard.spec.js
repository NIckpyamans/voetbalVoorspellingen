import { expect, test } from "@playwright/test";

test("dashboard renders useful content instead of a white screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(page.locator("body")).toContainText(/Top 5|wedstrijden|Vandaag|Geen wedstrijden/i);
  await expect(page.locator("#root")).toBeVisible();
});

test("compact matches endpoint remains available", async ({ request }) => {
  const response = await request.get("/api/matches");
  expect(response.status()).toBeLessThan(500);
});
