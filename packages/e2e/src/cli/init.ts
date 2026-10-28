/** Non-destructive project scaffolding. */

import * as clack from '@clack/prompts';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectPackageManager, execCommand, runScriptCommand } from '../internal/package-manager.ts';
import { DOCS_URL } from './docs-url.ts';
import {
  describeLinks,
  describeObstacles,
  findInstalledSkillDirs,
  holdsCopyAfter,
  planSkillInstall,
  planSkillLink,
  replaceableLinks,
  SKILL_LOCATIONS,
  splitSkillDirs,
  type SkillInstall,
} from './init/agent-skill.ts';
import { isLoopbackHost } from '../internal/urls.ts';
import { getEnginePresets, DEFAULT_ENGINE_ID, type EngineId } from './init/engines.ts';
import { GATEWAYS, getGatewayPreset, type GatewayId } from './init/gateways.ts';
import { findRegisteredMcpFiles, MCP_LOCATIONS, planMcpRegistration } from './init/mcp-config.ts';
import { addDependencies, addScripts, describeManifestError, readPackage, serializePackage } from './init/package.ts';
import { createScaffold, type ScaffoldModel } from './init/scaffold.ts';
import { MISSING_SKILL_MESSAGE, readSkillFiles } from './skill.ts';
import { playWordmark } from './wordmark.ts';
import type { InitOutcome, InitResult } from '../telemetry/events.ts';

export interface InitOptions {
  yes?: boolean;
  /**
   * The directory argument as the user typed it, when `cwd` was chosen from
   * one; the closing `Next:` line then starts with `cd` into it.
   */
  directory?: string;
  /**
   * Whether prompts can be answered. The CLI passes its terminal state; a
   * non-interactive run without `--yes` stops before asking anything, since
   * a prompt nobody can answer would otherwise wait forever.
   */
  interactive?: boolean;
  /** The engine for a new config, in place of the prompt. */
  engine?: EngineId;
  /** The model gateway for a new config, or `none`, in place of the prompt. */
  gateway?: GatewayChoice;
  /** The base URL for the `openai-compatible` gateway, already validated. */
  endpoint?: string;
  /** The app URL a web or HTTP config points at instead of http://localhost:3000. */
  appUrl?: string;
  /** The dev server the runner starts (or reuses), split on whitespace. */
  appCommand?: readonly string[];
  /** False skips the agent skill, true takes every location; unset asks (or every location under `--yes`). */
  skill?: boolean;
  /** False skips the MCP registration, true takes every location; unset asks (or every location under `--yes`). */
  mcp?: boolean;
  /**
   * Print the changes as JSON on stdout and write nothing. Implies `yes`: the
   * caller (a coding agent) shows each file to its owner and writes the ones
   * approved itself, or reruns init without it to write them all.
   */
  plan?: boolean;
}

/** One file `--plan` reports, with the exact content init would write and its digest. */
interface PlannedFile {
  readonly path: string;
  readonly action: 'create' | 'update';
  readonly sha256: string;
  readonly content: string;
}

/** What `e2e init --plan` prints: every change init would make, nothing written. */
interface InitPlan {
  readonly version: 1;
  readonly files: readonly PlannedFile[];
  readonly skills: readonly { readonly path: string; readonly action: 'create' | 'update' | 'replace' | 'link'; readonly target?: string; readonly files?: number }[];
  /** Existing files init leaves alone. */
  readonly untouched: readonly string[];
  readonly dependencies: readonly (readonly [string, string])[];
  readonly scripts: readonly (readonly [string, string])[];
  readonly install: string;
  readonly next: readonly string[];
}

