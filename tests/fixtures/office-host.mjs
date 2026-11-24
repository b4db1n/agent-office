// Synthetic OpenCode executable and plugin runner used only by
// tests/packaged-dispatch.test.mjs. Default mode accepts the real
// `opencode --server ... api ...` argv shape and writes a private JSONL record
// of attempted calls. `--plugin` mode loads the actual packaged plugin in an
// isolated child with its own settings and ledger. No network or host access.
import { appendFileSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);

if (argv[0] === '--plugin') {
  const input = JSON.parse(process.env.OFFICE_PLUGIN_INPUT);
  // Fixture provisioning only. Importing the source settings helper here just
  // writes an isolated project config; no bundled setup command or installer
  // is being exercised. The bundle under test is plugin/index.js below.
  const { saveSettings } = await import('../../shared/settings.mjs');
  await saveSettings(input.directory, 'project', {
    lead:'lead', leadModel:'opencode-go/beam-free', specialistModel:null,
    parallelism:1, budget:null,
  });
  const {default:plugin} = await import('../../plugin/index.js');

  const commands = [], synthetic = [];
  let transforms = 0, duplicateBlocked = false;
  const makeCtx = (existing) => ({
    location:{directory:input.directory},
    command:{
      list:async () => ({data: existing ? [{name:'office'}] : [{name:'other'}]}),
      transform:async (register) => {
        transforms++;
        register({add:(command) => commands.push(command)});
      },
    },
    session:{synthetic:async (message) => synthetic.push(message)},
  });

  await plugin.setup(makeCtx(false));
  try {
    await plugin.setup({
      ...makeCtx(true),
      command:{
        list:async () => ({data:[{name:'office'}]}),
        transform:async () => { throw new Error('Duplicate registration.'); },
      },
    });
    duplicateBlocked = true;
  } catch { /* expected: the second setup must not register again */ }

  let result = null, error = null;
  try {
    result = await commands[0].execute({sessionID:input.sessionID,prompt:{text:input.text}});
  } catch (e) { error = String(e); }

  let calls = [];
  try {
    calls = readFileSync(process.env.OFFICE_HOST_RECORD,'utf8').trim().split('\n')
      .filter(Boolean).map(JSON.parse);
  } catch { /* no calls recorded */ }

  process.stdout.write(JSON.stringify({
    id:plugin.id, transforms, duplicateBlocked, registered:commands.map(c => c.name),
    result, error, synthetic, calls,
  }));
  process.exit(0);
}

const at = argv.indexOf('api');
const method = String(argv[at + 1] ?? '').toUpperCase();
const path = String(argv[at + 2] ?? '').split('?')[0];
const dataAt = argv.indexOf('--data');
const data = dataAt >= 0 ? JSON.parse(argv[dataAt + 1]) : null;
const directory = process.env.OFFICE_HOST_DIR;

if (process.env.OFFICE_HOST_RECORD) {
  appendFileSync(process.env.OFFICE_HOST_RECORD, JSON.stringify({method,path,data}) + '\n');
}

const located = (value) => JSON.stringify({location:{directory},data:value});
const model = {
  id:'beam-free', modelID:'beam-free', providerID:'opencode-go', enabled:true,
  cost:[{input:0,output:0}], variants:[],
};
const agent = {id:'lead', mode:'primary', model:{providerID:'opencode-go',id:'beam-free'}};

let out;
if (path === '/api/agent') out = located([agent]);
else if (path === '/api/model') out = located([model]);
else if (path === '/api/plugin') out = located([{id:'agent-office',state:{status:'active'}}]);
else if (path === '/api/model/default') out = located(null);
else if (path === '/api/session/active') out = located({});
else if (path === '/api/session' && method === 'POST') out = located({...data});
else if (path === '/api/session' && method === 'GET') out = located([]);
else if (/^\/api\/session\/[^/]+\/prompt$/.test(path)) {
  out = located({sessionID:path.split('/')[3]});
} else if (/^\/api\/session\/[^/]+$/.test(path)) {
  out = located({id:path.split('/')[3],projectID:'p',location:{directory},outcome:'succeeded'});
} else {
  process.stderr.write(`synthetic host: unexpected ${method} ${path}\n`);
  process.exit(2);
}
process.stdout.write(out);
