# e2e-remake

Cross-platform, agentic end-to-end testing with Claude Pro and Max subscription support.

`e2e-remake` is an independent fork of [`tester-army/e2e`](https://github.com/tester-army/e2e). It preserves the upstream runner, browser and mobile engines, deterministic locators, assertions, recordings, and reports, while adding a Claude subscription adapter backed by the official Claude Code CLI.

> [!IMPORTANT]
> This project is not affiliated with TesterArmy or Anthropic. A Claude subscription and Claude Code are separate from this repository. Review [License and service terms](#license-and-service-terms) before use.

## What changed

- `claude(model)` exposes a Claude Code-backed AI SDK model to e2e agent steps.
- Authentication remains inside the official Claude Code installation. The adapter never reads, copies, stores, or refreshes Claude credentials.
- Each model call uses Claude Code's supported non-interactive `claude -p` interface.
- Windows, Linux, and macOS use the same configuration and test files.
- The adapter disables Claude Code tools, project instructions, plugins, hooks, session persistence, and permission prompts for isolated model execution.
- `e2e-remake login anthropic` remains as a convenience alias for `claude auth login`.

The published package and source imports remain named `e2e` for compatibility with the upstream ecosystem. The preferred executable for this fork is `e2e-remake`; `e2e` remains an alias.

## Requirements

| Requirement | Version or note |
| --- | --- |
| Node.js | `^22.22.3` or `>=24.8.0` |
| pnpm | `12.3.4` when building this repository |
| Claude Code | A current official installation available as `claude` on `PATH` |
| Claude account | A Pro or Max plan with Claude Code access |
| Operating system | Windows 10/11, current macOS, or a maintained Linux distribution |

Install Claude Code by following the [official setup guide](https://docs.anthropic.com/en/docs/claude-code/setup), then verify it:

```bash
claude --version
claude auth login
claude auth status
```

## Build from source

1. Clone your fork and enter the repository.

   ```bash
   git clone <your-e2e-remake-repository-url> e2e-remake
   cd e2e-remake
   ```

2. Enable the repository's package-manager version.

   ```bash
   corepack enable
   corepack prepare pnpm@12.3.4 --activate
   ```

3. Install and build.

   ```bash
   pnpm install
   pnpm build
   ```

4. Run the focused tests and project checks.

   ```bash
   pnpm --filter e2e exec vitest run tests/unit/oauth/anthropic.test.ts tests/unit/oauth/cli.test.ts
   pnpm check
   ```

## Apply it to a test project

Until the fork is published, install it from a local package archive.

1. Pack the runner from this repository.

   ```bash
   pnpm --dir packages/e2e pack --pack-destination ../../artifacts
   ```

2. In the test project, install the archive and browser engine. Replace the archive path as needed.

   ```bash
   npm install --save-dev ../e2e-remake/artifacts/e2e-0.20.0.tgz @e2e-dev/web ai
   npx playwright install chromium
   ```

   PowerShell accepts the same command. pnpm and Bun users can use `pnpm add -D` or `bun add -d`.

3. Authenticate through Claude Code.

   ```bash
   claude auth login
   claude auth status
   ```

   `npx e2e-remake login anthropic` is an equivalent convenience command. It delegates to Claude Code and does not create an e2e-remake OAuth file entry.

4. Create `e2e.config.ts`.

   ```ts
   import type { E2EConfig } from 'e2e';
   import { claude } from 'e2e/oauth/claude';
   import { web } from '@e2e-dev/web';

   export default {
     agents: {
       default: {
         // Claude Code accepts aliases such as sonnet, opus, and haiku,
         // or a full model name available to your account.
         model: claude('sonnet'),
         system: 'You are a careful QA agent. Verify every important outcome.',
       },
     },
     targets: [
       {
         name: 'chromium',
         engine: web(),
         app: {
           url: process.env.APP_URL ?? 'https://www.saucedemo.com',
         },
       },
     ],
   } satisfies E2EConfig;
   ```

5. Add `tests/login.e2e.ts`.

   ```ts
   import { test } from '@e2e-dev/web';
   import { expect } from 'e2e';

   test('a customer can sign in', async ({ app, agent, screen }) => {
     await app.open('/');
     await agent.act(
       'Log in with username "standard_user" and password "secret_sauce". Stop on the products page.',
     );
     await expect(screen.getByText('Products')).toBeVisible();
   });
   ```

6. Run the test.

   ```bash
   npx e2e-remake run tests/login.e2e.ts --target chromium --no-cache
   ```

For a detailed black-box workflow, see [Black-box testing guide](./docs/black-box-testing-guide.md).

A ready-to-run version of this setup is in [examples/with-black-box](./examples/with-black-box). A recorded run of it against saucedemo.com (6/6 passed on Windows, desktop and mobile viewports, Claude subscription via Claude Code) is written up in [docs/evidence/saucedemo-run.md](./docs/evidence/saucedemo-run.md) ([web version](https://claude.ai/artifact/1UstkjYDmUUJGo7yaAtJez)).

## Claude model selection

Use an alias supported by the installed Claude Code version:

```ts
claude('sonnet');
claude('opus');
claude('haiku');
```

A full model name is also accepted. Run `claude --help` to inspect the aliases supported by your installed version, or `npx e2e-remake models anthropic` for a concise reminder. Model access and usage limits are controlled by Anthropic and the signed-in account.

## Troubleshooting

### `Claude Code CLI could not start`

Run `claude --version`. If the command is missing, install Claude Code and restart the terminal so the updated `PATH` is visible.

### Authentication or entitlement error

```bash
claude auth status
claude auth login
claude -p "Reply with exactly OK" --model haiku --output-format json --max-turns 1
```

The last command isolates Claude Code from the test runner. If it fails, resolve the Claude Code account or plan issue first.

### HTTP 429 while subscription usage remains

Do not copy a Claude Code OAuth token into a generic Anthropic SDK client. Subscription entitlement is exercised through the official Claude Code client; direct Anthropic API calls use API billing and supported API credentials. Ensure the config imports `claude` from `e2e/oauth/claude`, then rebuild and reinstall the latest local archive.

### Environment variables unexpectedly select API billing

For `claude()`, e2e-remake deliberately removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and the Claude Code Bedrock, Vertex, and Foundry routing flags from the child process. This keeps the constructor's meaning explicit: it uses the locally signed-in Claude subscription.

### CI and shared runners

Use an Anthropic API key with `@ai-sdk/anthropic` in CI. Interactive subscription sessions are intended for a developer's local machine and should not be copied between users or committed to a repository.

```ts
import { anthropic } from '@ai-sdk/anthropic';

const model = anthropic('claude-sonnet-5-5');
```

## Other model connections

The inherited providers remain available:

| Plan or endpoint | Setup |
| --- | --- |
| ChatGPT Plus or Pro | `e2e-remake login openai` |
| GitHub Copilot | `e2e-remake login github-copilot` |
| OpenCode Console | `e2e-remake login opencode-console` |
| SuperGrok or X Premium+ | `e2e-remake login spacexai` |
| API key or local gateway | Configure an AI SDK provider in `e2e.config.ts` |

Run `e2e-remake init` for an interactive scaffold and select **Claude Pro/Max subscription** when prompted.

## Development

```bash
pnpm build
pnpm --filter e2e run test:unit
pnpm typecheck
pnpm lint
```

The full suite may install browser components and start local test applications:

```bash
pnpm test
```

## License and service terms

The source code is licensed under the [Apache License 2.0](./LICENSE). Upstream attribution is preserved in [NOTICE](./NOTICE), with additional information in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

Apache-2.0 grants rights to this repository's code. It does not grant access to Anthropic services, a Claude subscription, model weights, or trademarks. Claude Code is an external prerequisite and is not bundled or redistributed by e2e-remake. Users remain responsible for Anthropic's applicable terms, plan eligibility, usage limits, data handling, and permitted automation.