/** The terminal output `init` writes through; `--plan` swaps in one that keeps stdout for the JSON. */
interface InitUi {
  intro(title: string): void;
  outro(message: string): void;
  readonly log: {
    info(message: string): void;
    success(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
}

const toStderr = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

/** Under `--plan`: warnings and errors on stderr, progress nowhere. */
const QUIET_UI: InitUi = {
  intro: () => {},
  outro: () => {},
  log: { info: () => {}, success: () => {}, warn: toStderr, error: toStderr },
};

const CACHE_IGNORE_ENTRY = '.e2e/cache/';

const GITIGNORE_ENTRIES = [
  'node_modules/',
  '.e2e/results/',
  CACHE_IGNORE_ENTRY,
  '.e2e/sessions/',
  '.e2e/report.json',
  '.e2e/ai-trace.json',
  '.e2e/junit.xml',
  '.e2e/summary.md',
  '.e2e/logs/',
  '.e2e/videos/',
];

const RUN_SCRIPT = 'test:e2e';
const SCRIPTS = { [RUN_SCRIPT]: 'e2e run' };

/** The gateway `--yes` picks; the choice is written into the config either way. */
const DEFAULT_GATEWAY: GatewayId = 'vercel';

type GatewayChoice = GatewayId | 'none';

/**
 * Runs `e2e init`. Every prompt happens before the first write, existing
 * config and test files are never touched, and dependencies install only when
 * the user asks. The agent skill is offered once; later runs refresh the
 * copies that exist, never add new locations, and never write through a
 * symlink.
 */
export async function init(cwd: string, options: InitOptions = {}): Promise<InitOutcome & { readonly exitCode: number }> {
  const yes = options.yes === true || options.plan === true;
  const ui: InitUi = options.plan === true ? QUIET_UI : clack;
  // The wordmark drops in above the wizard, at rest when --yes asked for no questions; a terminal is the one place it shows.
  if (options.interactive !== false && options.plan !== true) await playWordmark(process.stdout, { motion: !yes });
  ui.intro(options.directory === undefined ? 'e2e init' : `e2e init ${options.directory}`);
  // Filled in as the choices are made; every return hands them back with how the run ended.
  const facts: { -readonly [Key in keyof Omit<InitOutcome, 'result'>]: InitOutcome[Key] } = {
    yes,
    existingConfig: false,
    engine: null,
    gateway: null,
    skill: false,
    mcp: false,
    install: false,
  };
  const done = (result: InitResult, exitCode: number): InitOutcome & { readonly exitCode: number } => ({
    exitCode,
    result,
    ...facts,
  });
  const cancel = (): InitOutcome & { readonly exitCode: number } => done('cancelled', cancelled());

  if (options.interactive === false && !yes) {
    ui.log.error(
      'e2e init asks questions and needs an interactive terminal; run it from a terminal, or pass --yes to accept the defaults (Playwright, the Vercel AI Gateway, no installation)',
    );
    return done('not-interactive', 2);
  }
  if (existsSync(cwd) && !statSync(cwd).isDirectory()) {
    ui.log.error(`${options.directory ?? cwd} is a file, not a directory`);
    return done('invalid-project', 2);
  }

  let pkg: ReturnType<typeof readPackage>;
  try {
    pkg = readPackage(cwd);
  } catch (cause) {
    ui.log.error(`${path.join(cwd, 'package.json')} could not be read: ${describeManifestError(cause)}; fix it before running e2e init`);
    return done('invalid-project', 2);
  }
  const bundledSkill = readSkillFiles();
  if (bundledSkill.length === 0) {
    ui.log.error(MISSING_SKILL_MESSAGE);
    return done('invalid-project', 2);
  }

  const existingConfig = ['e2e.config.ts', 'e2e.config.mts'].find((file) => existsSync(path.join(cwd, file)));
  const examplePath = path.join('tests', 'example.e2e.ts');
  const exampleExists = existsSync(path.join(cwd, examplePath));
  facts.existingConfig = existingConfig !== undefined;
  if (existingConfig !== undefined) ui.log.warn(`Exists, not touching: ${existingConfig}`);
  if (exampleExists) ui.log.warn(`Exists, not touching: ${examplePath}`);

  const gitignorePath = path.join(cwd, '.gitignore');
  const existingIgnore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  const ignoreLines = existingIgnore.split(/\r?\n/);
  const missingIgnore = GITIGNORE_ENTRIES.filter((entry) => !ignoreLines.includes(entry));

  // Engine and model gateway are choices for a new config only; an existing config keeps its own dependencies.
  // A flag answers its question; --yes takes the default for the rest.
  let engine: EngineId = existingConfig === undefined ? options.engine ?? DEFAULT_ENGINE_ID : 'none';
  let model: ScaffoldModel | undefined = existingConfig === undefined ? gatewayModel(options.gateway ?? DEFAULT_GATEWAY, options.endpoint) : undefined;
  if (existingConfig === undefined && !yes && options.engine === undefined) {
    const selectedEngine = await clack.select<EngineId>({
      message: 'Which engine?',
      initialValue: DEFAULT_ENGINE_ID,
      options: getEnginePresets().map(({ id, label, hint }) => ({ value: id, label, hint })),
    });
    if (isCancelled(selectedEngine)) return cancel();
    engine = selectedEngine;
  }
  if (existingConfig === undefined && !yes && options.gateway === undefined) {
    // The gateway is a visible choice, not a runner default: the config imports
    // its provider package and constructs the model.
    const gateway = await clack.select<GatewayChoice>({
      message: 'Which model gateway for agent steps? Adds AI SDK v7.',
      initialValue: DEFAULT_GATEWAY,
      options: [
        ...GATEWAYS.map(({ id, label, hint }) => ({ value: id, label, hint })),
        { value: 'none', label: 'None', hint: 'deterministic tests only; add a gateway later' },
      ],
    });
    if (isCancelled(gateway)) return cancel();
    model = gatewayModel(gateway, options.endpoint);
  }
  if (existingConfig === undefined && !yes && model?.gateway === 'openai-compatible' && options.endpoint === undefined) {
    const endpoint = await clack.text({
      message: 'Base URL of the OpenAI-compatible API',
      placeholder: 'http://127.0.0.1:11434/v1',
      validate: validateEndpoint,
    });
    if (isCancelled(endpoint)) return cancel();
    model = gatewayModel('openai-compatible', endpoint.trim());
  }
  if (existingConfig === undefined) {
    facts.engine = engine;
    facts.gateway = model?.gateway ?? 'none';
  }

  const skillDirs = await chooseLocations(
    findInstalledSkillDirs(cwd),
    SKILL_LOCATIONS.map(({ dir, hint }) => ({ value: dir, hint })),
    'Install the e2e skill for coding agents?',
    yes,
    options.skill,
  );
  if (isCancelled(skillDirs)) return cancel();
  facts.skill = skillDirs.length > 0;
  const { copies, links } = splitSkillDirs(skillDirs);
  const plannedCopies = planSkillInstall(cwd, copies, bundledSkill);
  const skillInstalls: SkillInstall[] = [];
  for (const planned of plannedCopies) {
    const proceed = await confirmSkillInstall(ui, planned, yes);
    if (isCancelled(proceed)) return cancel();
    if (proceed) skillInstalls.push(planned);
  }
  for (const { dir, linksTo } of links) {
    const planned = planSkillLink(cwd, dir, linksTo, bundledSkill, holdsCopyAfter(linksTo, plannedCopies, skillInstalls));
    if (planned === undefined) continue;
    const proceed = await confirmSkillInstall(ui, planned, yes);
    if (isCancelled(proceed)) return cancel();
    if (proceed) skillInstalls.push(planned);
  }

  const mcpFiles = await chooseLocations(
    findRegisteredMcpFiles(cwd),
    MCP_LOCATIONS.map(({ file, hint }) => ({ value: file, hint })),
    'Register the e2e MCP server for coding agents?',
    yes,
    options.mcp,
  );
  if (isCancelled(mcpFiles)) return cancel();
  facts.mcp = mcpFiles.length > 0;
  let mcpRegistrations: ReturnType<typeof planMcpRegistration>['registrations'];
  try {
    const plan = planMcpRegistration(cwd, mcpFiles);
    mcpRegistrations = plan.registrations;
    for (const link of plan.links) {
      ui.log.warn(`Symlink, not touching: ${link.relative} -> ${link.target} (e2e mcp server)`);
    }
  } catch (cause) {
    ui.log.error(cause instanceof Error ? cause.message : String(cause));
    return done('invalid-project', 2);
  }

  const scaffold = createScaffold(engine, model, {
    ...(options.appUrl === undefined ? {} : { url: options.appUrl }),
    ...(options.appCommand === undefined ? {} : { command: options.appCommand }),
  });
  const dependencies = addDependencies(pkg.manifest, scaffold.dependencies);
  const { manifest, additions: scripts } = addScripts(dependencies.manifest, SCRIPTS);
  if (dependencies.additions.length > 0) {
    ui.log.info(`Add dev dependencies: ${dependencies.additions.map(([name, version]) => `${name}@${version}`).join(', ')}`);
  }
  if (scripts.length > 0) {
    ui.log.info(`Add scripts: ${scripts.map(([name, command]) => `${name} (${command})`).join(', ')}`);
  }

  const files = [
    ...(pkg.original === undefined || dependencies.additions.length > 0 || scripts.length > 0
      ? [{ relative: 'package.json', content: serializePackage(manifest, pkg.original), existing: pkg.original !== undefined }]
      : []),
    ...(existingConfig === undefined ? [{ relative: 'e2e.config.ts', content: scaffold.config, existing: false }] : []),
    ...(exampleExists ? [] : [{ relative: examplePath, content: scaffold.example, existing: false }]),
  ];
  const ignorePrefix = existingIgnore === '' || existingIgnore.endsWith('\n') ? '' : '\n';
  const ignoreContent = `${existingIgnore}${ignorePrefix}${missingIgnore.join('\n')}\n`;
  const manager = detectPackageManager(cwd, manifest.packageManager);
  const nextSteps = (installed: boolean): string[] => {
    // The script init adds, unless the project already had one of its own under that name.
    const runCommand = /^e2e run(?:\s|$)/u.test(manifest.scripts?.[RUN_SCRIPT] ?? '')
      ? runScriptCommand(manager, RUN_SCRIPT)
      : execCommand(manager, 'e2e run');
    // A subscription gateway has no key to set; the sign-in is the step before the first run.
    const subscription = model === undefined ? undefined : getGatewayPreset(model.gateway).login;
    // A config that names its app URL or starts its own server needs no APP_URL to run.
    const appUrl = scaffold.needsAppUrl && options.appUrl === undefined && options.appCommand === undefined;
    return [
      options.directory === undefined ? undefined : `cd ${shellArgument(options.directory)}`,
      installed ? undefined : `${manager} install`,
      subscription === undefined
        ? undefined
        : subscription === 'anthropic'
          ? 'claude auth login'
          : execCommand(manager, `e2e login ${subscription}`),
      `${appUrl ? 'APP_URL=http://localhost:3000 ' : ''}${runCommand}`,
    ].filter((step) => step !== undefined);
  };

  if (options.plan === true) {
    const planned: InitPlan = {
      version: 1,
      files: [
        ...files.map((file) => plannedFile(file.relative, file.existing, file.content)),
        ...mcpRegistrations.map((registration) => plannedFile(registration.relative, registration.existing, registration.content)),
        ...(missingIgnore.length > 0 ? [plannedFile('.gitignore', existingIgnore !== '', ignoreContent)] : []),
      ],
      skills: skillInstalls.map((install) => install.kind === 'link'
        ? { path: install.relative, action: 'link', target: install.target }
        : { path: install.relative, action: install.links.length > 0 ? 'replace' : install.existing ? 'update' : 'create', files: install.files.length }),
      untouched: [...(existingConfig === undefined ? [] : [existingConfig]), ...(exampleExists ? [examplePath] : [])],
      dependencies: dependencies.additions,
      scripts,
      install: `${manager} install`,
      next: nextSteps(false),
    };
    process.stdout.write(`${JSON.stringify(planned, null, 2)}\n`);
    return done('planned', 0);
  }

  if (files.length === 0 && skillInstalls.length === 0 && mcpRegistrations.length === 0 && missingIgnore.length === 0) {
    ui.outro('Nothing to create; project already initialized');
    return done('already-initialized', 0);
  }

  if (!yes) {
    const actions = [
      ...files.map((file) => `${file.existing ? 'Update' : 'Create'} ${file.relative}`),
      ...skillInstalls.map((install) => install.kind === 'link'
        ? `Link ${install.relative} -> ${install.target}${linkReplaces(install, 'replacing')}`
        : `${install.links.length > 0 ? 'Replace' : install.existing ? 'Update' : 'Create'} ${install.relative}/`),
      ...mcpRegistrations.map((registration) => `${registration.existing ? 'Update' : 'Create'} ${registration.relative}`),
      ...(missingIgnore.length > 0 ? ['Update .gitignore'] : []),
    ];
    // One change per line: a dozen paths in one sentence is unreadable.
    ui.log.info(['Changes:', ...actions.map((action) => `  - ${action}`)].join('\n'));
    const proceed = await clack.confirm({ message: 'Apply these changes?' });
    if (isCancelled(proceed) || !proceed) return cancel();
  }

  let install = false;
  if (!yes) {
    const selected = await clack.confirm({ message: `Install dependencies with ${manager}?`, initialValue: true });
    if (isCancelled(selected)) return cancel();
    install = selected;
  }
  facts.install = install;

  // The first write; a directory named on the command line comes into being here.
  mkdirSync(cwd, { recursive: true });
  for (const file of files) {
    const absolute = path.join(cwd, file.relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, file.content, 'utf8');
    ui.log.success(`${file.existing ? 'Updated' : 'Created'} ${file.relative}`);
  }
  for (const skill of skillInstalls) {
    for (const link of skill.links) unlinkSync(path.join(cwd, link.relative));
    if (skill.kind === 'link') {
      const absolute = path.join(cwd, skill.relative);
      if (skill.existing) rmSync(absolute, { recursive: true });
      mkdirSync(path.dirname(absolute), { recursive: true });
      symlinkSync(skill.target, absolute, process.platform === 'win32' ? 'junction' : 'dir');
      ui.log.success(`Linked ${skill.relative} -> ${skill.target}${linkReplaces(skill, 'replaced')}`);
      continue;
    }
    for (const file of skill.files) {
      mkdirSync(path.dirname(file.absolute), { recursive: true });
      writeFileSync(file.absolute, file.content, 'utf8');
    }
    const verb = skill.links.length > 0 ? 'Replaced' : skill.existing ? 'Updated' : 'Created';
    ui.log.success(`${verb} ${skill.relative}/ (${skill.files.length} files)`);
  }
  if (skillDirs.length === 0) {
    ui.log.info(`Skipped the agent skill; agents can still print it with ${execCommand(manager, 'e2e guide')}`);
  }
  for (const registration of mcpRegistrations) {
    mkdirSync(path.dirname(registration.absolute), { recursive: true });
    writeFileSync(registration.absolute, registration.content, 'utf8');
    ui.log.success(`${registration.existing ? 'Updated' : 'Created'} ${registration.relative} (e2e mcp server)`);
  }
  if (mcpFiles.length === 0) {
    ui.log.info('Skipped the MCP server; register it later with: claude mcp add e2e -- npx e2e mcp');
  }
  if (missingIgnore.length > 0) {
    writeFileSync(gitignorePath, ignoreContent, 'utf8');
    ui.log.success(`Updated .gitignore (${missingIgnore.length} entries)`);
    if (missingIgnore.includes(CACHE_IGNORE_ENTRY)) {
      ui.log.info(`${CACHE_IGNORE_ENTRY} is ignored; committing agent.act replays is opt-in, see ${DOCS_URL}/cache#commit-the-replay-cache`);
    }
  }

  if (install) {
    const result = spawnSync(manager, ['install'], { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.error !== undefined || result.status !== 0) {
      const reason = result.error?.message ?? `exit ${result.status ?? result.signal}`;
      ui.log.error(`Installation failed (${reason}); retry with ${manager} install`);
      ui.outro('Scaffold saved');
      return done('install-failed', result.signal === 'SIGINT' ? 130 : 2);
    }
  }
  if (!existsSync(path.join(cwd, 'tsconfig.json'))) {
    ui.log.info('No tsconfig.json; add one for editor completions on e2e.config.ts and tests/');
  }
  ui.outro(`Next: ${nextSteps(install).join(', then ')}`);
  return done('scaffolded', 0);
}

/**
 * A path as the user will paste it into their shell: bare while every character
 * is safe, otherwise quoted for the platform (single quotes for POSIX shells,
 * double quotes for cmd and PowerShell), so `apps/my web` stays one argument.
 */
function shellArgument(value: string): string {
  if (/^[A-Za-z0-9_./@%+=:,-]+$/.test(value)) return value;
  return os.platform() === 'win32' ? `"${value.replaceAll('"', '""')}"` : `'${value.replaceAll("'", "'\\''")}'`;
}

/** The model a gateway choice writes into a new config; `none` writes none. */
function gatewayModel(gateway: GatewayChoice, endpoint: string | undefined): ScaffoldModel | undefined {
  if (gateway === 'none') return undefined;
  return gateway === 'openai-compatible' && endpoint !== undefined ? { gateway, endpoint } : { gateway };
}

/** One `--plan` file entry; the digest is of the UTF-8 bytes init would write. */
function plannedFile(relative: string, existing: boolean, content: string): PlannedFile {
  return {
    path: relative.replaceAll('\\', '/'),
    action: existing ? 'update' : 'create',
    sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
    content,
  };
}

/** The same rule config resolution applies: HTTPS, or HTTP on a loopback host. */
export function validateEndpoint(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return 'Enter the base URL, e.g. http://127.0.0.1:11434/v1';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return `Not a URL: ${trimmed}`;
  }
  if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))) return undefined;
  return 'Must use HTTPS unless the host is loopback';
}

