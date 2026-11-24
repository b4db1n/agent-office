import { test } from 'node:test';
import assert from 'node:assert/strict';

import usage, { STATUS } from '../shared/usage.mjs';

const DIR = '/projects/demo';
const root = { id: 'ses_root', projectID: 'prj_demo', location:{directory:DIR}, title: 'root' };
const child = {
  id: 'ses_child', projectID: 'prj_demo', location:{directory:DIR}, parentID: 'ses_root', title: 'child',
};

// OpenCode v2.3.2 /api/model entry: cost is an ARRAY of tier entries.
function model(id, input, output, extra = {}) {
  return {
    id, modelID: id, providerID: 'opencode-go', enabled: true,
    cost: [{ input, output, cache: { read: 0, write: 0 } }], ...extra,
  };
}

function stepFinish(id, cost, tokens = { input: 10, output: 10 }) {
  return { id, sessionID: 'ses_root', messageID: 'msg', type: 'step-finish', cost, tokens };
}

function assistantMessage(id, [step], extra = {}) {
  return {
    type:'assistant',agent:'build', id:step.id ?? id, content:[],
    model:{id:extra.modelID ?? 'priced', providerID:extra.providerID ?? 'opencode-go',variant:extra.variant},
    cost:step.cost,tokens:step.tokens,
  };
}

function fakeHost(rootSession, { children = {}, messages = {}, catalog = [], failures = {} } = {}) {
  const handlers = {
    [`GET /api/session/${rootSession.id}`]: rootSession,
    'GET /api/model': catalog,
  };
  for (const [parent, list] of Object.entries(children)) {
    handlers[`GET /api/session/${parent}/children`] = list;
  }
  for (const [session, list] of Object.entries(messages)) {
    handlers[`GET /api/session/${session}/message`] = list;
  }
  for (const [scope, error] of Object.entries(failures)) {
    handlers[scope] = () => { throw error; };
  }
  return async (method, path, params) => {
    if (path === '/api/session') return children[params.parentID] ?? [];
    const key = `${method} ${path}`;
    if (!Object.prototype.hasOwnProperty.call(handlers, key)) {
      throw new Error(`Unhandled host call: ${key}`);
    }
    const value = handlers[key];
    return typeof value === 'function' ? value() : value;
  };
}

test('reported subscription zero stays reported and is not a guessed $0', async () => {
  const api = fakeHost(root, {
    children: { ses_root: [] },
    messages: { ses_root: [assistantMessage('msg_1', [stepFinish('prt_1', 0)])] },
    catalog: [model('priced', 1, 2)],
  });
  const result = await usage(DIR, 'ses_root', { api });
  assert.equal(result.status, STATUS.OK);
  assert.deepEqual(result.counts, { reported: 1, estimated: 0, unknown: 0 });
  assert.equal(result.reported, 0);
  assert.equal(result.estimated, 0);
  assert.equal(result.events, 1);
  assert.deepEqual(result.errors, []);
});

test('missing price is unknown, not an estimated zero', async () => {
  const api = fakeHost(root, {
    children: { ses_root: [] },
    messages: {
      ses_root: [assistantMessage('msg_2', [{ id: 'prt_2', type: 'step-finish', tokens: { input: 10, output: 10 } }])],
    },
    catalog: [],
  });
  const result = await usage(DIR, 'ses_root', { api });
  assert.equal(result.estimated, 0);
  assert.equal(result.reported, 0);
  assert.equal(result.counts.unknown, 1);
  assert.equal(result.status, STATUS.PARTIAL);
});

test('v2 cost-array catalog and model ref estimate without an observed cost', async () => {
  const api = fakeHost(root, {
    children: { ses_root: [] },
    messages: {
      ses_root: [assistantMessage('msg_3', [
        { id: 'prt_3', type: 'step-finish', tokens: { input: 1000000, output: 1000000 } },
      ], { modelID: 'fast', providerID: 'opencode-go', variant: 'ultra' })],
    },
    catalog: [model('fast', 1, 2, { modelID: 'base', variant: 'ultra' })],
  });
  const result = await usage(DIR, 'ses_root', { api });
  assert.equal(result.estimated, 3);
  assert.equal(result.counts.estimated, 1);
  assert.equal(result.status, STATUS.OK);
});

