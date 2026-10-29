/**
 * Packs or publishes the runner under the fork's scoped name.
 *
 * The unscoped `e2e` on npm is upstream's, so the fork publishes as the
 * manifest's `publishName` (`@vuphan1306/e2e`) and projects install it through
 * an npm alias, `"e2e": "npm:@vuphan1306/e2e@^<version>"`, which `e2e init`
 * writes. The workspace keeps the name `e2e` so its self-references and the
 * engines' `e2e` peer resolve; this script swaps the name in for the one pack
 * and restores the manifest afterwards, Ctrl+C included (a SIGKILL cannot be
 * caught; `git checkout -- package.json` then puts it back).
 *
 * Usage, from the package directory after `pnpm run build`:
 *   node scripts/release-fork.ts pack       # tarball in ../../artifacts/
 *   node scripts/release-fork.ts publish    # to the registry in publishConfig
 * Arguments after the mode go to `pnpm pack` / `pnpm publish` (e.g. `--tag canary`).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [mode, ...rest] = process.argv.slice(2);
if (mode !== 'pack' && mode !== 'publish') {
  console.error('usage: node scripts/release-fork.ts <pack|publish> [pnpm args...]');
  process.exit(2);
}

const original = readFileSync('package.json', 'utf8');
const manifest = JSON.parse(original) as { name: string; publishName?: string };
if (manifest.publishName === undefined) {
  console.error('package.json has no publishName; nothing to publish the fork as');
  process.exit(2);
}

const check = spawnSync(process.execPath, ['../../scripts/check-dist.ts'], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status ?? 1);

const args = mode === 'pack' ? ['pack', '--pack-destination', '../../artifacts', ...rest] : ['publish', '--no-git-checks', ...rest];
// Ctrl+C at npm's OTP prompt reaches pnpm through the terminal's process group.
// Without a handler Node would die here at once and skip the restore below;
// with one, the signal waits for pnpm to exit and the finally block runs.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {});
let status = 1;
try {
  writeFileSync('package.json', `${JSON.stringify({ ...manifest, name: manifest.publishName }, null, 2)}\n`);
  // pnpm is a .cmd shim on Windows, which only a shell runs.
  status = spawnSync('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1;
} finally {
  writeFileSync('package.json', original);
}
process.exit(status);
