/**
 * How an `app.command` spawns on Windows, where `spawn` without a shell runs
 * only `.exe` and `.com` files: `npm`, `pnpm`, `yarn`, `bun`, and every
 * `node_modules/.bin` entry are `.cmd` batch shims, which fail with ENOENT
 * (bare name) or EINVAL (named with `.cmd`, since Node's CVE-2024-27980 fix).
 *
 * A command that resolves to a batch file runs through `cmd.exe /d /s /c`
 * instead, with every argument escaped so cmd hands the batch file exactly
 * the strings the config listed: the command stays structured and never
 * shell-interpreted. The escaping follows cross-spawn's (MIT), the one npm's
 * own tooling relies on.
 */

import fs from 'node:fs';
import path from 'node:path';

/** What `spawn` receives. */
interface SpawnPlan {
  readonly file: string;
  readonly args: readonly string[];
  /** True when `args` is one pre-quoted command line for cmd.exe. */
  readonly windowsVerbatimArguments: boolean;
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';
const BATCH = /\.(?:cmd|bat)$/iu;
/** cmd's metacharacters, caret-escaped on the command line. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/gu;
/** A shim npm writes into `node_modules/.bin`, which re-parses its arguments once more. */
const CMD_SHIM = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/iu;

/**
 * The file a command name resolves to the way `cmd.exe` finds it: a name with
 * a directory part relative to `cwd`, a bare name on `PATH`, each tried as
 * given when it already has an extension in `PATHEXT`, then with each one.
 * Undefined when nothing matches, so `spawn` reports the miss itself.
 */
function resolveWindowsExecutable(executable: string, cwd: string, env: Readonly<Record<string, string | undefined>>): string | undefined {
  const extensions = (env.PATHEXT ?? DEFAULT_PATHEXT).split(';').filter((extension) => extension !== '');
  const hasExtension = extensions.some((extension) => executable.toLowerCase().endsWith(extension.toLowerCase()));
  const candidates = (base: string): string[] => [...(hasExtension ? [base] : []), ...extensions.map((extension) => `${base}${extension}`)];
  const directories = /[\\/]/u.test(executable)
    ? [path.win32.resolve(cwd, path.win32.dirname(executable))]
    : (env.PATH ?? '').split(';').filter((entry) => entry !== '');
  const name = /[\\/]/u.test(executable) ? path.win32.basename(executable) : executable;
  for (const directory of directories) {
    for (const candidate of candidates(path.win32.join(directory, name))) {
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // not here; try the next one
      }
    }
  }
  return undefined;
}

/** One argument quoted for a Windows command line, then caret-escaped for cmd; twice for a `node_modules/.bin` shim. */
function escapeArgument(value: string, doubleEscape: boolean): string {
  // Backslashes before a quote double and the quote escapes; trailing backslashes double before the closing quote.
  const quoted = `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\*)$/u, '$1$1')}"`;
  const escaped = quoted.replace(CMD_META, '^$1');
  return doubleEscape ? escaped.replace(CMD_META, '^$1') : escaped;
}

/**
 * The spawn for `executable` and `args` on Windows: unchanged unless the
 * command resolves to a `.cmd` or `.bat` file, which runs through
 * `COMSPEC` (cmd.exe) with one escaped command line.
 */
export function planWindowsSpawn(
  executable: string,
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): SpawnPlan {
  const resolved = resolveWindowsExecutable(executable, cwd, env);
  if (resolved === undefined || !BATCH.test(resolved)) return { file: executable, args, windowsVerbatimArguments: false };
  const doubleEscape = CMD_SHIM.test(resolved);
  const line = [resolved.replace(CMD_META, '^$1'), ...args.map((arg) => escapeArgument(arg, doubleEscape))].join(' ');
  return { file: env.COMSPEC ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
}
