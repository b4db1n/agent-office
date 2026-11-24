import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  addLessons,
  readDepartmentJournal,
  recordReview,
  findReview,
} from '../shared/lessons.mjs';
import { finishedWork, collectReview, startReview } from '../shared/advisor.mjs';

function fakeRun(session, rows, directory) {
  return async (_command, args) => {
    const target = args[2];
    if (target.includes('/message')) return { stdout: JSON.stringify({ data: rows, location: { directory } }) };
    if (target.startsWith('/api/session/')) return { stdout: JSON.stringify({ data: session, location: { directory } }) };
    throw new Error(`Unexpected host call: ${target}`);
  };
}

function freshProject() {
  const project = mkdtempSync(path.join(tmpdir(), 'office-project-'));
  const state = mkdtempSync(path.join(tmpdir(), 'office-state-'));
  process.env.AGENT_OFFICE_LESSONS_FILE = path.join(state, 'lessons.json');
  return project;
}

beforeEach(() => {
  delete process.env.AGENT_OFFICE_LESSONS_FILE;
  delete process.env.XDG_STATE_HOME;
});

test('finished work is read from the ledger and labelled as host-reported', async () => {
  const project = freshProject();
  const stateHome = mkdtempSync(path.join(tmpdir(), 'office-xdg-'));
  process.env.XDG_STATE_HOME = stateHome;
  const key = createHash('sha256').update(realpathSync(project)).digest('hex').slice(0, 24);
  const dir = path.join(stateHome, 'agent-office', 'ledgers');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${key}.json`), JSON.stringify({
    roots: [],
    recent: [
      { sessionId: 'ses_done', phase: 'finished' },
      { sessionId: 'ses_failed', phase: 'finished' },
      { sessionId: 'ses_open', phase: 'submitted' },
    ],
  }));
  const run = async (_command, args) => {
    const target = args[2];
    if (target.includes('ses_done')) return { stdout: JSON.stringify({ data: { id: 'ses_done', title: 'Fix the build', outcome: 'succeeded' }, location: { directory: project } }) };
    if (target.includes('ses_failed')) return { stdout: JSON.stringify({ data: { id: 'ses_failed', title: 'Ship it', outcome: 'failed' }, location: { directory: project } }) };
    throw new Error('unexpected');
  };
  const work = await finishedWork(project, { run });
  assert.deepEqual(work, [
    { id: 'ses_done', title: 'Fix the build', label: 'host reported succeeded' },
    { id: 'ses_failed', title: 'Ship it', label: 'host reported failure' },
  ]);
});

test('collectReview stores only the advisor LESSON lines', async () => {
  const project = freshProject();
  await recordReview(project, 'engineering', 'ses_review');
  await addLessons(project, 'engineering', ['An older lesson the team already had.'], null);
  const rows = [
    { content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'Good work overall.' }] },
    { content: [{ type: 'text', text: 'LESSON: Run the browser suite before shipping a panel change.\nVERDICT: keep it small.' }] },
  ];
  const result = await collectReview(project, 'ses_review', {
    run: fakeRun({ id: 'ses_review', outcome: 'succeeded' }, rows, project),
  });
  assert.deepEqual(result.added, ['Run the browser suite before shipping a panel change.']);
  const journal = await readDepartmentJournal(project, 'engineering');
  assert.equal(journal.lessons.length, 2);
  assert.equal(journal.lessons[1].source, 'ses_review');
  assert.equal((await findReview(project, 'ses_review')).review.status, 'collected');
});

test('a running advisor is not collected early', async () => {
  const project = freshProject();
  await recordReview(project, 'engineering', 'ses_review');
  await assert.rejects(() => collectReview(project, 'ses_review', {
    run: fakeRun({ id: 'ses_review', outcome: 'running' }, [], project),
  }), /still working/i);
  assert.equal((await findReview(project, 'ses_review')).review.status, 'pending');
});

test('an advisor with no LESSON lines is recorded as empty, not invented', async () => {
  const project = freshProject();
  await recordReview(project, 'engineering', 'ses_review');
  const result = await collectReview(project, 'ses_review', {
    run: fakeRun({ id: 'ses_review', outcome: 'succeeded' }, [
      { content: [{ type: 'text', text: 'Everything was fine. No rules today.' }] },
    ], project),
  });
  assert.deepEqual(result.added, []);
  assert.match(result.reason, /no LESSON lines/i);
  const review = (await findReview(project, 'ses_review')).review;
  assert.equal(review.status, 'empty');
  assert.equal((await readDepartmentJournal(project, 'engineering')).lessons.length, 0);
});

test('an unknown session is refused', async () => {
  const project = freshProject();
  await assert.rejects(() => collectReview(project, 'ses_other', { run: fakeRun({}, []) }), /not an advisor review/i);
});

test('startReview refuses without an advisor and without finished work', async () => {
  const project = freshProject();
  const agents = [{ id: 'lead', mode: 'primary' }];
  const base = {
    agents,
    settings: { departments: [{ id: 'eng', name: 'Engineering', lead: 'lead', members: [] }] },
  };
  await assert.rejects(() => startReview(project, 'eng', {
    inspectFn: async () => base,
    run: fakeRun({}, [], project),
  }), /Choose an advisor/i);
  await assert.rejects(() => startReview(project, 'eng', {
    inspectFn: async () => ({ ...base, settings: { ...base.settings, advisor: 'ghost' } }),
    run: fakeRun({}, [], project),
  }), /unavailable/i);
  await assert.rejects(() => startReview(project, 'eng', {
    inspectFn: async () => ({ ...base, settings: { ...base.settings, advisor: 'lead' } }),
    run: fakeRun({}, [], project),
  }), /No finished Office work/i);
});
