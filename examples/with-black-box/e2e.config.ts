import type { E2EConfig } from 'e2e';
import { claude } from 'e2e/oauth/claude';
import { web } from '@e2e-dev/web';

const appUrl = process.env.APP_URL ?? 'https://www.saucedemo.com';

export default {
  tests: 'tests/**/*.e2e.ts',

  agents: {
    default: {
      model: claude('claude-haiku-5-5'),
      judgmentTimeout: 90_000,
      system: [
        'You are testing an authorized website as a careful QA engineer.',
        'Do not submit payments, delete data, send messages, or perform destructive actions.',
        'Verify the visible result after every important action.',
      ].join(' '),
    },
  },

  targets: [
    {
      name: 'desktop',
      engine: web({
        browser: 'chromium',
        viewport: { width: 1440, height: 900 },
      }),
      app: { url: appUrl },
    },
    {
      name: 'mobile-web',
      engine: web({
        browser: 'chromium',
        viewport: { width: 390, height: 844 },
      }),
      app: { url: appUrl },
    },
  ],

  timeout: 180_000,
  actionTimeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporters: ['list'],
  trace: 'retain-on-failure',
  video: 'retain-on-failure',
} satisfies E2EConfig;

