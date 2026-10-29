import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dependencyRange, runnerDependency } from '../../src/cli/init/versions.ts';

describe('runnerDependency', () => {
  it('aliases the scoped fork as e2e when the manifest names a publishName', () => {
    expect(runnerDependency({ version: '0.20.0', publishName: '@vuphan1306/e2e' })).toBe('npm:@vuphan1306/e2e@^0.20.0');
  });

  it('pins a canary fork exactly behind the alias', () => {
    expect(runnerDependency({ version: '0.21.0-canary-20261028', publishName: '@vuphan1306/e2e' })).toBe('npm:@vuphan1306/e2e@0.21.0-canary-20261028');
  });

  it('writes the bare range without a publishName', () => {
    expect(runnerDependency({ version: '0.20.0' })).toBe('^0.20.0');
    expect(runnerDependency(undefined)).toBe('0.x');
  });
});

describe('dependencyRange', () => {
  it('asks for the minor of the engine version the build recorded', () => {
    expect(dependencyRange('0.7.0')).toBe('^0.7.0');
  });

  it('pins a canary engine to the exact build recorded next to the runner', () => {
    expect(dependencyRange('0.8.0-canary-20260910135247')).toBe('0.8.0-canary-20260910135247');
  });

  it('accepts any 0.x when running from source, where nothing was recorded', () => {
    expect(dependencyRange(undefined)).toBe('0.x');
  });
});

describe('the fork manifest', () => {
  // The build fails without these too; this names the rule where a rebase onto upstream would drop them.
  it('names a stable npm release of every engine init installs', () => {
    const manifest = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf8')) as {
      publishName?: string;
      publishedEngines?: Record<string, string>;
    };
    expect(manifest.publishName).toBe('@vuphan1306/e2e');
    expect(Object.keys(manifest.publishedEngines ?? {}).toSorted()).toEqual(['@e2e-dev/mobile', '@e2e-dev/web']);
    for (const version of Object.values(manifest.publishedEngines ?? {})) expect(version).toMatch(/^\d+\.\d+\.\d+$/u);
  });
});
