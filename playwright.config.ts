import { defineConfig } from "@playwright/test";

const useSystemChrome = process.env.SATNAV_E2E_USE_SYSTEM_CHROME !== "false";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"], ["html", { outputFolder: ".work/playwright-report", open: "never" }]],
  outputDir: ".work/playwright-results",
  use: {
    baseURL: "http://127.0.0.1:3000",
    browserName: "chromium",
    ...(useSystemChrome ? { channel: "chrome" as const } : {}),
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ["--enable-webgl", "--ignore-gpu-blocklist"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "HOST=127.0.0.1 PORT=3000 STRICT_PORT=true ./node_modules/.bin/pnpm dev",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
