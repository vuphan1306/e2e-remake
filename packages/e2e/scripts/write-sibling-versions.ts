/**
 * Records the engine versions `e2e init` installs.
 *
 * Upstream releases the engines alongside the runner, so their workspace
 * manifests name versions on npm. This fork publishes only the runner and
 * installs upstream's engines, whose workspace versions can name a release
 * npm never had (a pending changeset bumps them locally). So the manifest's
 * `publishedEngines` wins: the engine releases on npm this runner was checked
 * against. Without it, the sibling packages' manifests, as upstream does.
 *
 * Usage: `node scripts/write-sibling-versions.ts`, from the package directory,
 * after `tsc` emitted `dist`.
 */

import { readFileSync, writeFileSync } from 'node:fs';

type Manifest = { version: string; publishedEngines?: Record<string, string> };

const read = (dir: string) => JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) as Manifest;

const published = read('.').publishedEngines;
const versions = {
  '@e2e-dev/web': published?.['@e2e-dev/web'] ?? read('../web').version,
  '@e2e-dev/mobile': published?.['@e2e-dev/mobile'] ?? read('../mobile').version,
};
writeFileSync('dist/cli/init/sibling-versions.json', `${JSON.stringify(versions)}
`);
