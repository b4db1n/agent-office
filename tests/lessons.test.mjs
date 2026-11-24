import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  addLessons,
  readDepartmentJournal,
  readProjectJournal,
  recordReview,
  findReview,
  updateReview,
  journalFile,
} from '../shared/lessons.mjs';

function freshProject() {
  const project = mkdtempSync(path.join(tmpdir(), 'office-project-'));
  const state = mkdtempSync(path.join(tmpdir(), 'office-state-'));
  process.env.AGENT_OFFICE_LESSONS_FILE = path.join(state, 'lessons.json');
  return project;
}

beforeEach(() => {
  delete process.env.AGENT_OFFICE_LESSONS_FILE;
});

test('a missing journal reads as empty', async () => {
  const project = freshProject();
  assert.deepEqual(await readDepartmentJournal(project, 'engineering'), { lessons: [], reviews: [] });
  assert.deepEqual(await readProjectJournal(project), {});
});

test('lessons are stored once and keep their source', async () => {
  const project = freshProject();
  const first = await addLessons(project, 'engineering', [
    'Run the full suite before claiming the fix works.',
    'run the full suite before claiming the fix works.',
    'Name the exact command in the report.',
  ], 'ses_advisor');
  assert.deepEqual(first, { added: [
    'Run the full suite before claiming the fix works.',
    'Name the exact command in the report.',
  ], skipped: 1 });

  const journal = await readDepartmentJournal(project, 'engineering');
  assert.equal(journal.lessons.length, 2);
  assert.equal(journal.lessons[0].source, 'ses_advisor');
  assert.equal(journal.lessons[0].text, 'Run the full suite before claiming the fix works.');

  const again = await addLessons(project, 'engineering', ['Name the exact command in the report.'], null);
  assert.deepEqual(again, { added: [], skipped: 1 });
});

test('the journal keeps only the newest twenty lessons', async () => {
  const project = freshProject();
  await addLessons(project, 'qa', Array.from({ length: 25 }, (_, index) => `Lesson number ${index} is specific.`), null);
  const journal = await readDepartmentJournal(project, 'qa');
  assert.equal(journal.lessons.length, 20);
  assert.equal(journal.lessons[0].text, 'Lesson number 5 is specific.');
  assert.equal(journal.lessons.at(-1).text, 'Lesson number 24 is specific.');
});

test('reviews are recorded, found and updated', async () => {
  const project = freshProject();
  await recordReview(project, 'engineering', 'ses_review_1');
  const found = await findReview(project, 'ses_review_1');
  assert.equal(found.department, 'engineering');
  assert.equal(found.review.status, 'pending');

  await updateReview(project, 'ses_review_1', { status: 'collected', added: 2 });
  const updated = await findReview(project, 'ses_review_1');
  assert.equal(updated.review.status, 'collected');
  assert.equal(updated.review.added, 2);
  assert.equal(await findReview(project, 'ses_missing'), null);
  await assert.rejects(() => updateReview(project, 'ses_missing', {}), /not in the journal/i);
});

test('a corrupt journal is reported, never silently replaced', async () => {
  const project = freshProject();
  writeFileSync(journalFile(), '{ not json');
  await assert.rejects(() => readProjectJournal(project), /journal is unreadable/i);
  await assert.rejects(() => addLessons(project, 'engineering', ['A real lesson lives here.'], null), /journal is unreadable/i);
});
