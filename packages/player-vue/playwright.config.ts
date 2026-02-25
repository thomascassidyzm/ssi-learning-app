import { defineConfig, devices } from '@playwright/test'

// Use production build (preview server) so PWA features work:
//   pnpm e2e:pwa    — builds then tests against preview server
// Use dev server for fast iteration on non-PWA tests:
//   pnpm e2e        — tests against dev server
const usePWA = !!process.env.PWA_TEST
const prodUrl = process.env.PROD_URL // e.g. https://saysomethingin.app

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  reporter: 'html',

  ...(prodUrl
    ? { use: { baseURL: prodUrl } }
    : {
        webServer: usePWA
          ? {
              command: 'pnpm preview',
              port: 4173,
              reuseExistingServer: true,
              timeout: 15_000,
            }
          : {
              command: 'pnpm dev',
              port: 5173,
              reuseExistingServer: true,
              timeout: 15_000,
            },
      }),

  projects: [
    // Desktop Chrome — Chromebook classroom + Mac dev
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // Desktop Safari — Mac dev
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    // Mobile Safari — iPhone PWA
    {
      name: 'iphone',
      use: { ...devices['iPhone 14'] },
    },

    // Mobile Chrome — Android PWA
    {
      name: 'android',
      use: { ...devices['Pixel 7'] },
    },
  ],
})
