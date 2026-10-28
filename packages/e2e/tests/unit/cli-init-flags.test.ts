/** `e2e init` flags through the real command line: commander's parsers and choices, and `--plan` against its schema. */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../src/cli/index.ts';

const SCHEMA = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../schema/init-plan-v1.schema.json'), 'utf8')) as Record<string, unknown>;

let dir: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

function written(spy: ReturnType<typeof vi.spyOn>): string {
  return stripVTControlCharacters(spy.mock.calls.map((call: readonly unknown[]) => String(call[0])).join(''));
}

async function invoke(...args: string[]): Promise<void> {
  await main(['node', 'e2e', 'init', dir, ...args]);
}

/** The plan printed on stdout, after checking it against `init-plan-v1.schema.json`. */
function printedPlan(): { files: { path: string; content: string }[]; skills: unknown[]; warnings: string[] } {
  const plan: unknown = JSON.parse(written(stdoutSpy));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(SCHEMA);
  const valid = validate(plan);
  expect(validate.errors ?? []).toEqual([]);
  expect(valid).toBe(true);
  return plan as { files: { path: string; content: string }[]; skills: unknown[]; warnings: string[] };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'e2e-init-flags-'));
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.stubEnv('npm_config_user_agent', 'npm/11.0.0');
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('e2e init flags', () => {
  it('plans from flags alone, matching the schema, and writes nothing', async () => {
    await invoke('--plan', '--engine', 'web', '--gateway', 'claude', '--app-url', 'http://localhost:5173', '--app-command', 'npm run dev', '--no-skill', '--no-mcp');
    expect(process.exitCode ?? 0).toBe(0);
    expect(readdirSync(dir)).toEqual([]);
    const plan = printedPlan();
    expect(plan.skills).toEqual([]);
    expect(plan.files.map((file) => file.path)).toEqual(['package.json', 'e2e.config.ts', 'tests/example.e2e.ts', '.gitignore']);
    const config = plan.files.find((file) => file.path === 'e2e.config.ts')!.content;
    expect(config).toContain("command: { executable: 'npm', args: ['run', 'dev'], reuseExisting: true },");
    expect(config).toContain("'http://localhost:5173'");
  });

  it('plans the skill everywhere with --skill, even where one location already holds it', async () => {
    writeFileSync(path.join(dir, '.mcp.json'), '{ "mcpServers": {} }\n');
    await invoke('--plan', '--skill', '--mcp');
    const plan = printedPlan();
    expect(plan.skills).toEqual([
      expect.objectContaining({ path: '.agents/skills/e2e', action: 'create' }),
      expect.objectContaining({ path: '.claude/skills/e2e', action: 'link' }),
    ]);
    expect(plan.files.map((file) => file.path)).toEqual(expect.arrayContaining(['.mcp.json', '.cursor/mcp.json']));
  });

  it("warns, in the plan, about an e2e dependency that is not this fork's alias", async () => {
    writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ devDependencies: { e2e: '^0.20.0' } })}\n`);
    await invoke('--plan', '--gateway', 'claude', '--no-skill', '--no-mcp');
    expect(printedPlan().warnings).toEqual([expect.stringMatching(/^package\.json declares e2e as \^0\.20\.0, not this fork; .*"e2e": "npm:/u)]);
  });

  it.each([
    [['--app-url', 'ftp://example.com'], 'must use http or https'],
    [['--app-url', 'localhost:3000'], 'must use http or https'],
    [['--app-command', '   '], 'must name the executable'],
    [['--endpoint', 'http://example.com/v1'], 'Must use HTTPS unless the host is loopback'],
    [['--engine', 'desktop'], 'Allowed choices are web, mobile, none'],
    [['--gateway', 'gemini'], 'Allowed choices are claude, vercel'],
  ])('rejects %j as a usage error before writing', async (args, message) => {
    await invoke('--plan', ...args);
    expect(process.exitCode).toBe(2);
    expect(written(stderrSpy)).toContain(message);
    expect(written(stdoutSpy)).toBe('');
    expect(readdirSync(dir)).toEqual([]);
  });
});
