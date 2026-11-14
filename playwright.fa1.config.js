import { defineConfig } from '@playwright/test'
import base from './playwright.config.js'

// A separate dev server exercises FA1 live mode with intercepted HTTP contracts, no AWS.
export default defineConfig({
  ...base,
  testMatch: 'fa1-live.pw.js',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5180' },
  webServer: {
    ...base.webServer,
    command: 'npm run dev -- --host 127.0.0.1 --port 5180 --strictPort',
    url: 'http://127.0.0.1:5180',
    env: { VITE_API_URL: '/__fa1_api', VITE_API_BASE_URL: '', VITE_USE_MOCK: 'false' },
    reuseExistingServer: false,
  },
})
