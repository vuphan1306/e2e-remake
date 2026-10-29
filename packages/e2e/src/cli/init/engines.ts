/** CLI scaffold presets. Engine packages are referenced as generated source, never imported. */

import os from 'node:os';
import { quote } from './gateways.ts';
import { siblingDependency } from './versions.ts';

export interface EnginePreset {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly imports: readonly string[];
  readonly config: string;
  readonly example: string;
  readonly aiExample?: string;
  /** Whether the run hint sets APP_URL, for engines that drive a URL. */
  readonly needsAppUrl: boolean;
}

/** The app a URL-driven preset points at: `--app-url` and `--app-command`, split on whitespace, never shell-interpreted. */
export interface AppScaffold {
  readonly url?: string;
  readonly command?: readonly string[];
}

const DEFAULT_APP_URL = 'http://localhost:3000';

/** Builds prompt choices and scaffolds with defaults for the machine running init. */
export function getEnginePresets(app: AppScaffold = {}) {
  const ios = os.platform() === 'darwin';
  const [executable, ...args] = app.command ?? [];
  // A dev server the user already runs answers the ready probe, so the runner reuses it instead of starting a second one.
  const command = executable === undefined
    ? `      // Or let the runner start the dev server:
      // command: { executable: 'npm', args: ['run', 'dev'] },`
    : `      command: { executable: ${quote(executable)}, args: [${args.map(quote).join(', ')}], reuseExisting: true },`;
  return [
    {
      id: 'web',
      label: 'Web',
      hint: 'Playwright',
      dependencies: siblingDependency('@e2e-dev/web'),
      imports: ["import { web } from '@e2e-dev/web';"],
      config: `  targets: [{
    engine: web(),
    app: {
      url: process.env.APP_URL ?? ${quote(app.url ?? DEFAULT_APP_URL)},
${command}
    },
  }],`,
      example: `import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('app opens', async ({ app, browser }) => {
  await app.open('/');
  await expect(browser.locator('body')).toBeVisible();
});
`,
      aiExample: `
// With the model key in the environment, uncomment:
// test('the agent drives a flow', async ({ app, agent }) => {
//   await app.open('/');
//   await agent.act('one goal in natural language');
//   await agent.assert('one question about the screen');
// });
`,
      needsAppUrl: true,
    },
    {
      id: 'mobile',
      label: 'Mobile (iOS/Android)',
      hint: 'agent-device',
      dependencies: siblingDependency('@e2e-dev/mobile'),
      imports: ["import { mobile } from '@e2e-dev/mobile';"],
      config: ios
        ? `  // Replace Settings with your app's bundle id.
  targets: [{ name: 'ios', engine: mobile({ platform: 'ios' }), app: { bundleId: 'Settings' } }],
  workers: 1,`
        : `  // Replace com.android.settings with your app's package name.
  targets: [{ name: 'android', engine: mobile({ platform: 'android' }), app: { bundleId: 'com.android.settings' } }],
  workers: 1,`,
      example: `import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

test('Settings opens', async ({ app, screen }) => {
  await app.open();
  await expect(${ios ? "screen.getByRole('button', 'General')" : "screen.getByText('Network & internet')"}).toBeVisible();
});
`,
      aiExample: ios
        ? `
// With the model key in the environment, uncomment:
// test('the agent opens General', async ({ agent, app, device }) => {
//   await app.open();
//   await agent.act('open General settings');
//   await expect(device.locator('role=NavigationBar id=General')).toBeVisible();
// });
`
        : `
// With the model key in the environment, uncomment:
// test('the agent opens Network settings', async ({ agent, app, device }) => {
//   await app.open();
//   await agent.act('open Network & internet settings');
//   await expect(device.locator('id=com.android.settings:id/collapsing_toolbar')).toHaveText('Network & internet');
// });
`,
      needsAppUrl: false,
    },
    {
      id: 'none',
      label: 'None',
      hint: 'HTTP tests or your own engine',
      dependencies: {},
      imports: [],
      config: `  // Add an engine here when your tests need to drive an app.
  targets: [{ name: 'default', platform: 'custom' }],`,
      example: `import { test, expect } from 'e2e';

test('app responds', async () => {
  const response = await fetch(process.env.APP_URL ?? ${quote(app.url ?? DEFAULT_APP_URL)});
  expect(response.ok).toBe(true);
});
`,
      needsAppUrl: true,
    },
  ] as const satisfies readonly EnginePreset[];
}

export type EngineId = ReturnType<typeof getEnginePresets>[number]['id'];
export const DEFAULT_ENGINE_ID = 'web' satisfies EngineId;

/** Resolves a preset with the common shape used by scaffold generation. */
export function getEnginePreset(id: EngineId, app: AppScaffold = {}): EnginePreset {
  const preset = getEnginePresets(app).find((entry) => entry.id === id);
  if (preset === undefined) throw new Error(`unknown engine: ${id}`);
  return preset;
}
