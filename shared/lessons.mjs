/**
 * Agent Office — the journal behind a department's lessons.
 *
 * A lesson is a short, sourced statement the advisor derived from finished
 * work. The journal is append-only from the user's point of view: nothing here
 * rewrites an agent definition, and every lesson keeps the session it came
 * from. It is Office state, not project content, so it lives beside settings.
 */

import { mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { LESSON_MAX } from './departments.mjs';

const MAX_LESSONS = 20;
const MAX_REVIEWS = 12;

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function journalFile() {
  return process.env.AGENT_OFFICE_LESSONS_FILE || path.join(homedir(), '.config', 'agent-office', 'lessons.json');
}

function emptyStore() {
  return { version: 1, projects: {} };
}

async function readStore() {
  try {
    const parsed = JSON.parse(await readFile(journalFile(), 'utf8'));
    if (!isRecord(parsed) || !isRecord(parsed.projects ?? {})) throw new Error('invalid');
    return { version: 1, ...parsed, projects: isRecord(parsed.projects) ? parsed.projects : {} };
  } catch (error) {
    if (error.code === 'ENOENT') return emptyStore();
    throw new Error('The Office journal is unreadable. No changes were made.');
  }
}

async function withLock(file, fn) {
  const lock = `${file}.lock`;
  let handle;
  for (let attempt = 0; !handle; attempt++) {
    try {
      handle = await open(lock, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (attempt >= 40) throw new Error('The Office journal is busy. Try again.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await unlink(lock).catch(() => undefined);
  }
}

async function mutate(fn) {
  const file = journalFile();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  return withLock(file, async () => {
    const store = await readStore();
    const result = await fn(store);
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(store, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temp, file);
    } finally {
      await unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
    return result;
  });
}

function projectEntry(store, key, create) {
  if (!isRecord(store.projects[key])) {
    if (!create) return null;
    store.projects[key] = { departments: {} };
  }
  const project = store.projects[key];
  if (!isRecord(project.departments)) {
    if (!create) return null;
    project.departments = {};
  }
  return project;
}

function departmentEntry(project, id, create) {
  if (!isRecord(project.departments[id])) {
    if (!create) return null;
    project.departments[id] = { lessons: [], reviews: [] };
  }
  const department = project.departments[id];
  if (!Array.isArray(department.lessons)) department.lessons = [];
  if (!Array.isArray(department.reviews)) department.reviews = [];
  return department;
}

async function projectKey(directory) {
  if (typeof directory !== 'string' || !directory) throw new Error('A project directory is required.');
  return realpath(directory);
}

function cleanDepartmentId(id) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('A department is required.');
  return id.trim();
}

function cleanLesson(text) {
  const lesson = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, LESSON_MAX);
  if (lesson.length < 10) throw new Error('A lesson needs at least 10 characters.');
  return lesson;
}

/** Read one department's journal. An absent journal is empty, not an error. */
export async function readDepartmentJournal(directory, id) {
  const key = await projectKey(directory);
  const department = cleanDepartmentId(id);
  const store = await readStore();
  const project = projectEntry(store, key, false);
  const entry = project ? departmentEntry(project, department, false) : null;
  return {
    lessons: (entry?.lessons ?? []).filter(isRecord),
    reviews: (entry?.reviews ?? []).filter(isRecord),
  };
}

/** Every department in one read, for the panel. */
export async function readProjectJournal(directory) {
  const key = await projectKey(directory);
  const store = await readStore();
  const project = projectEntry(store, key, false);
  const result = {};
  for (const [id, value] of Object.entries(project?.departments ?? {})) {
    if (!isRecord(value)) continue;
    result[id] = {
      lessons: (Array.isArray(value.lessons) ? value.lessons : []).filter(isRecord),
      reviews: (Array.isArray(value.reviews) ? value.reviews : []).filter(isRecord),
    };
  }
  return result;
}

/**
 * Add lessons the advisor wrote. Duplicates (case-insensitive) are skipped, not
 * stored twice. Returns the texts actually added.
 */
export async function addLessons(directory, id, texts, source) {
  const key = await projectKey(directory);
  const department = cleanDepartmentId(id);
  const lessons = (Array.isArray(texts) ? texts : []).map(cleanLesson);
  if (!lessons.length) return { added: [], skipped: 0 };
  const from = typeof source === 'string' && source ? source : null;
  return mutate((store) => {
    const project = projectEntry(store, key, true);
    const entry = departmentEntry(project, department, true);
    const seen = new Set(entry.lessons.map((lesson) => String(lesson.text ?? '').toLowerCase()));
    const added = [];
    for (const text of lessons) {
      const dedupe = text.toLowerCase();
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      entry.lessons.push({ id: randomUUID(), text, source: from, addedAt: Date.now() });
      added.push(text);
    }
    entry.lessons = entry.lessons.slice(-MAX_LESSONS);
    return { added, skipped: lessons.length - added.length };
  });
}

export async function recordReview(directory, id, sessionId) {
  const key = await projectKey(directory);
  const department = cleanDepartmentId(id);
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('A session is required.');
  return mutate((store) => {
    const project = projectEntry(store, key, true);
    const entry = departmentEntry(project, department, true);
    if (!entry.reviews.some((review) => review.sessionId === sessionId)) {
      entry.reviews.push({ sessionId, status: 'pending', startedAt: Date.now() });
      entry.reviews = entry.reviews.slice(-MAX_REVIEWS);
    }
  });
}

export async function findReview(directory, sessionId) {
  const key = await projectKey(directory);
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('A session is required.');
  const store = await readStore();
  const project = projectEntry(store, key, false);
  for (const [department, entry] of Object.entries(project?.departments ?? {})) {
    if (!isRecord(entry) || !Array.isArray(entry.reviews)) continue;
    const review = entry.reviews.find((item) => isRecord(item) && item.sessionId === sessionId);
    if (review) return { department, review };
  }
  return null;
}

export async function updateReview(directory, sessionId, patch) {
  const key = await projectKey(directory);
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('A session is required.');
  return mutate((store) => {
    const project = projectEntry(store, key, false);
    for (const entry of Object.values(project?.departments ?? {})) {
      if (!isRecord(entry) || !Array.isArray(entry.reviews)) continue;
      const review = entry.reviews.find((item) => isRecord(item) && item.sessionId === sessionId);
      if (!review) continue;
      Object.assign(review, isRecord(patch) ? patch : {}, { updatedAt: Date.now() });
      return true;
    }
    throw new Error('That advisor review is not in the journal.');
  });
}

export default {
  journalFile,
  readDepartmentJournal,
  readProjectJournal,
  addLessons,
  recordReview,
  findReview,
  updateReview,
};
