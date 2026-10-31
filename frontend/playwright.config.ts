import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

// Use a pre-installed Chromium when PLAYWRIGHT_CHROMIUM_PATH is set (CI / sandbox); otherwise Playwright's own.
const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH && existsSync(process.env.PLAYWRIGHT_CHROMIUM_PATH) ? process.env.PLAYWRIGHT_CHROMIUM_PATH : undefined

export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,   // live mode: first assessment of a new site fetches real climate data
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    launchOptions: exe ? { executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] } : { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] },
    ...devices['Desktop Chrome'],
  },
  outputDir: 'e2e-results',
})