test('shared parent/child replay is counted once with the child copy preferred', async () => {
  const api = fakeHost(root, {
    children: { ses_root: [child], ses_child: [] },
    messages: {
      ses_root: [assistantMessage('msg_parent', [stepFinish('prt_shared', 10)])],
      ses_child: [assistantMessage('msg_child', [stepFinish('prt_shared', 2)])],
    },
    catalog: [],
  });
  const result = await usage(DIR, 'ses_root', { api });
  assert.equal(result.events, 1);
  assert.equal(result.reported, 2);
  assert.deepEqual(result.sessions, ['ses_root', 'ses_child']);
  assert.equal(result.status, STATUS.OK);
});

test('positively foreign descendants are excluded without marking partial', async () => {
  const foreign = { ...child, id: 'ses_foreign', projectID: 'prj_other' };
  const outside = { ...child, id: 'ses_outside', location:{directory:'/projects/other'} };
  const api = fakeHost(root, {
    children: { ses_root: [child, foreign, outside], ses_child: [] },
    messages: {
      ses_root: [assistantMessage('msg_1', [stepFinish('prt_1', 1)])],
      ses_child: [assistantMessage('msg_2', [stepFinish('prt_2', 2)])],
    },
    catalog: [],
  });
  const result = await usage(DIR, 'ses_root', { api });
  assert.deepEqual(result.sessions, ['ses_root', 'ses_child']);
  assert.equal(result.reported, 3);
  assert.equal(result.status, STATUS.OK);
});

test('missing child identity is partial and the unidentified child is never fetched', async () => {
  const unscoped = { ...child, id: 'ses_unscoped', projectID: undefined };
  const base = fakeHost(root, {
    children: { ses_root: [child, unscoped], ses_child: [] },
    messages: {
      ses_root: [assistantMessage('msg_1', [stepFinish('prt_1', 1)])],
      ses_child: [assistantMessage('msg_2', [stepFinish('prt_2', 2)])],
    },
    catalog: [],
  });
  const paths = [];
  const api = async (method, path, params) => {
    paths.push(path);
    return base(method, path, params);
  };
  const result = await usage(DIR, 'ses_root', { api });
  assert.deepEqual(result.sessions, ['ses_root', 'ses_child']);
  assert.equal(result.reported, 3);
  assert.equal(result.status, STATUS.PARTIAL);
  assert.ok(!paths.some((path) => path.includes('ses_unscoped')));
});

test('root without a directory cannot establish checkout scope', async () => {
  const api = fakeHost(
    { id: 'ses_root', projectID: 'prj_demo', title: 'root' },
    {
      children: { ses_root: [] },
      messages: { ses_root: [assistantMessage('msg_1', [stepFinish('prt_1', 5)])] },
      catalog: [],
    },
  );
  const result = await usage(DIR, 'ses_root', { api });
  assert.equal(result.events, 0);
  assert.equal(result.status, STATUS.UNSUPPORTED);
});

test('root without a project id is unsupported, not $0', async () => {
  const api = fakeHost({ id: 'ses_root', directory: DIR, title: 'root' });
  const result = await usage(DIR, 'ses_root', { api });
  assert.equal(result.status, STATUS.UNSUPPORTED);
  assert.deepEqual(result.errors, [{ scope: 'root', code: 'ROOT_UNAVAILABLE' }]);
});

