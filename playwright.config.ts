import { defineConfig } from '@playwright/test';

// NOTE: these end-to-end specs need a Chromium download (`npx playwright install chromium`).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3100/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'development', PORT: '3100', APP_BASE_URL: 'http://localhost:3100', DATABASE_PATH: './data/e2e.db', UPLOAD_DIR: './data/e2e-uploads',
      ADMIN_EMAIL: 'e2e-admin@example.edu', ADMIN_PASSWORD: 'E2e-Admin-Pass-1', JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0001',
    },
  },
});
