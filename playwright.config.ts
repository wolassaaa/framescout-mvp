import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    // E2E covers the browser adapter. Keep it isolated from a user's local
    // service and project database, which may be running on the default port.
    baseURL: "http://127.0.0.1:5174",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } }
    },
    {
      name: "chromium-compact",
      use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1280, height: 800 } }
    }
  ],
  webServer: {
    command: "npm --workspace @framescout/desktop run dev -- --port 5174",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    env: {
      VITE_FRAMESCOUT_API_URL: "http://127.0.0.1:4312",
      VITE_FRAMESCOUT_DEMO_MODE: "true"
    },
    timeout: 120_000
  }
});
