/**
 * Agent Office — the advisor loop.
 *
 * The advisor is an OpenCode agent the user picked. The Office does three
 * things and nothing more: it shows the advisor the department's finished,
 * host-confirmed work; it dispatches one review; and it stores the lessons the
 * advisor wrote as `LESSON:` lines. A lesson is advice with a source, not a
 * verified fact, and nothing rewrites an agent definition on its own.
 */

import { dispatch, admissionView } from './dispatch.mjs';
import { inspect } from './settings.mjs';
import { hostApi } from './family.mjs';
import { departmentsFor, departmentFor, primaryAgents, reviewPrompt, parseLessons } from './departments.mjs';
import {
  readDepartmentJournal,
  recordReview,
  findReview,
  addLessons,
  updateReview,
} from './lessons.mjs';

const TERMINAL = new Set(['succeeded', 'completed', 'failed', 'interrupted', 'cancelled']);

function labelFor(session) {
  if (session?.outcome === 'failed') return 'host reported failure';
  if (session?.outcome === 'interrupted') return 'host reported interruption';
  if (session?.outcome) return `host reported ${session.outcome}`;
  return 'no host outcome';
}

function messageRows(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

/**
 * The finished Office roots this project recorded. Completion is a host
 * outcome, not a verified result; the label says so.
 */
export async function finishedWork(directory, options = {}) {
  const api = hostApi(options.run);
  const reservations = await admissionView(directory);
  const finished = [];
  const seen = new Set();
  for (const row of reservations.slice(-10)) {
    if (!row?.rootId || row.phase !== 'finished' || seen.has(row.rootId)) continue;
    seen.add(row.rootId);
    try {
      const session = await api('GET', `/api/session/${encodeURIComponent(row.rootId)}`, {
        'location[directory]': directory,
      });
      if (session?.id !== row.rootId) continue;
      finished.push({ id: row.rootId, title: session.title || row.rootId, label: labelFor(session) });
    } catch {
      // One unreadable root is not evidence of finished work; skip it.
    }
  }
  return finished;
}

export async function startReview(directory, departmentId, options = {}) {
  const info = await (options.inspectFn ?? inspect)(directory, { run: options.run });
  const departments = departmentsFor(info.settings, info.agents);
  const department = departments.find((item) => item.id === departmentId) ?? null;
  if (!department) throw new Error('Configure that department before asking the advisor.');
  const advisor = typeof info.settings?.advisor === 'string' ? info.settings.advisor.trim() : '';
  if (!advisor) throw new Error('Choose an advisor in Settings before asking for a review.');
  if (!primaryAgents(info.agents).some((agent) => agent.id === advisor)) {
    throw new Error(`Advisor "${advisor}" is unavailable. Choose another in Settings.`);
  }
  const finished = await finishedWork(directory, options);
  if (!finished.length) throw new Error('No finished Office work to review yet. Finish a task first.');
  const journal = await readDepartmentJournal(directory, department.id);
  const accepted = await dispatch(directory, reviewPrompt(department, journal.lessons, finished), {
    run: options.run,
    agent: advisor,
    department,
    context: false,
  });
  await recordReview(directory, department.id, accepted.sessionId);
  return { sessionId: accepted.sessionId, department: department.id, advisor, reviewed: finished.length };
}

/**
 * Read the advisor's last assistant text and store its `LESSON:` lines. Only a
 * finished session is eligible; a running review is reported, not guessed.
 */
export async function collectReview(directory, sessionId, options = {}) {
  const found = await findReview(directory, sessionId);
  if (!found) throw new Error('That session is not an advisor review for this project.');
  if (found.review.status === 'collected') throw new Error('Those lessons are already collected.');
  const api = hostApi(options.run);
  const session = await api('GET', `/api/session/${encodeURIComponent(sessionId)}`, {
    'location[directory]': directory,
  });
  if (session?.id !== sessionId) throw new Error('That advisor session is unavailable.');
  if (!TERMINAL.has(session.outcome)) throw new Error('The advisor is still working. Collect when it finishes.');
  const rows = messageRows(await api(
    'GET',
    `/api/session/${encodeURIComponent(sessionId)}/message`,
    { type: 'assistant', limit: 20, order: 'desc', 'location[directory]': directory },
  ));
  const text = rows
    .flatMap((row) => (Array.isArray(row?.content) ? row.content : []))
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
  const lessons = parseLessons(text);
  if (!lessons.length) {
    const reason = 'The advisor wrote no LESSON lines.';
    await updateReview(directory, sessionId, { status: 'empty', reason });
    return { added: [], skipped: 0, reason };
  }
  const result = await addLessons(directory, found.department, lessons, sessionId);
  await updateReview(directory, sessionId, {
    status: 'collected',
    collectedAt: Date.now(),
    added: result.added.length,
  });
  return { added: result.added, skipped: result.skipped };
}

export default { finishedWork, startReview, collectReview };
