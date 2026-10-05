import { test, expect, type Page } from "@playwright/test";

// Signed-in map specs. Skipped unless E2E login secrets are set.
const EMAIL = process.env.E2E_USER_EMAIL;
const PASSWORD = process.env.E2E_USER_PASSWORD;

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.locator('input[type="email"]').first().fill(EMAIL!);
  await page.locator('input[type="password"]').first().fill(PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"));
}

test.describe("map screen", () => {
  test.skip(!EMAIL || !PASSWORD, "E2E_USER_EMAIL / E2E_USER_PASSWORD not set");

  test("shows Retry and list fallback when Google Maps is blocked", async ({ page }) => {
    await page.route(/maps\.googleapis\.com/, (r) => r.abort());
    await signIn(page);
    await page.goto("/map");
    const alert = page.getByRole("alert").filter({ hasText: "The map couldn't load" });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await page.getByRole("button", { name: "Show list instead" }).click();
    await expect(page.getByText(/\d+ spots? near/)).toBeVisible();
  });

  test("switching to Monthly does not hide every slot", async ({ page }) => {
    await page.route(/maps\.googleapis\.com/, (r) => r.abort());
    await signIn(page);
    await page.goto("/map");
    await page.getByRole("button", { name: "List" }).click();
    const count = page.getByText(/\d+ spots? near/);
    await expect(count).toBeVisible();
    test.skip((await count.textContent())?.startsWith("0 ") ?? true, "no slots in this database");
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("button", { name: "monthly" }).click();
    await expect(page.getByText("No slots match your filters.")).toHaveCount(0);
  });
});

test.describe("time-window search", () => {
  test.skip(!EMAIL || !PASSWORD, "E2E_USER_EMAIL / E2E_USER_PASSWORD not set");

  test("entering a window shows totals and greys unavailable slots", async ({ page }) => {
    await page.route(/maps\.googleapis\.com/, (r) => r.abort());
    await signIn(page);
    await page.goto("/map");
    await page.getByRole("button", { name: "List" }).click();
    await page.getByLabel(/When\? Arrive/).fill("2030-01-15T11:00");
    await page.getByLabel(/Length/).fill("2");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText(/free for your time/)).toBeVisible({ timeout: 15_000 });
    const totals = page.getByText(/₹\d+\s*total/);
    test.skip((await totals.count()) === 0, "no slots in this database");
    await expect(totals.first()).toBeVisible();
    // Any unavailable slot carries a reason label.
    const reasons = page.getByText(/Booked at that time|Closed at that time|Not available/);
    if (await reasons.count()) await expect(reasons.first()).toBeVisible();
  });
});
