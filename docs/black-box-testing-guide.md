# Black-Box Website Testing with e2e-remake

This guide explains how to use `e2e-remake` to test a website when you do not
have access to its source code. The test project only needs a URL that is
reachable from the machine running the tests.

The recommended workflow is:

1. Create a standalone test project.
2. Point `e2e-remake` at a staging or authorized production URL.
3. Use Claude to explore the website and identify useful test flows.
4. Convert important flows into repeatable tests with deterministic assertions.
5. Run the same suite on Windows, Linux, macOS, or CI.

> [!IMPORTANT]
> Only test systems you own or are explicitly authorized to test. Prefer a
> staging environment and test accounts. Do not allow exploratory tests to
> submit real payments, delete production data, send messages, or perform other
> destructive actions.

## Prerequisites

- Node.js `^22.22.3` or `>=24.8.0`
- npm, pnpm, or Bun
- A locally built or published `e2e-remake` package
- An eligible Claude account for subscription authentication, or an Anthropic
  API key as a fallback
- Network access to the target website, including any required VPN or private
  DNS connection

## 1. Build e2e-remake

From the `e2e-remake` repository:

```bash
corepack enable
corepack prepare pnpm@12.3.4 --activate
pnpm install
pnpm build
```

Create a local package archive so that it can be installed in a separate test
project before the fork is published to a package registry:

```bash
mkdir artifacts
pnpm --dir packages/e2e pack --pack-destination ../../artifacts
```

The generated file will have a name similar to:

```text
e2e-remake/artifacts/e2e-0.20.0.tgz
```

Use the actual filename created by `pnpm pack` in the following steps.

## 2. Create a standalone black-box test project

The test suite does not need to live inside the website's source repository.
A practical layout is:

```text
blackbox-tests/
├── package.json
├── e2e.config.ts
├── .gitignore
└── tests/
    ├── public.e2e.ts
    ├── auth.setup.e2e.ts
    └── dashboard.e2e.ts
```

Create the project:

```bash
mkdir blackbox-tests
cd blackbox-tests
npm init -y
```

Update `package.json`:

```json
{
  "name": "blackbox-tests",
  "private": true,
  "type": "module",
  "scripts": {
    "test:e2e": "e2e-remake run",
    "test:e2e:headed": "e2e-remake run --headed",
    "test:e2e:report": "e2e-remake run --reporter list,markdown,junit"
  }
}
```

Install the local archive and the web and Claude adapters.

Linux or macOS example:

```bash
npm install --save-dev /path/to/e2e-remake/artifacts/e2e-0.20.0.tgz @e2e-dev/web ai
npx playwright install chromium
```

Windows PowerShell example:

```powershell
npm install --save-dev C:\path\to\e2e-remake\artifacts\e2e-0.20.0.tgz @e2e-dev/web ai
npx playwright install chromium
```

Create `.gitignore`:

```gitignore
node_modules/
.e2e/
.env
*.log
```

## 3. Authenticate with a Claude subscription

