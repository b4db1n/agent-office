// Inspect the bytes Git would publish, including newly generated bundles.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
const git = (...args) => execFileSync('git', args, { maxBuffer: 64 << 20 });
const names = git('ls-files', '-z').toString().split('\0').filter(Boolean);
if (!names.length) throw new Error('Nothing staged for release.');
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
  const text = git('show', `:${name}`).toString();
  if (forbidden.some(re => re.test(name)) || text.includes(homedir() + '/') || data.some(re => re.test(text))) {
    throw new Error(`Review private or unapproved data in ${name}`);
  }
}
console.log(`Inspected ${names.length} indexed files; review the file list and diff before pushing.`);
