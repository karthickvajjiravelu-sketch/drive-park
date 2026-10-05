import { test, expect, type Page } from "@playwright/test";

// Signed-in 3D specs. Skipped unless E2E login secrets are set.
// The flag is build-time: set E2E_MAP3D=1 only when the server was started with VITE_FEATURE_MAP_3D=true.
const EMAIL = process.env.E2E_USER_EMAIL;
const PASSWORD = process.env.E2E_USER_PASSWORD;
const FLAG_ON = process.env.E2E_MAP3D === "1";

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.locator('input[type="email"]').first().fill(EMAIL!);
  await page.locator('input[type="password"]').first().fill(PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"));
}

test.describe("map 3D toggle", () => {
  test.skip(!EMAIL || !PASSWORD, "E2E_USER_EMAIL / E2E_USER_PASSWORD not set");

  test("flag off: no 2D/3D toggle", async ({ page }) => {
    test.skip(FLAG_ON, "flag is on for this run");
    await signIn(page);
    await page.goto("/map");
    await expect(page.getByRole("group", { name: "Map view" })).toHaveCount(0);
  });

  test("flag on + maps3d fails: toast and 2D stays", async ({ page }) => {
    test.skip(!FLAG_ON, "E2E_MAP3D not set");
    await page.addInitScript(() => {
      const w = window as unknown as { google?: { maps?: { importLibrary?: unknown } } };
      const iv = setInterval(() => {
        if (w.google?.maps?.importLibrary) {
          const orig = w.google.maps.importLibrary as (n: string) => Promise<unknown>;
          w.google.maps.importLibrary = (n: string) =>
            n === "maps3d" ? Promise.reject(new Error("stub")) : orig(n);
          clearInterval(iv);
        }
      }, 10);
    });
    await signIn(page);
    await page.goto("/map");
    await page.getByRole("button", { name: "3D", exact: true }).click();
    await expect(page.getByText(/Showing the 2D map/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "2D", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
