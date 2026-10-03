// E2E za Security pre-prod: Android (Maestro, pozvan iz testova) i web (Playwright).
// Pokretanje: security.ps1 test (ili npx playwright test u ovom folderu, pre-prod mora da radi: security.ps1 start).
const { defineConfig } = require('@playwright/test');
const { WEB_URL } = require('./helpers/env');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 10 * 60 * 1000, // jedan test radi više Maestro koraka na emulatoru
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1, // jedan emulator, testovi idu redom
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: require.resolve('./global-setup.js'),
  globalTeardown: require.resolve('./global-teardown.js'),
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'android', testMatch: /android-.*\.spec\.js/ },
    { name: 'web', testMatch: /web-.*\.spec\.js/ },
  ],
});
