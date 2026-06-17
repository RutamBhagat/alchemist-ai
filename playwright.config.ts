import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  use: {
    launchOptions: {
      args: ["--disable-features=LocalNetworkAccessChecks"],
    },
  },
  webServer: {
    command: "bun run dev:web",
    url: "http://127.0.0.1:3001",
    reuseExistingServer: true,
  },
});
