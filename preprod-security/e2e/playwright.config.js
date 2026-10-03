// E2E za Security pre-prod: Android (Maestro, pozvan iz testova), web (Playwright) i ceo sistem zajedno.
// Uvek na instanci za testove (backend 5301, web 3301, Mailpit 8027, baza robotik_preprod_security_e2e).
// Pokretanje: security.ps1 test (podiže instancu za testove), ili npx playwright test u ovom folderu posle
// security.ps1 start (emulator, Metro) i security.ps1 start e2e.
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
    // Android i web zajedno: tokovi admin/koordinator na webu + radnik na telefonu, istovremeni događaji
    { name: 'sistem', testMatch: /sistem-.*\.spec\.js/ },
  ],
});
