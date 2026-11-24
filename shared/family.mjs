import { runOpenCode } from './host.mjs';

export function hostApi(run = runOpenCode) {
  return async (method, path, params = {}, body) => {
    // The 2.3.2 CLI ignores --param with literal HTTP paths. A dropped
    // parentID silently returns the newest sessions across all projects.
    // Encode the parameters into the path so the server actually sees them.
    const query = new URLSearchParams(params).toString();
    const args = ['api', method, path + (query ? `?${query}` : '')];
    if (body !== undefined) args.push('--data', JSON.stringify(body));
    const { stdout } = await run('opencode', args);
    const response = JSON.parse(stdout);
    if (!Object.hasOwn(response, 'data')) throw new Error('Incomplete host response.');
    if (params['location[directory]'] && response.location?.directory !== params['location[directory]']) {
      throw new Error('Host did not confirm the requested directory.');
    }
    // A paged envelope may be top level ({data:[...], cursor:{next}}) or
    // nested inside `data`. Keep either shape intact so callers can page.
    if (Array.isArray(response.data) && response.cursor) return response;
    return response.data;
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// A page is a bare array (legacy/mocks) or { data: [...], cursor: { next } }.
// `paged` tells a complete cursor walk from an ambiguous full bare array.
// A malformed cursor is reported, never treated as "the end" of the history.
export function pageRows(response) {
  if (Array.isArray(response)) {
    return { rows: response, next: null, explicitEnd: false, malformedCursor: false };
  }
  if (isObject(response) && Array.isArray(response.data)) {
    const cursor = response.cursor;
    const hasNext = isObject(cursor) && Object.hasOwn(cursor, 'next');
    // Only a documented { next: null } certifies the end of a full page.
    if (hasNext && cursor.next === null) {
      return { rows: response.data, next: null, explicitEnd: true, malformedCursor: false };
    }
    // Absent evidence (no cursor, null cursor, or {} with no next) never
    // certifies completeness on its own.
    if (cursor === undefined || cursor === null || !isObject(cursor) || !hasNext) {
      return {
        rows: response.data, next: null, explicitEnd: false,
        malformedCursor: cursor !== undefined && cursor !== null && !isObject(cursor),
      };
    }
    const next = cursor.next;
    if (typeof next === 'string' && next) {
      return { rows: response.data, next, explicitEnd: false, malformedCursor: false };
    }
    // A present but invalid next value is malformed, never a clean end.
    return { rows: response.data, next: null, explicitEnd: false, malformedCursor: true };
  }
  return null;
}

/**
 * Read a bounded number of pages. Follows cursor.next, stops when a cursor
 * replays or is malformed (both reported as partial, never as "complete") and
 * caps the walk so a long chain cannot hang the reader. Returns the combined
 * rows plus coverage flags so callers can tell ambiguous full bare arrays
 * from exhausted cursor pages.
 */
export async function collectPages(api, path, params, options = {}) {
  const maxPages = Number.isFinite(options.maxPages) && options.maxPages > 0
    ? options.maxPages : 20;
  const rows = [];
  const cursors = new Set();
  let next = null, pages = 0, read = 0;
  let partial = false, capped = false, tailExplicitEnd = false, tailRows = 0;

  while (pages < maxPages) {
    const callParams = { ...params };
    if (next) callParams.cursor = next;
    let response;
    try { response = await api('GET', path, callParams); }
    catch { partial = true; break; }
    const page = pageRows(response);
    if (!page) { partial = true; break; }
    read++;
    tailExplicitEnd = page.explicitEnd;
    tailRows = page.rows.length;
    rows.push(...page.rows);
    pages++;
    if (page.malformedCursor) { partial = true; break; }
    if (!page.next) { next = null; break; }
    if (cursors.has(page.next)) { partial = true; next = null; break; }
    cursors.add(page.next);
    next = page.next;
  }
  if (next) { partial = true; capped = true; }
  // A full page is proven complete only by an explicit { next: null } end
  // marker; a short page is complete by exhausting its own rows. Absent or
  // malformed cursor evidence on a full page stays ambiguous, and coverage is
  // decided by the tail page, never by an earlier page.
  const pageSize = Number(params.limit) || 100;
  const ambiguousTail = tailRows >= pageSize && !tailExplicitEnd;
  return { rows, pages, read, partial, capped, ambiguousTail, tailExplicitEnd, tailRows };
}

// Positive evidence the row belongs to another project or checkout. Absent,
// null or malformed values are NOT foreign evidence: they are identity gaps.
function isForeign(child, root, directory) {
  const project = child.projectID;
  if (typeof project === 'string' && project && project !== root.projectID) return true;
  const dir = child.location?.directory;
  if (typeof dir === 'string' && dir && dir !== directory) return true;
  return false;
}

export async function family(api, directory, rootId, limit = 200) {
  const root = await api('GET', `/api/session/${encodeURIComponent(rootId)}`);
  if (!isObject(root) || root.id !== rootId || root.location?.directory !== directory || !root.projectID) {
    throw new Error('Session is unavailable or outside this project.');
  }
  const sessions = [root], seen = new Set([root.id]);
  let partial = false;
  for (const parent of sessions) {
    const page = await collectPages(api, '/api/session', {parentID: parent.id, directory, limit: 100});
    partial ||= page.partial || page.ambiguousTail;
    for (const child of page.rows) {
      // Null or malformed rows are lost reads: partial, never fetched.
      if (!isObject(child)) { partial = true; continue; }
      // A concrete different project/directory is positively foreign: exclude
      // silently, never read it, and do not treat it as a lost in-scope read.
      if (isForeign(child, root, directory)) continue;
      // With no positive foreign evidence, a missing/inconsistent parent,
      // project, directory or id is a lost read: partial, never fetched.
      if (child.parentID !== parent.id || child.projectID !== root.projectID ||
          child.location?.directory !== directory || !child.id) { partial = true; continue; }
      if (seen.has(child.id)) continue; // stable-id dedup across overlapping pages
      if (sessions.length >= limit) { partial = true; break; }
      seen.add(child.id);
      sessions.push(child);
    }
  }
  return { sessions, partial };
}
