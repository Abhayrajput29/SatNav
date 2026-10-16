import { defineConfig } from "@playwright/test";

const useSystemChrome = process.env.SATNAV_E2E_USE_SYSTEM_CHROME !== "false";
const e2ePort = Number(process.env.SATNAV_E2E_PORT ?? "3000");
if (!Number.isInteger(e2ePort) || e2ePort < 1 || e2ePort > 65535) {
  throw new Error("SATNAV_E2E_PORT must be a valid TCP port");
}
const e2eBaseURL = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: ".work/playwright-report", open: "never" }],
  ],
  outputDir: ".work/playwright-results",
  use: {
    baseURL: e2eBaseURL,
    browserName: "chromium",
    ...(useSystemChrome ? { channel: "chrome" as const } : {}),
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ["--enable-webgl", "--ignore-gpu-blocklist"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `HOST=127.0.0.1 PORT=${e2ePort} STRICT_PORT=true ./node_modules/.bin/pnpm dev`,
    url: `${e2eBaseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