test('a failed child read yields partial with safe codes and the good data kept', async () => {
  const api = fakeHost(root, {
    children: { ses_root: [child], ses_child: [] },
    messages: { ses_root: [assistantMessage('msg_1', [stepFinish('prt_1', 4)])] },
    catalog: [],
    failures: {
      'GET /api/session/ses_child/message': new Error('secret fixture transcript'),
    },
  });
  const result = await usage(DIR, 'ses_root', { api });
  assert.equal(result.status, STATUS.PARTIAL);
  assert.equal(result.reported, 4);
  assert.deepEqual(result.errors, [
    { scope: 'messages:ses_child', code: 'MESSAGES_UNAVAILABLE' },
  ]);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('pagination or traversal caps force PARTIAL with truncated=true', async () => {
  const api = fakeHost(root, {
    children: { ses_root: [] },
    messages: {
      ses_root: [
        assistantMessage('m1', [stepFinish('p1', 1)]),
        assistantMessage('m2', [stepFinish('p2', 2)]),
      ],
    },
    catalog: [],
  });
  const result = await usage(DIR, 'ses_root', { api, messageLimit: 2 });
  assert.equal(result.truncated, true);
  assert.equal(result.status, STATUS.PARTIAL);
  assert.equal(result.reported, 3);
});

test('missing root handle is unsupported, never a measured zero', async () => {
  const api = fakeHost(root, {
    failures: { 'GET /api/session/ses_root': new Error('nope') },
  });
  const result = await usage(DIR, 'ses_root', { api });
  assert.equal(result.status, STATUS.UNSUPPORTED);
  assert.deepEqual(result.counts, { reported: 0, estimated: 0, unknown: 0 });
  assert.deepEqual(result.errors, [{ scope: 'root', code: 'ROOT_UNAVAILABLE' }]);
});

test('no usage events is reported as no-data rather than a measured cost', async () => {
  const api = fakeHost(root, {
    children: { ses_root: [] },
    messages: { ses_root: [] },
    catalog: [],
  });
  const result = await usage(DIR, 'ses_root', { api });
  assert.equal(result.status, STATUS.NO_DATA);
  assert.equal(result.events, 0);
});

test('default runner uses encoded query strings on literal CLI paths', async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push({ command, args });
    assert.equal(command, 'opencode');
    assert.equal(args[0], 'api');
    assert.equal(args[1], 'GET');
    // V2 literal paths carry the encoded query string in the path itself.
    const [barePath, query = ''] = args[2].split('?');
    const params = Object.fromEntries(new URLSearchParams(query));
    if (barePath === '/api/session') assert.equal(params.directory, DIR);
    const responses = {
      '/api/session/ses_root': root,
      '/api/session': [],
      '/api/model': [],
      '/api/session/ses_root/message': [
        assistantMessage('msg_runner', [stepFinish('prt_runner', 7)]),
      ],
    };
    return { stdout: JSON.stringify({ data: responses[barePath] ?? null }) };
  };
  const result = await usage(DIR, 'ses_root', { run });
  assert.equal(result.status, STATUS.OK);
  assert.equal(result.reported, 7);
  assert.ok(calls.some((call) => call.args[2].split('?')[0] === '/api/session/ses_root/message'));
});

test('invalid input is rejected without a host call', async () => {
  let called = false;
  const api = async () => { called = true; return null; };
  const result = await usage('', 'ses_root', { api });
  assert.equal(result.status, STATUS.INVALID);
  assert.equal(called, false);
});

test('paged children and messages follow cursor.next and dedupe stable ids', async () => {
  const api = async (method, path, params = {}) => {
    if (path === '/api/session/ses_root') return root;
    if (path === '/api/session') {
      if (params.parentID !== 'ses_root') return [];
      if (!params.cursor) return { data: [child], cursor: { next: 'c1' } };
      if (params.cursor === 'c1') return { data: [child], cursor: { next: 'done' } };
      return { data: [] };
    }
    if (path === '/api/session/ses_child/message' || path === '/api/session/ses_root/message') {
      if (!params.cursor) {
        return { data: [assistantMessage('m1', [stepFinish('p1', 1)])], cursor: { next: 'm2' } };
      }
      if (params.cursor === 'm2') {
        return { data: [assistantMessage('m2', [stepFinish('p2', 2)])], cursor: { next: null } };
      }
      return { data: [] };
    }
    if (path === '/api/model') return [];
    throw new Error(`Unhandled host call: ${method} ${path}`);
  };
  const result = await usage(DIR, 'ses_root', { api });
  assert.deepEqual(result.sessions, ['ses_root', 'ses_child']);
  assert.equal(result.events, 2); // replayed step ids counted once
  assert.equal(result.reported, 3); // child copy preferred, not doubled
  assert.equal(result.status, STATUS.OK);
});

test('a replayed cursor is stopped and reported partial, never complete', async () => {
  const api = async (method, path, params = {}) => {
    if (path === '/api/session/ses_root') return root;
    if (path === '/api/session') return [];
    if (path === '/api/session/ses_root/message') {
      if (!params.cursor) return { data: [assistantMessage('m1', [stepFinish('p1', 1)])], cursor: { next: 'loop' } };
      if (params.cursor === 'loop') return { data: [assistantMessage('m2', [stepFinish('p2', 2)])], cursor: { next: 'loop' } };
    }
    if (path === '/api/model') return [];
    throw new Error(`Unhandled host call: ${method} ${path}`);
  };
  const result = await usage(DIR, 'ses_root', { api });
  assert.equal(result.reported, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.status, STATUS.PARTIAL);
});

test('a page cap stops a long cursor chain with partial status', async () => {
  let n = 0;
  const api = async (method, path, params = {}) => {
    if (path === '/api/session/ses_root') return root;
    if (path === '/api/session') return [];
    if (path === '/api/session/ses_root/message') {
      n++;
      return { data: [assistantMessage(`m${n}`, [stepFinish(`p${n}`, 1)])], cursor: { next: `c${n}` } };
    }
    if (path === '/api/model') return [];
    throw new Error(`Unhandled host call: ${method} ${path}`);
  };
  const result = await usage(DIR, 'ses_root', { api, maxMessagePages: 2 });
  assert.equal(n, 2);
  assert.equal(result.reported, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.status, STATUS.PARTIAL);
});

