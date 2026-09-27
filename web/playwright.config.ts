import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 40_000,
  expect: { timeout: 12_000 },
  outputDir: '../test/scratch/playwright',
  reporter: [['list'], ['json', { outputFile: '../docs/evidence/interactions.json' }]],
  use: { baseURL: 'http://127.0.0.1:4178/preview/', viewport: { width: 1440, height: 1000 }, headless: true },
  webServer: { command: 'node scripts/serve-export.mjs', url: 'http://127.0.0.1:4178/preview/', reuseExistingServer: false },
});