Install the official Claude Code CLI by following
[Anthropic's setup guide](https://docs.anthropic.com/en/docs/claude-code/setup),
then sign in and verify the account:

```bash
claude --version
claude auth login
claude auth status
```

`npx e2e-remake login anthropic` is an optional compatibility command that
delegates to `claude auth login`. e2e-remake does not read or store the Claude
Code credential.

Confirm that Claude Code can make a non-interactive subscription request:

```bash
claude -p "Reply with exactly OK" --model haiku --output-format json --max-turns 1
```

Use a model alias shown by `claude --help`, such as `sonnet`, `opus`, or
`haiku`, or use a full model name available to the account. Model availability
and subscription eligibility are controlled by Anthropic. For CI or a shared
runner, use the supported Anthropic API-key configuration instead of copying a
local Claude Code session.

## 4. Configure a remote website

Create `e2e.config.ts`:

```ts
import type { E2EConfig } from 'e2e';
import { claude } from 'e2e/oauth/claude';
import { web } from '@e2e-dev/web';

const appUrl = process.env.APP_URL ?? 'https://staging.example.com';

export default {
  tests: 'tests/**/*.e2e.ts',

  agents: {
    default: {
      // Claude Code also accepts a full model name available to the account.
      model: claude('sonnet'),
      system: [
        'You are testing an authorized website.',
        'Do not submit payments, delete data, or perform destructive actions.',
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
      app: {
        url: appUrl,
        environment: 'staging',
      },
    },
    {
      name: 'mobile-web',
      engine: web({
        browser: 'chromium',
        viewport: { width: 390, height: 844 },
      }),
      app: {
        url: appUrl,
        environment: 'staging',
      },
    },
  ],

  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporters: ['list'],
  trace: 'retain-on-failure',
  video: 'retain-on-failure',
} satisfies E2EConfig;
```

For a remote black-box target:

- Set `app.url` to the external website.
- Do not configure `app.command` or a local development-server command.
- Make sure the test machine can reach the URL through its VPN, firewall, DNS,
  and proxy configuration.
- Use `environment: 'production'` only when the target really is production
  and the tests are safe to run there.

## 5. Set the target URL

### Windows PowerShell

```powershell
$env:APP_URL = "https://staging.example.com"
npx e2e-remake list
npx e2e-remake run --headed
```

### Windows Command Prompt

```bat
set APP_URL=https://staging.example.com
npx e2e-remake list
npx e2e-remake run --headed
```

### Linux and macOS

```bash
export APP_URL="https://staging.example.com"
npx e2e-remake list
npx e2e-remake run --headed
```

For a single command on Linux or macOS:

```bash
APP_URL="https://staging.example.com" npx e2e-remake run --headed
```

## 6. Explore the website before writing tests

When the page structure and workflows are unknown, start with `explore`:

```bash
npx e2e-remake explore \
  "Explore the public website as a first-time visitor. Check navigation, search, forms, and responsive behavior. Do not submit payments or destructive forms." \
  --target desktop \
  --max-steps 6 \
  --headed \
  --video
```

PowerShell example:

```powershell
npx e2e-remake explore "Explore the public website as a first-time visitor. Check navigation, search, forms, and responsive behavior. Do not submit payments or destructive forms." --target desktop --max-steps 6 --headed --video
```

The default `.e2e/` output directory contains the run report and any retained
screenshots, traces, or videos. `explore` is useful for discovering workflows
and possible defects, but important regression coverage should be converted
into repeatable test files.

## 7. Add the first smoke test

Create `tests/public.e2e.ts`:

```ts
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('the home page loads and primary navigation works', async ({
  app,
  agent,
  screen,
  browser,
}) => {
  await app.open('/');

  await expect(browser.locator('body')).toBeVisible();

  await agent.act(
    'Open the primary navigation item that leads to the product or features page',
  );

  await agent.assert(
    'A product or features page is visible and it does not show an error page',
  );

  await expect(screen.getByRole('heading')).toBeVisible();
});
```

Run the test in a visible browser:

```bash
npx e2e-remake run tests/public.e2e.ts --headed
```

Run only the desktop target:

```bash
npx e2e-remake run tests/public.e2e.ts --target desktop --headed
```

Omitting `--target` runs the test against every configured target.

## 8. Combine agent actions with deterministic assertions

Use agent steps when the exact page structure is unknown, then verify critical
outcomes with locators and assertions:

```ts
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('a visitor can search for a product', async ({ app, agent, screen }) => {
  await app.open('/');

  await agent.act(
    'Find the site search, search for "wireless keyboard", and submit the search',
  );

  await expect(
    screen.getByText('wireless keyboard', { exact: false }),
  ).toBeVisible();

  await agent.assert(
    'Search results are visible and relevant to wireless keyboards',
  );
});
```

Prefer accessible selectors:

```ts
screen.getByRole('button', 'Search');
screen.getByLabel('Email');
screen.getByText('Order confirmed');
screen.getByTestId('checkout-submit');
```

Avoid selectors tied to the current layout:

```ts
browser.locator('.container > div:nth-child(3) > button');
```

Role, label, text, and test-ID selectors are usually more resilient than CSS
classes or XPath expressions.

## 9. Test authenticated pages safely

Add a named test account to `e2e.config.ts`:

```ts
export default {
  // Other configuration...

  credentials: {
    admin: {
      username: process.env.E2E_USERNAME ?? 'qa@example.com',
      password: () => process.env.E2E_PASSWORD ?? '',
    },
  },
} satisfies E2EConfig;
```

Do not commit passwords or authentication tokens.

Set the credentials in PowerShell:

```powershell
$env:E2E_USERNAME = "qa@example.com"
$env:E2E_PASSWORD = "your-test-password"
```

Set them on Linux or macOS:

```bash
export E2E_USERNAME="qa@example.com"
export E2E_PASSWORD="your-test-password"
```

Create `tests/auth.setup.e2e.ts` to sign in once and save a temporary session:

```ts
import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';

test.setup(
  'authenticate with the QA account',
  { sessions: ['admin'] },
  async ({ app, screen, browser, session }) => {
    const admin = credentials.user('admin');

    await app.open('/login');
    await screen.getByLabel('Email').fill(admin.username);
    await screen.getByLabel('Password').fill(admin.password);
    await screen.getByRole('button', 'Sign in').tap();

    await expect(browser).toHaveURL('/dashboard');
    await session.save('admin');
  },
);
```

Use the saved session in `tests/dashboard.e2e.ts`:

```ts
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test(
  'an authenticated user can open the dashboard',
  { session: 'admin' },
  async ({ app, screen, agent }) => {
    await app.open('/dashboard');

    await expect(
      screen.getByRole('heading', 'Dashboard'),
    ).toBeVisible();

    await agent.assert(
      'The dashboard is loaded without a visible error or authentication prompt',
    );
  },
);
```

Running the dashboard test also runs the setup required to create its session:

```bash
npx e2e-remake run tests/dashboard.e2e.ts --headed
```

Credential passwords are represented by opaque secret handles. The framework
can fill them into supported editable fields without exposing the plaintext
value to the model or normal reports.

## 10. Handle preview protection

### HTTP Basic Authentication

```ts
import type { E2EConfig } from 'e2e';
import { secrets } from 'e2e';
import { claude } from 'e2e/oauth/claude';
import { web } from '@e2e-dev/web';

export default {
  agents: {
    default: {
      model: claude('sonnet'),
    },
  },

  secrets: {
    previewPassword: () => process.env.PREVIEW_PASSWORD ?? '',
  },

  targets: [
    {
      name: 'preview',
      engine: web({
        basicAuth: {
          username: process.env.PREVIEW_USERNAME ?? 'preview',
          password: secrets.get('previewPassword'),
        },
      }),
      app: {
        url: process.env.APP_URL ?? 'https://preview.example.com',
      },
    },
  ],
} satisfies E2EConfig;
```

### Vercel preview protection

Pass the authorized bypass header through the web engine:

```ts
engine: web({
  headers: {
    'x-vercel-protection-bypass':
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? '',
  },
}),
```

Do not try to bypass CAPTCHA or anti-bot controls without authorization. For
test environments, use an approved approach such as:

- Disabling CAPTCHA in staging
- Allowlisting the runner's IP address
- Using a dedicated automation account
- Supplying an approved session cookie
- Using a preview bypass token provided by the hosting platform

Interactive MFA may require a pre-authenticated session or a dedicated test
authentication flow. Do not automate a real user's MFA device.

## 11. Run and troubleshoot the suite

Run every test:

```bash
npx e2e-remake run
```

Watch a run in a visible browser:

```bash
npx e2e-remake run --headed
```

Bypass recorded agent actions and execute the agent live:

```bash
npx e2e-remake run --headed --no-cache
```

Print detailed step and timing information:

```bash
npx e2e-remake run --headed --debug
```

Keep videos for failed attempts:

```bash
npx e2e-remake run --video=retain-on-failure
```

Generate console, Markdown, and JUnit reports:

```bash
npx e2e-remake run --reporter list,markdown,junit
```

Run only the tests that failed in the previous run:

```bash
npx e2e-remake run --last-failed
```

Check whether a test is stable across repeated executions:

```bash
npx e2e-remake run tests/public.e2e.ts --repeat-each 5 --retries 0 --no-cache
```

The default `.e2e/` directory can include:

- `report.json`, containing the structured run result
- `summary.md`, when the Markdown reporter is enabled
- `junit.xml`, when the JUnit reporter is enabled
- Failure screenshots
- Retained trace pages
- Retained videos

## 12. Recommended adoption plan

Introduce black-box coverage incrementally:

1. Run `explore` against staging to understand the public workflows.
2. Add three to five read-only smoke tests.
3. Add an authenticated session using a dedicated QA account.
4. Cover the highest-value business workflows.
5. Add a narrow mobile viewport target.
6. Repeat each new test several times and remove sources of flakiness.
7. Enable Markdown and JUnit reports.
8. Add the stable suite to CI.
9. Run only explicitly safe, non-destructive tests against production.

A useful initial suite normally covers:

- Home page availability
- Primary navigation
- Search
- Successful and unsuccessful login
- Dashboard availability
- Form validation
- Logout
- Mobile responsive behavior
- Absence of visible `404` or `500` error pages in critical flows

## CI considerations

For CI, provide `APP_URL` and credentials through the CI platform's secret
store. Never commit `.env` files containing real secrets.

A typical command is:

```bash
npx e2e-remake run --reporter list,junit
```

Upload `.e2e/` as a CI artifact so that reports, traces, screenshots, and
videos remain available after a failed job.

Start with one worker when the website or test account cannot safely support
parallel activity:

```bash
npx e2e-remake run --workers 1 --reporter list,junit
```

## Final checklist

Before relying on the suite, confirm that:

- The target URL is authorized and reachable from the runner.
- `claude auth status` reports a signed-in subscription account.
- The selected alias is accepted by the installed Claude Code version (`claude --help`).
- Test credentials belong to a dedicated account.
- Destructive flows are excluded or use sandbox data.
- CAPTCHA and MFA have an approved test-environment strategy.
- Critical outcomes use deterministic assertions.
- New tests pass repeatedly with `--no-cache`.
- CI stores `.e2e/` artifacts after failures.
- Production runs contain only explicitly safe tests.

