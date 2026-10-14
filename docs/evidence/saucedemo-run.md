# e2e-remake: evidence from a black-box test run

**Date:** 14 October 2026 · **Target:** https://www.saucedemo.com (public demo shop) · **Result:** 6/6 tests passed

**Web version of this report:** [e2e-remake Run Evidence](https://claude.ai/artifact/1UstkjYDmUUJGo7yaAtJez)

This document records a real run of a standalone black-box test project (now kept in this repository as `examples/with-black-box/`) against a public website, using **e2e-remake** with a **Claude Pro/Max subscription** through the official Claude Code CLI. It also explains why the fork exists.

---

## 1. Why e2e-remake is needed

[`tester-army/e2e`](https://github.com/tester-army/e2e) is an agentic end-to-end test runner: tests mix deterministic Playwright-style assertions with natural-language agent steps (`agent.act`, `agent.assert`) that call an LLM.

What upstream offers for Claude (checked against upstream commit `292cd059`, 13 Oct 2026, and the live page https://e2e.tester.army/docs/subscriptions):

- Subscription sign-ins exist for **ChatGPT, GitHub Copilot, OpenCode Console and SuperGrok** (`e2e login openai | github-copilot | opencode-console | spacexai`). There is **no Claude sign-in and no `claude()` model**. The upstream docs say: "Claude plans have no sign-in for other apps."
- **Claude Max or Team:** an Anthropic API key from a Claude Console organization linked to the plan, used with `anthropic()` from `@ai-sdk/anthropic`. Calls are "paid from the plan's monthly API credits, not its usage limits", and unused credits expire each billing cycle.
- **Claude Pro:** no API credits. Upstream points to a pay-per-token API provider, or a Claude model through a GitHub Copilot plan.

So upstream cannot run agent steps on the **usage limits of a Claude Pro or Max subscription**, the same allowance you use in Claude Code every day.

**e2e-remake adds exactly that, without touching credentials:** `claude(model)` sends each model call through the official Claude Code CLI (`claude -p`), so it runs on the signed-in plan's usage limits with no API key and no API credits.

| | Upstream `e2e` | `e2e-remake` |
| --- | --- | --- |
| Claude Pro/Max **subscription usage limits** | Not supported ("Claude plans have no sign-in for other apps") | Supported: `claude('sonnet' \| 'opus' \| 'haiku' \| full model id)` from `e2e/oauth/claude` |
| Claude Max/Team **monthly API credits** | Supported: API key + `anthropic()` | Still supported (inherited unchanged) |
| Claude Pro, without paying per token | Not possible (Pro has no API credits) | Supported through `claude()` |
| How Claude is called | Anthropic API (`@ai-sdk/anthropic`) | Official `claude -p` (non-interactive Claude Code) per model call |
| Credential handling | n/a | Never reads, copies, stores or refreshes Claude credentials; auth stays inside Claude Code |
| Accidental API billing | n/a | Child process strips `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and the Bedrock / Vertex / Foundry routing flags |
| Isolation of each model call | n/a | Claude Code tools, project instructions, plugins, hooks, session persistence and permission prompts disabled (`--tools ""`, `--safe-mode`, `--no-session-persistence`, `--permission-mode dontAsk`, …) |
| Login command | `e2e login` (other vendors) | `e2e-remake login anthropic` → delegates to `claude auth login` |
| Telemetry | Sends anonymous usage to upstream | Disabled by default (the fork must not report to upstream's account) |
| Platforms | Windows / Linux / macOS | Same; this run was on Windows 11 |

Everything else (runner, web/mobile engines, deterministic locators, assertions, recordings, reports, and the other providers) is inherited unchanged. The package and import name stay `e2e` for ecosystem compatibility; the CLI is `e2e-remake` with `e2e` as an alias.

**Scope and limits**
- Intended for a developer's own machine with a signed-in Claude Code. For CI or shared runners, use an Anthropic API key with `@ai-sdk/anthropic`.
- Each model call starts the Claude Code CLI, so a call takes roughly 5–10 s. That is fine for a test suite but slower than a direct API call.
- Independent project under Apache-2.0; not affiliated with or endorsed by TesterArmy or Anthropic. Users remain responsible for their plan's eligibility, usage limits and Anthropic's terms.

---

## 2. Build and test evidence for the fork

Checked on a clean install (`pnpm install --frozen-lockfile`, pnpm 12.3.4, Node 22) before packing.

| Check | Result |
| --- | --- |
| `pnpm typecheck` (build 9 packages + `tsc --noEmit` on 13 workspaces + scripts) | ✅ no errors |
| Unit tests, `e2e` core package | ✅ 2,599 passed, 2 skipped (179 files) |
| Unit tests, `mobile` / `github` / `kernel` / `eas` / `smol` / `limrun` | ✅ 262 / 32 / 16 / 37 / 19 / 14 passed |
| Repository script tests | ✅ 22 / 22 |
| Unit tests, `web` and `decision` | 261/262 and 143 passed; the remaining test in each needs a Chromium binary that the Linux sandbox could not download (environment, not code). Real-browser behaviour is covered by the run in section 3. |

The check found 4 stale assertions that still expected the upstream name (`Usage: e2e …`, `User-Agent: e2e/…`). They were updated to `e2e-remake`, and all CLI and OAuth tests pass (164/164).

Packaged with `pnpm --dir packages/e2e pack` → `e2e-0.20.0.tgz`, then installed into the test project.

---

## 3. Black-box run evidence

### Test project

A separate folder with no access to the website's source code:

```text
examples/with-black-box/
├── package.json      # e2e (local .tgz), @e2e-dev/web, ai
├── e2e.config.ts
└── tests/
    ├── public.e2e.ts        # deterministic checks only
    ├── claude.e2e.ts        # agent.assert (Claude judges the page)
    └── claude-act.e2e.ts    # agent.act (Claude operates the page)
```

`e2e.config.ts` (abridged):

```ts
import { claude } from 'e2e/oauth/claude';
import { web } from '@e2e-dev/web';

export default {
  tests: 'tests/**/*.e2e.ts',
  agents: {
    default: {
      model: claude('claude-haiku-5-5'),   // runs on the Claude subscription
      system: 'You are testing an authorized website as a careful QA engineer. '
            + 'Do not submit payments, delete data, send messages, or perform destructive actions. '
            + 'Verify the visible result after every important action.',
    },
  },
  targets: [
    { name: 'desktop',    engine: web({ browser: 'chromium', viewport: { width: 1440, height: 900 } }), app: { url: 'https://www.saucedemo.com' } },
    { name: 'mobile-web', engine: web({ browser: 'chromium', viewport: { width: 390,  height: 844 } }), app: { url: 'https://www.saucedemo.com' } },
  ],
} satisfies E2EConfig;
```

The three tests:

```ts
// public.e2e.ts: no AI
await app.open('/');
await expect(screen.getByRole('textbox', 'Username')).toBeVisible();
await expect(screen.getByRole('textbox', 'Password')).toBeVisible();
await expect(screen.getByRole('button', 'Login')).toBeVisible();

// claude.e2e.ts: Claude judges the page
await agent.assert('The Swag Labs login page is visible with username, password, and login controls.');

// claude-act.e2e.ts: Claude drives the page, then a deterministic check confirms it
await agent.act('Log in with username "standard_user" and password "secret_sauce". Stop after the products page is visible.');
await expect(screen.getByText('Products')).toBeVisible();
```

(`standard_user` / `secret_sauce` are the public demo credentials printed on saucedemo.com.)

### Command and environment

```bash
npx e2e-remake run --reporter list,markdown,junit --no-cache
```

| | |
| --- | --- |
| Run id | `01a13888-c950-77df-b6c4-abdb4693a4f5` |
| Started / finished | 2026-10-14 03:50:51 → 03:51:32 UTC |
| OS / runtime | Windows (win32 10.0.26200, x64), Node v24.8.0 |
| Runner / engine | e2e-remake 0.20.0, `@e2e-dev/web` 0.12.0, Chromium |
| Model | `anthropic.claude-code/claude-haiku-5-5` (Claude subscription via Claude Code) |
| Cache | Disabled (`--no-cache`): every agent step really called the model |

### Results: 6 passed, 0 failed, 0 flaky, 0 retries, 40.6 s

| Test | desktop 1440×900 | mobile-web 390×844 |
| --- | --- | --- |
| Public login page loads (deterministic) | ✅ 6.5 s | ✅ 0.6 s |
| Claude judges the login page (`agent.assert`) | ✅ 16.2 s · 1 model call | ✅ 6.1 s · 1 model call |
| Claude completes the login (`agent.act` + `expect`) | ✅ 35.4 s · 4 model calls | ✅ 39.1 s · 4 model calls |

**AI usage:** 10 model calls, 149.5k tokens, about 59% served from prompt cache.

### What the agent actually did (from `report.json`)

Same sequence on both targets, with no wasted or repeated actions:

| # | Engine action | Page after the action |
| --- | --- | --- |
| 1 | type `"standard_user"` into textbox "Username" | login page (12 elements) |
| 2 | type `"secret_sauce"` into textbox "Password" | login page (12 elements) |
| 3 | tap button "Login" | products page (65 elements on desktop, 64 on mobile) |
| 4 | model confirms the goal is reached; `expect(getByText('Products'))` passes on the first poll | |

Model calls in the act step took 5.0–9.6 s each (17–23k input tokens, 350–650 output tokens). Every action is a concrete, replayable engine command. The agent never ran free-form browser automation.

The raw `report.json`, `summary.md` and `junit.xml` of this run are kept in `examples/with-black-box/evidence/`.

### JUnit output (`.e2e/junit.xml`)

```xml
<testsuites name="e2e" tests="6" failures="0" errors="0" skipped="0" time="103.951">
  <testsuite name="tests/claude-act.e2e.ts" tests="2" failures="0">
    <testcase name="Claude can complete the demo login flow [desktop]"     time="35.368"/>
    <testcase name="Claude can complete the demo login flow [mobile-web]"  time="39.132"/>
  </testsuite>
  <testsuite name="tests/claude.e2e.ts" tests="2" failures="0">
    <testcase name="Claude can judge the loaded login page [desktop]"      time="16.194"/>
    <testcase name="Claude can judge the loaded login page [mobile-web]"   time="6.132"/>
  </testsuite>
  <testsuite name="tests/public.e2e.ts" tests="2" failures="0">
    <testcase name="the public home page loads successfully [desktop]"     time="6.508"/>
    <testcase name="the public home page loads successfully [mobile-web]"  time="0.617"/>
  </testsuite>
</testsuites>
```
(`time` is the sum of per-test durations; tests ran in parallel, so the wall clock was 40.6 s.)

---

## 4. Reproduce it yourself

```bash
# 1. Claude Code, signed in with a Pro/Max plan
claude --version && claude auth login && claude auth status

# 2. Build and pack e2e-remake
cd e2e-remake
corepack enable && corepack prepare pnpm@12.3.4 --activate
pnpm install && pnpm build
pnpm --dir packages/e2e pack --pack-destination ../../artifacts

# 3. Test project (ready-made in examples/with-black-box)
cd examples/with-black-box
npm install
npx playwright install chromium

# 4. Run
npx e2e-remake run --reporter list,markdown,junit --no-cache
```

Only test websites you own or are authorized to test. Prefer staging environments and test accounts.

## 5. What this run does and does not show

- **Shows:** a Claude Pro/Max subscription can drive and judge real browser tests end to end, through the official Claude Code CLI, on Windows, across desktop and mobile viewports, with standard JUnit/Markdown/JSON reports.
- **Does not show yet:** deeper flows (cart, checkout up to the overview step, sorting, error users such as `locked_out_user`, logout), long suites under subscription usage limits, or Linux/macOS runs of this exact project (the code is cross-platform and the unit tests run on Linux).