/**
 * Whether a planned skill write goes ahead. An entry a write cannot pass, or
 * a symlink init would write through, is skipped with a warning naming it; a
 * linked skill directory is replaced when the user agrees, never under
 * `--yes`. The cancel symbol when the user leaves the question.
 */
async function confirmSkillInstall(ui: InitUi, planned: SkillInstall, yes: boolean): Promise<boolean | symbol> {
  if (planned.obstacles.length > 0) {
    ui.log.warn(`Broken, not touching: ${describeObstacles(planned)}`);
    return false;
  }
  if (planned.links.length === 0) return true;
  if (yes || !replaceableLinks(planned)) {
    ui.log.warn(`Symlink, not touching: ${describeLinks(planned)}`);
    return false;
  }
  const replacement = planned.kind === 'link' ? `a link to ${planned.target}` : 'a copy of the skill';
  return clack.confirm({ message: `Replace the symlink ${describeLinks(planned)} with ${replacement}?`, initialValue: false });
}

/** What a link takes the place of, for the summary (`replacing`) and the success line (`replaced`); empty when nothing is there. */
function linkReplaces(install: SkillInstall, verb: 'replacing' | 'replaced'): string {
  const what = install.links.length > 0 ? 'the symlink' : install.existing ? 'the copy' : undefined;
  return what === undefined ? '' : ` (${verb} ${what})`;
}

