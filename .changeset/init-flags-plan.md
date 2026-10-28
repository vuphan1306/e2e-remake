---
"e2e": minor
---

`e2e init` takes its answers from flags (`--engine`, `--gateway`, `--endpoint`, `--app-url`, `--app-command`, `--skill`/`--no-skill`, `--mcp`/`--no-mcp`), and `--plan` prints every change as JSON with each file's full content and SHA-256 while writing nothing, so a coding agent can show each file to the project's owner first. `--app-command` writes `app.command` with `reuseExisting: true`. The runner is written as the npm alias `"e2e": "npm:@vuphan1306/e2e@^<version>"`, since the fork publishes under that scoped name.
