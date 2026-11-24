import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

test('built service health, authentication, invalid project, no send route', async () => {
  // Exercise the install artifact, not a TypeScript entry or mocked HTTP router.
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address();
  await new Promise(resolve => reservation.close(resolve));
  const token = randomUUID();
  const child = spawn(process.execPath, [new URL('../service/main.js', import.meta.url).pathname], {
    env: { ...process.env, OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: token },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const ended = once(child, 'exit');
  const endpoint = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${token}` };
  try {
    let health;
    for (let i = 0; i < 40 && child.exitCode === null; i++) {
      try { health = await fetch(`${endpoint}/health`, { headers: auth }); break; }
      catch { await delay(50); }
    }
    assert.equal(health?.status, 200);
    assert.equal((await fetch(`${endpoint}/health`)).status, 401);
    assert.equal((await fetch(`${endpoint}/settings`, {
      method: 'POST', headers: auth, body: JSON.stringify({ directory: '.', scope: 'global', values: {} }),
    })).status, 400);
    assert.equal((await fetch(`${endpoint}/send`, {
      method: 'POST', headers: auth, body: '{}',
    })).status, 404);
    console.log('PASS: built service health, authentication, invalid project, no send route');
  } finally {
    child.kill();
    await ended;
  }
});
