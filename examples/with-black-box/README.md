# e2e with a black-box website and a Claude subscription

A standalone test project for a website you can only reach by URL. It has
no app source and no dev server. The default target is the public demo shop
[saucedemo.com](https://www.saucedemo.com). Agent steps run on a Claude
Pro/Max subscription through the official Claude Code CLI, using
`claude()` from `e2e/oauth/claude`.

| Test | What it checks | AI |
| --- | --- | --- |
| [public.e2e.ts](tests/public.e2e.ts) | Username, Password and Login controls are visible | none |
| [claude.e2e.ts](tests/claude.e2e.ts) | Claude judges that the login page loaded (`agent.assert`) | 1 call |
| [claude-act.e2e.ts](tests/claude-act.e2e.ts) | Claude logs in by itself (`agent.act`), then a locator confirms "Products" | ~4 calls |

Every test runs on two Chromium viewports, `desktop` (1440×900) and
`mobile-web` (390×844).

## Run

Use Node 22.22.3+ or 24.8+, and a Claude Code installation signed in with
a Pro or Max plan:

```bash
claude auth login
claude auth status
```

Until e2e-remake is published, build and pack it from the repository root.
The package archive lands in `artifacts/`, which this folder's
`package.json` points at:

```bash
pnpm install && pnpm build
pnpm --dir packages/e2e pack --pack-destination ../../artifacts
```

Then, from this folder:

```bash
npm install
npx playwright install chromium
npm run test:e2e:report -- --no-cache
```

Set `APP_URL` to test another site that you own or are authorized to test.
See [.env.example](.env.example). Results are written to `.e2e/`.

## Recorded run

[evidence/](evidence) holds the raw `report.json`, `summary.md` and
`junit.xml` of a run on Windows on 14 October 2026: 6/6 passed in 40.6 s,
with 10 model calls on `claude-haiku-5-5`. The write-up is
`docs/evidence/saucedemo-run.md` at the repository root, also available as a
[web page](https://claude.ai/artifact/1UstkjYDmUUJGo7yaAtJez).

For CI or shared runners, use an Anthropic API key with `@ai-sdk/anthropic`
instead of a local Claude Code sign-in.

Last checked with e2e-remake 0.20.0, @e2e-dev/web 0.12.0, Node 24.8 and
Windows 11.
