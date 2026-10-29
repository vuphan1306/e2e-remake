---
"e2e": patch
---

`e2e init` writes the engine releases on npm this runner was checked against (`@e2e-dev/web` `^0.15.3`, `@e2e-dev/mobile` `^0.12.4`) instead of the workspace versions, which named an older web engine and, after a pending changeset, a release npm never had.
