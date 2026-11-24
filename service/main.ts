import http from 'node:http';
import { isAbsolute } from 'node:path';
import { realpath } from 'node:fs/promises';
import { inspect, saveSettings } from '../shared/settings.mjs';
import { dispatch, admissionView } from '../shared/dispatch.mjs';
import { usage } from '../shared/usage.mjs';
import { readProjectJournal } from '../shared/lessons.mjs';
import { startReview, collectReview } from '../shared/advisor.mjs';
import { officeError, runOpenCode } from '../shared/host.mjs';

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
  if (req.method !== 'POST' || !['/inspect', '/records', '/settings', '/dispatch', '/usage', '/journal', '/advisor/start', '/advisor/collect'].includes(req.url ?? '')) return void reply(404, {});
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const part of req) {
      if ((size += part.length) > 131072) return void reply(413, { message: 'Request too large.' });
      chunks.push(part);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof data?.directory !== 'string' || !isAbsolute(data.directory)) throw new Error('Select a project directory.');
    if (req.url === '/inspect') return void reply(200, {...await inspect(data.directory),reservations:await admissionView(data.directory)});
    if (req.url === '/records') return void reply(200, {reservations:await admissionView(data.directory)});
    if (req.url === '/settings') {
      if (!['project', 'global'].includes(data.scope)) throw new Error('Unknown settings scope.');
      await saveSettings(data.directory, data.scope, data.values, data.unset);
      return void reply(200, { ok: true });
    }
    if (req.url === '/usage') {
      if (typeof data.rootId !== 'string' || !data.rootId || data.rootId.length > 200) throw new Error('Select a session to see its usage.');
      const result = await usage(await realpath(data.directory), data.rootId, { run: runOpenCode });
      // Usage and routing evidence only; never transcript content.
      return void reply(200, {
        counts: result.counts,
        reported: result.reported,
        estimated: result.estimated,
        observed: result.observed,
        status: result.status,
      });
    }
    if (req.url === '/journal') {
      return void reply(200, { departments: await readProjectJournal(await realpath(data.directory)) });
    }
    if (req.url === '/advisor/start') {
      if (typeof data.departmentId !== 'string' || !data.departmentId) throw new Error('Select a department.');
      return void reply(200, await startReview(await realpath(data.directory), data.departmentId, { run: runOpenCode }));
    }
    if (req.url === '/advisor/collect') {
      if (typeof data.sessionId !== 'string' || !data.sessionId) throw new Error('Select an advisor session.');
      return void reply(200, await collectReview(await realpath(data.directory), data.sessionId, { run: runOpenCode }));
    }
    if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 32000) throw new Error('Choose a message of 1–32,000 characters.');
    const origin = typeof data.origin?.sessionId === 'string' && data.origin.sessionId.length < 200
      ? {
          sessionId: data.origin.sessionId,
          ...(typeof data.origin.messageId === 'string' && data.origin.messageId.length < 200 ? { messageId: data.origin.messageId } : {}),
        }
      : undefined;
    return void reply(200, await dispatch(data.directory, data.prompt, {
      run: runOpenCode,
      origin,
      departmentId: typeof data.departmentId === 'string' && data.departmentId ? data.departmentId : undefined,
    }));
  } catch (error) {
    return void reply(400, { message: officeError(error) });
  }
}).listen(port, '127.0.0.1');
