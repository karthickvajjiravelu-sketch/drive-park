import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:8080";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "retain-on-failure" },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "bun run dev", url: baseURL, reuseExistingServer: true, timeout: 120_000 },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile-375",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-414",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 414, height: 896 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
