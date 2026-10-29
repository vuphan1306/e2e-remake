/**
 * Records the engine versions `e2e init` installs.
 *
 * Upstream releases the engines alongside the runner, so their workspace
 * manifests name versions on npm. This fork publishes only the runner (its
 * manifest has a `publishName`) and installs upstream's engines, whose
 * workspace versions can name a release npm never had (a pending changeset
 * bumps them locally). So a fork build takes every engine from the
 * manifest's `publishedEngines`, the engine releases on npm this runner was
 * checked against, and fails when one is missing rather than fall back to
 * the workspace. Without `publishName`, the sibling manifests, as upstream.
 *
 * Usage: `node scripts/write-sibling-versions.ts`, from the package directory,
 * after `tsc` emitted `dist`.
 */

import { readFileSync, writeFileSync } from 'node:fs';

type Manifest = { version: string; publishName?: string; publishedEngines?: Record<string, string> };

const ENGINES = { '@e2e-dev/web': 'web', '@e2e-dev/mobile': 'mobile' } as const;

const read = (dir: string) => JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) as Manifest;

const own = read('.');
const versions: Record<string, string> = {};
for (const [name, dir] of Object.entries(ENGINES)) {
  if (own.publishName === undefined) {
    versions[name] = read(`../${dir}`).version;
    continue;
  }
  const published = own.publishedEngines?.[name];
  if (published === undefined) {
    console.error(`package.json publishes as ${own.publishName} but its publishedEngines names no ${name}; add the npm release init should install`);
    process.exit(1);
  }
  versions[name] = published;
}
writeFileSync('dist/cli/init/sibling-versions.json', `${JSON.stringify(versions)}\n`);
