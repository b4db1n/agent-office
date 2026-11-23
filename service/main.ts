import http from 'node:http';
import { isAbsolute } from 'node:path';
import { inspect, saveSettings } from '../shared/settings.mjs';
import { dispatch } from '../shared/dispatch.mjs';

const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN;
if (!token || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Missing service configuration.');

// The installed extension's loopback-only, authenticated service boundary.
// No route sends a follow-up into an existing chat or answers a user form.
http.createServer(async (req, res) => {
  const reply = (status: number, body: unknown) =>
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
  if (req.headers.authorization !== `Bearer ${token}`) return void reply(401, {});
  if (req.method === 'GET' && req.url === '/health') return void reply(200, { ok: true });
  if (req.method !== 'POST' || !['/inspect', '/settings', '/dispatch'].includes(req.url ?? '')) return void reply(404, {});
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const part of req) {
      if ((size += part.length) > 131072) return void reply(413, { message: 'Request too large.' });
      chunks.push(part);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof data?.directory !== 'string' || !isAbsolute(data.directory)) throw new Error('Select a project directory.');
    if (req.url === '/inspect') return void reply(200, await inspect(data.directory));
    if (req.url === '/settings') {
      if (!['project', 'global'].includes(data.scope)) throw new Error('Unknown settings scope.');
      await saveSettings(data.directory, data.scope, data.values);
      return void reply(200, await inspect(data.directory));
    }
    if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 32000) throw new Error('Choose a message of 1–32,000 characters.');
    return void reply(200, await dispatch(data.directory, data.prompt));
  } catch (error) {
    return void reply(400, { message: error instanceof Error ? error.message.slice(0, 300) : 'Request failed.' });
  }
}).listen(port, '127.0.0.1');
