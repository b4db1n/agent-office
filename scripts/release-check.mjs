// Inspect the bytes Git would publish, including newly generated bundles.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { readFileSync, lstatSync, existsSync } from 'node:fs';
const git = (...args) => execFileSync('git', args, { maxBuffer: 64 << 20 });
const names = [...new Set(git('ls-files', '--cached','--others','--exclude-standard','-z').toString().split('\0').filter(n=>n && existsSync(n)))];
if (!names.length) throw new Error('Empty release candidate.');
const forbidden = [
  /(?:^|\/)(?:\.private|\.openchamber|node_modules|\.env(?:\..*)?)(?:\/|$)/,
  /\.(?:jpg|png|log|jsonl|sqlite|pem|key|map)$/i,
];
const data = [
  /(?:\/Users\/|\/home\/)[\w.-]+\//,
  /(?:^|\W)ses_[a-zA-Z0-9]{16,}/,
  /-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/,
  /(?:github_pat_|gh[pso]_)[A-Za-z0-9_]{20,}/,
];
for (const name of names) {
  if (!lstatSync(name).isFile()) throw new Error(`Review non-regular candidate: ${name}`);
  const text = readFileSync(name,'utf8');
  if (forbidden.some(re => re.test(name)) || text.includes(homedir() + '/') || data.some(re => re.test(text))) {
    throw new Error(`Review private or unapproved data in ${name}`);
  }
}
console.log(`Inspected ${names.length} candidate files (working bytes, including untracked files and bundles).`);
