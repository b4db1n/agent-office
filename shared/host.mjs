import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);

// Keep the CLI's authentication and host discovery. An explicit server is
// useful for isolated testing and users with their own OpenCode service.
let resolving;
export async function runOpenCode(command, args, options = {}) {
  // An unbound `opencode api` may start a service, even for a GET.
  let server = process.env.AGENT_OFFICE_SERVER || process.env.OPENCODE_HOST;
  let env = process.env;
  if (!server) {
    resolving ??= exec(command, ['service', 'status'], { encoding: 'utf8', timeout: 3000 })
      .then(({ stdout }) => stdout.trim()).finally(() => { resolving = undefined; });
    server = await resolving;
    // The CLI's managed-service password can differ from the desktop's
    // environment. Bind only the matching private, local service registration.
    const url = new URL(server);
    if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('Unrecognized local service address.');
    const record = join(process.env.XDG_STATE_HOME || join(homedir(),'.local','state'),'opencode','service.json');
    const file = await open(record, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const st = await file.stat();
      if (!st.isFile() || (st.mode & 0o077) || (process.getuid && st.uid !== process.getuid())) throw new Error('Invalid local service registration.');
      const entry = JSON.parse(await file.readFile('utf8'));
      if (entry.url !== server || typeof entry.password !== 'string') throw new Error('OpenCode service changed; retry discovery.');
      env = {...env, OPENCODE_PASSWORD:entry.password};
    } finally { await file.close(); }
  }
  if (!/^https?:\/\/[^\s]+$/.test(server)) throw new Error('No running OpenCode host. Open the project and retry.');
  const hostArgs = ['--server', server, ...args];
  return exec(command, hostArgs, {
    encoding: 'utf8',
    timeout: 8000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
    env,
  });
}

export function officeError(error) {
  // execFile errors can contain the complete command, including a user's prompt.
  if (error?.cmd || error?.stderr || error?.stdout) return 'OpenCode did not complete the request. Check the Office before retrying.';
  if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return 'The selected project folder is not available.';
  return typeof error?.message === 'string' ? error.message.slice(0, 240) : 'Office Steward could not complete the request.';
}