/** Cancellation is only reachable before the first write, so nothing needs undoing. */
/**
 * `@clack/core` 1.5 narrows `isCancel` to its unique cancel symbol while the
 * prompts still resolve to `Value | symbol`, so the guard alone no longer
 * removes `symbol` from a prompt result. This one does.
 */
/**
 * Where an agent-facing artifact (the skill, the MCP registration) goes: the
 * locations an earlier run chose, refreshed and never extended; for a project
 * without one, every known location under `--yes`, else the user's pick.
 * `--no-skill` / `--no-mcp` (`choice` false) skips it, refreshes included;
 * `--skill` / `--mcp` (true) answers the question with every location.
 */
async function chooseLocations(
  found: readonly string[],
  locations: readonly { readonly value: string; readonly hint: string }[],
  message: string,
  yes: boolean,
  choice: boolean | undefined,
): Promise<readonly string[] | symbol> {
  if (choice === false) return [];
  if (found.length > 0) return found;
  if (yes || choice === true) return locations.map((location) => location.value);
  return clack.multiselect<string>({
    message,
    options: locations.map(({ value, hint }) => ({ value, label: value, hint })),
    initialValues: locations.map((location) => location.value),
    required: false,
  });
}

function isCancelled<Value>(value: Value | symbol): value is symbol {
  return clack.isCancel(value);
}

function cancelled(): number {
  clack.cancel('Cancelled; no changes were made');
  return 0;
}