test('a failed later page keeps the good data and reports a safe code', async () => {
  const api = async (method, path, params = {}) => {
    if (path === '/api/session/ses_root') return root;
    if (path === '/api/session') return [];
    if (path === '/api/session/ses_root/message') {
      if (!params.cursor) {
        return { data: [assistantMessage('m1', [stepFinish('p1', 4)])], cursor: { next: 'p2' } };
      }
      throw new Error('secret fixture transcript');
    }
    if (path === '/api/model') return [];
    throw new Error(`Unhandled host call: ${method} ${path}`);
  };
  const result = await usage(DIR, 'ses_root', { api });
  assert.equal(result.reported, 4);
  assert.equal(result.truncated, true);
  assert.equal(result.status, STATUS.PARTIAL);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('malformed pages and in-scope identity gaps never imply completeness', async () => {
  const api = async (method, path, params = {}) => {
    if (path === '/api/session/ses_root') return root;
    if (path === '/api/session') {
      return { data: [null, { parentID: 'ses_root', projectID: 'prj_demo', location: { directory: DIR } }] };
    }
    if (path === '/api/session/ses_root/message') {
      return { data: [null, { type: 'user' }, { type: 'assistant' }] };
    }
    if (path === '/api/model') return [];
    throw new Error(`Unhandled host call: ${method} ${path}`);
  };
  const result = await usage(DIR, 'ses_root', { api });
  assert.deepEqual(result.sessions, ['ses_root']);
  assert.equal(result.events, 0);
  assert.equal(result.reported, 0);
  assert.equal(result.truncated, true);
  assert.equal(result.status, STATUS.PARTIAL);
});

test('exhausted multi-page history is complete even with a full page count', async () => {
  const api = async (method, path, params = {}) => {
    if (path === '/api/session/ses_root') return root;
    if (path === '/api/session') return [];
    if (path === '/api/session/ses_root/message') {
      if (!params.cursor) {
        return { data: [assistantMessage('m1', [stepFinish('p1', 1)])], cursor: { next: 'page2' } };
      }
      if (params.cursor === 'page2') {
        return { data: [assistantMessage('m2', [stepFinish('p2', 2)])], cursor: { next: null } };
      }
    }
    if (path === '/api/model') return [];
    throw new Error(`Unhandled host call: ${method} ${path}`);
  };
  // messageLimit=1 makes the combined row count >= limit, but the cursor
  // chain was exhausted, so this is complete coverage, not a partial page.
  const result = await usage(DIR, 'ses_root', { api, messageLimit: 1 });
  assert.equal(result.reported, 3);
  assert.equal(result.events, 2);
  assert.equal(result.truncated, false);
  assert.equal(result.status, STATUS.OK);
});

test('a malformed cursor never implies the end of the history', async () => {
  const api = async (method, path, params = {}) => {
    if (path === '/api/session/ses_root') return root;
    if (path === '/api/session') return [];
    if (path === '/api/session/ses_root/message') {
      return { data: [assistantMessage('m1', [stepFinish('p1', 5)])], cursor: { next: 42 } };
    }
    if (path === '/api/model') return [];
    throw new Error(`Unhandled host call: ${method} ${path}`);
  };
  const result = await usage(DIR, 'ses_root', { api });
  assert.equal(result.reported, 5);
  assert.equal(result.truncated, true);
  assert.equal(result.status, STATUS.PARTIAL);
});

test('an assistant row without a stable id is partial, not no-data or ok', async () => {
  const api = async (method, path, params = {}) => {
    if (path === '/api/session/ses_root') return root;
    if (path === '/api/session') return [];
    if (path === '/api/session/ses_root/message') {
      return { data: [{ type: 'assistant', agent: 'build', cost: 9, tokens: { input: 1, output: 1 } }] };
    }
    if (path === '/api/model') return [];
    throw new Error(`Unhandled host call: ${method} ${path}`);
  };
  const result = await usage(DIR, 'ses_root', { api });
  assert.equal(result.events, 0);
  assert.equal(result.reported, 0);
  assert.equal(result.truncated, true);
  assert.equal(result.status, STATUS.PARTIAL);
});

const bareChild = (i) => ({
  id: `ses_b${i}`, projectID: 'prj_demo', location: { directory: DIR }, parentID: 'ses_root',
});

test('exactly 100 bare children are a partial scope, valid rows preserved', async () => {
  const many = Array.from({ length: 100 }, (_, i) => bareChild(i));
  const api = async (method, path, params = {}) => {
    if (path === '/api/session/ses_root') return root;
    if (path === '/api/session') return params.parentID === 'ses_root' ? many : [];
    if (path.endsWith('/message')) {
      if (path === '/api/session/ses_root/message') return [];
      return [assistantMessage(`m_${path}`, [stepFinish(`p_${path}`, 1)])];
    }
    if (path === '/api/model') return [];
    throw new Error(`Unhandled host call: ${method} ${path}`);
  };
  const result = await usage(DIR, 'ses_root', { api });
  assert.equal(result.sessions.length, 101); // all 100 valid rows kept
  assert.equal(result.reported, 100);
  assert.equal(result.truncated, true);
  assert.equal(result.status, STATUS.PARTIAL);
});

test('a cursor page followed by a full bare fallback is partial', async () => {
  const api = async (method, path, params = {}) => {
    if (path === '/api/session/ses_root') return root;
    if (path === '/api/session') {
      if (params.parentID !== 'ses_root') return [];
      if (!params.cursor) return { data: [child], cursor: { next: 'more' } };
      return Array.from({ length: 100 }, (_, i) => bareChild(i));
    }
    if (path.endsWith('/message')) {
      return [assistantMessage(`m_${path}`, [stepFinish(`p_${path}`, 1)])];
    }
    if (path === '/api/model') return [];
    throw new Error(`Unhandled host call: ${method} ${path}`);
  };
  const result = await usage(DIR, 'ses_root', { api });
  assert.equal(result.sessions.length, 102);
  assert.equal(result.truncated, true);
  assert.equal(result.status, STATUS.PARTIAL);
});

test('exhausted cursor child pages stay complete despite a full row count', async () => {
  const api = async (method, path, params = {}) => {
    if (path === '/api/session/ses_root') return root;
    if (path === '/api/session') {
      if (params.parentID !== 'ses_root') return [];
      if (!params.cursor) return { data: [child], cursor: { next: 'rest' } };
      if (params.cursor === 'rest') {
        return {
          data: Array.from({ length: 99 }, (_, i) => bareChild(i)),
          cursor: { next: null },
        };
      }
      return [];
    }
    if (path.endsWith('/message')) {
      if (path === '/api/session/ses_root/message') return [];
      return [assistantMessage(`m_${path}`, [stepFinish(`p_${path}`, 1)])];
    }
    if (path === '/api/model') return [];
    throw new Error(`Unhandled host call: ${method} ${path}`);
  };
  const result = await usage(DIR, 'ses_root', { api });
  assert.equal(result.sessions.length, 101);
  assert.equal(result.reported, 100);
  assert.equal(result.truncated, false);
  assert.equal(result.status, STATUS.OK);
});

test('full pages need explicit next:null; missing/null/empty cursor stays partial', async () => {
  const full = Array.from({ length: 100 }, (_, i) => bareChild(i));
  const cases = [
    { label: 'missing cursor', envelope: { data: full }, status: STATUS.PARTIAL, sessions: 101 },
    { label: 'null cursor', envelope: { data: full, cursor: null }, status: STATUS.PARTIAL, sessions: 101 },
    { label: 'empty cursor', envelope: { data: full, cursor: {} }, status: STATUS.PARTIAL, sessions: 101 },
    { label: 'explicit end', envelope: { data: full, cursor: { next: null } }, status: STATUS.OK, sessions: 101 },
    { label: 'short page', envelope: { data: [child] }, status: STATUS.OK, sessions: 2 },
    { label: 'empty terminal', envelope: { data: [] }, status: STATUS.OK, sessions: 1 },
  ];
  for (const { label, envelope, status, sessions } of cases) {
    const api = async (method, path, params = {}) => {
      if (path === '/api/session/ses_root') return root;
      if (path === '/api/session') return params.parentID === 'ses_root' ? envelope : [];
      if (path.endsWith('/message')) {
        return [assistantMessage(`m_${path}`, [stepFinish(`p_${path}`, 1)])];
      }
      if (path === '/api/model') return [];
      throw new Error(`Unhandled host call: ${method} ${path}`);
    };
    const result = await usage(DIR, 'ses_root', { api });
    assert.equal(result.sessions.length, sessions, label);
    assert.equal(result.status, status, label);
    assert.equal(result.truncated, status === STATUS.PARTIAL, label);
  }
});
