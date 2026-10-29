---
"e2e": patch
---

On Windows, an `app.command` such as `{ executable: 'npm', args: ['run', 'dev'] }` now starts: a `.cmd` or `.bat` executable runs through `cmd.exe` with every argument escaped, so nothing in `args` is shell-interpreted. Stopping the command ends its whole process tree, so the dev server behind `cmd.exe` and `npm` no longer outlives the run and holds its port.
