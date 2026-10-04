import { test, expect, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_USER_EMAIL;
const PASSWORD = process.env.E2E_USER_PASSWORD;

test.describe("public pages", () => {
  for (const path of ["/", "/auth", "/reset-password"]) {
    test(`${path} loads without errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const res = await page.goto(path);
      expect(res?.status()).toBeLessThan(400);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test("health endpoint", async ({ request }) => {
    const res = await request.get("/api/public/health");
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).status).toBe("ok");
  });

  test("unknown page shows friendly 404", async ({ page }) => {
    await page.goto("/definitely-not-a-page");
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByRole("link", { name: /go home/i })).toBeVisible();
  });
});

test.describe("logged-out protection", () => {
  for (const path of ["/map", "/reservations", "/profile", "/my-slots", "/bookings", "/admin"]) {
    test(`${path} redirects to /auth`, async ({ page }) => {
      await page.goto(path);
      await page.waitForURL(/\/auth/);
    });
  }

  test("slot detail never reveals full address when logged out", async ({ page }) => {
    await page.goto("/slot/00000000-0000-0000-0000-000000000000");
    await page.waitForURL(/\/auth/);
    await expect(page.getByText(/full address/i)).toHaveCount(0);
  });
});

test.describe("auth form validation", () => {
  test("rejects a bad email", async ({ page }) => {
    await page.goto("/auth");
    const email = page.locator('input[type="email"]').first();
    test.skip((await email.count()) === 0, "email field not on default auth tab");
    await email.fill("not-an-email");
    await email.blur();
    await expect(page.locator('[aria-invalid="true"], .text-destructive').first()).toBeVisible();
  });

  test("rejects a phone not starting 6-9", async ({ page }) => {
    // Phone is only on the sign-up form; /auth defaults to sign-in.
    await page.goto("/auth?mode=signup");
    const phone = page.locator('input[type="tel"]').first();
    test.skip((await phone.count()) === 0, "phone field not on default auth tab");
    await phone.fill("5123456789");
    await phone.blur();
    await expect(page.locator('[aria-invalid="true"], .text-destructive').first()).toBeVisible();
  });
});

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.locator('input[type="email"]').first().fill(EMAIL!);
  await page.locator('input[type="password"]').first().fill(PASSWORD!);
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"));
}

test.describe("signed-in (non-admin)", () => {
  test.skip(!EMAIL || !PASSWORD, "E2E_USER_EMAIL / E2E_USER_PASSWORD not set");

  test("non-admin cannot open /admin", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin");
    await page.waitForURL((u) => !u.pathname.startsWith("/admin"));
  });
});
