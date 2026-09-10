import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests/browser',testMatch:'*.spec.ts',use:{baseURL:'http://127.0.0.1:4178',browserName:'chromium'},webServer:{command:'node scripts/test-server.mjs',url:'http://127.0.0.1:4178',reuseExistingServer:false},reporter:'list'});
