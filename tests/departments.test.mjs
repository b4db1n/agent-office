import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  departmentId,
  normalizeDepartments,
  departmentsFor,
  departmentFor,
  withDepartmentContext,
  parseLessons,
  reviewPrompt,
} from '../shared/departments.mjs';

const AGENTS = [
  { id: 'lead', mode: 'primary' },
  { id: 'helper', mode: 'primary' },
  { id: 'hidden-one', mode: 'primary', hidden: true },
  { id: 'worker', mode: 'subagent', subagentOnly: true },
];

test('department ids are stable slugs', () => {
  assert.equal(departmentId('Research Lab'), 'research-lab');
  assert.equal(departmentId('  QA & Review  '), 'qa-review');
  assert.equal(departmentId('***'), '');
});

test('normalizeDepartments rejects a team without a lead', () => {
  assert.throws(() => normalizeDepartments([{ name: 'Research' }]), /lead agent/i);
  assert.throws(() => normalizeDepartments([{ name: '' , lead: 'lead' }]), /needs a name/i);
  assert.throws(() => normalizeDepartments('nope'), /list/i);
});

test('normalizeDepartments dedupes ids, members and names', () => {
  const list = normalizeDepartments([
    { id: 'Build Team', name: 'Build Team', purpose: ' Ship it ', lead: 'lead', members: ['helper', 'helper', 7] },
  ]);
  assert.deepEqual(list, [
    { id: 'build-team', name: 'Build Team', purpose: 'Ship it', lead: 'lead', members: ['helper'] },
  ]);
  assert.throws(() => normalizeDepartments([
    { id: 'same', name: 'One', lead: 'lead' },
    { id: 'same', name: 'Two', lead: 'helper' },
  ]), /appears twice/i);
});

test('departmentsFor prefers saved teams and otherwise derives one from the lead', () => {
  const saved = departmentsFor({ departments: [{ name: 'Research', lead: 'helper' }] }, AGENTS);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].lead, 'helper');

  const derived = departmentsFor({ lead: 'lead' }, AGENTS);
  assert.deepEqual(derived, [{
    id: 'office',
    name: 'Office',
    purpose: 'The default team for this project.',
    lead: 'lead',
    members: ['helper'],
  }]);

  assert.deepEqual(departmentsFor({}, AGENTS), []);
});

test('departmentFor uses an exact id and otherwise the first team', () => {
  const list = [
    { id: 'one', name: 'One', lead: 'lead', members: [] },
    { id: 'two', name: 'Two', lead: 'helper', members: [] },
  ];
  assert.equal(departmentFor(list, 'two').name, 'Two');
  assert.equal(departmentFor(list, 'missing').name, 'One');
  assert.equal(departmentFor([], 'two'), null);
});

test('task context carries the team and its lessons, capped', () => {
  const department = { id: 'eng', name: 'Engineering', purpose: 'Build it', lead: 'lead', members: ['helper'] };
  const lessons = Array.from({ length: 9 }, (_, index) => ({ text: `Lesson number ${index}` }));
  const text = withDepartmentContext('Fix the build.', department, lessons);
  assert.match(text, /^Fix the build\./);
  assert.match(text, /Office department: Engineering — Build it/);
  assert.match(text, /Lead: lead · Members: helper/);
  assert.match(text, /Lesson number 0/);
  assert.match(text, /Lesson number 5/);
  assert.doesNotMatch(text, /Lesson number 6/);
  assert.equal(withDepartmentContext('No team', null, lessons), 'No team');
});

test('only explicit LESSON lines become lessons', () => {
  const text = [
    'The team should test more. This paragraph is not a rule.',
    'LESSON: Run the build before claiming a change works.',
    'lesson: run the build before claiming a change works.',
    'LESSON: short',
    'LESSON: Name the exact command in the report.',
    'LESSON: Final lesson that should be dropped because the cap is three.',
  ].join('\n');
  assert.deepEqual(parseLessons(text), [
    'Run the build before claiming a change works.',
    'Name the exact command in the report.',
    'Final lesson that should be dropped because the cap is three.',
  ]);
});

test('the advisor brief names the work, the lessons and the format', () => {
  const department = { id: 'eng', name: 'Engineering', purpose: 'Build it', lead: 'lead', members: ['helper'] };
  const prompt = reviewPrompt(department, [{ text: 'Always run the suite.' }], [
    { id: 'ses_1', title: 'Fix the build', label: 'host reported succeeded' },
  ]);
  assert.match(prompt, /Office advisor reviewing the Engineering department/);
  assert.match(prompt, /host reported succeeded/);
  assert.match(prompt, /Always run the suite\./);
  assert.match(prompt, /"LESSON: "/);
  assert.match(prompt, /VERDICT:/);
});
