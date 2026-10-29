/** Windows app commands: a `.cmd` shim starts with its arguments intact, and stop takes its whole process tree down. */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ManagedProcess } from '../../src/run/managed-process.ts';
import { planWindowsSpawn } from '../../src/run/windows-command.ts';

/** cmd.exe, PATHEXT, and taskkill exist only on Windows; the Windows CI job runs these. */
const ONLY_WINDOWS = process.platform !== 'win32';

/** Arguments cmd would split, expand, or redirect if they reached it unescaped. */
const AWKWARD_ARGS = ['plain', 'two words', 'a&b', 'pipe|more', '100%', '%PATH%', 'say "hi"', 'trailing\\', '(paren)', '^caret', '!bang!', ''];

/** A server that records its argv and pid, then listens until killed. */
const SERVER = `
const fs = require('node:fs');
const http = require('node:http');
fs.writeFileSync(process.env.ARGV_FILE, JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(process.env.PID_FILE, String(process.pid));
http.createServer((_req, res) => res.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');
`;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-windows-command-'));
  fs.writeFileSync(path.join(dir, 'server.js'), SERVER);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A free loopback port. */
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Writes a batch shim at `relative` that runs server.js under this Node with every argument passed through. */
function writeShim(relative: string): void {
  const shim = path.join(dir, relative);
  fs.mkdirSync(path.dirname(shim), { recursive: true });
  fs.writeFileSync(shim, `@"%NODE_EXE%" "${path.join(dir, 'server.js')}" %*\r\n`);
}

describe.skipIf(ONLY_WINDOWS)('Windows app commands', () => {
  it('resolves a bare name on PATH through PATHEXT, in the order PATHEXT gives', () => {
    writeShim('bin/serve.cmd');
    fs.writeFileSync(path.join(dir, 'bin', 'serve.bat'), '');
    const env = { PATH: path.join(dir, 'bin'), PATHEXT: '.EXE;.CMD;.BAT' };
    const line = (executable: string): string => planWindowsSpawn(executable, [], dir, env).args.at(-1)!.toLowerCase();
    expect(line('serve')).toContain('serve.cmd');
    expect(line('serve.bat')).toContain('serve.bat');
    // Nothing on PATH: spawned as given, so spawn reports the miss.
    expect(planWindowsSpawn('missing', ['x'], dir, env)).toEqual({ file: 'missing', args: ['x'], windowsVerbatimArguments: false });
  });

  it("finds a shim on a relative or quoted PATH entry from the command cwd, not the runner's", () => {
    writeShim('apps/web/tools/serve.cmd');
    writeShim('quoted dir/serve2.cmd');
    const cwd = path.join(dir, 'apps', 'web');
    const env = { PATH: `tools;"${path.join(dir, 'quoted dir')}"` };
    expect(planWindowsSpawn('serve', [], cwd, env).args.at(-1)!.toLowerCase()).toContain(path.join(cwd, 'tools', 'serve.cmd').toLowerCase());
    expect(planWindowsSpawn('serve2', [], cwd, env).args.at(-1)!.toLowerCase()).toContain('serve2.cmd');
  });

  it('refuses a line break in an argument to a batch file instead of letting cmd cut it short', async () => {
    writeShim('bin/serve.cmd');
    const env = { PATH: path.join(dir, 'bin') };
    // PATHEXT spells the extension; Windows matches it whatever the file's case.
    expect(() => planWindowsSpawn('serve', ['ok', 'a\nb', 'lost'], dir, env)).toThrow(
      /^serve\.cmd is a batch file, which cmd\.exe cannot pass a line break to; the argument "a\\nb" holds one$/iu,
    );
    const app = new ManagedProcess('app.command', { executable: 'serve', args: ['line\r\nnext'], env }, dir, { readyUrl: 'http://127.0.0.1:9/' });
    await expect(app.start()).rejects.toMatchObject({ code: 'APP_UNREACHABLE', message: expect.stringMatching(/^app\.command failed to start: serve\.cmd is a batch file/iu) });
    expect(app.spawned).toBe(false);
  });

  it('spawns an .exe as it is and a batch file through cmd.exe', () => {
    writeShim('bin/serve.cmd');
    const env = { PATH: `${path.join(dir, 'bin')};${path.dirname(process.execPath)}`, COMSPEC: 'C:\\Windows\\System32\\cmd.exe' };
    expect(planWindowsSpawn('node', ['-v'], dir, env)).toEqual({ file: 'node', args: ['-v'], windowsVerbatimArguments: false });
    const plan = planWindowsSpawn('serve', ['a b'], dir, env);
    expect(plan.file).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(plan.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(plan.windowsVerbatimArguments).toBe(true);
  });

  it.each([
    ['a bare name on PATH', 'bin/serve.cmd', 'serve'],
    ['a node_modules/.bin shim by relative path', 'node_modules/.bin/serve.cmd', 'node_modules/.bin/serve'],
  ])('starts %s with every argument intact, then stops the server behind it', async (_case, shim, executable) => {
    writeShim(shim);
    const port = await freePort();
    const argvFile = path.join(dir, 'argv.json');
    const pidFile = path.join(dir, 'pid');
    const app = new ManagedProcess(
      'app.command',
      {
        executable,
        args: AWKWARD_ARGS,
        env: {
          PATH: `${path.join(dir, 'bin')};${process.env.PATH ?? ''}`,
          NODE_EXE: process.execPath,
          PORT: String(port),
          ARGV_FILE: argvFile,
          PID_FILE: pidFile,
        },
        startupTimeout: 20_000,
        shutdownTimeout: 2_000,
      },
      dir,
      { readyUrl: `http://127.0.0.1:${port}/` },
    );
    try {
      await app.start();
      expect(app.spawned).toBe(true);
      expect(JSON.parse(fs.readFileSync(argvFile, 'utf8'))).toEqual(AWKWARD_ARGS);
      const server = Number(fs.readFileSync(pidFile, 'utf8'));
      expect(running(server)).toBe(true);
      await app.stop();
      // node.exe is cmd.exe's child: killing only the leader left it serving the port.
      expect(running(server)).toBe(false);
    } finally {
      await app.stop();
    }
  });
});
