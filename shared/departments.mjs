/**
 * Agent Office — departments over the project's existing agents.
 *
 * A department names a lead and its members. It never creates, spawns or owns
 * an agent: every id here is an agent the host already exposes.
 *
 * "Self-improving" in this project means a journal, not a silent rewrite. The
 * Office advisor turns finished work into a few short lessons, and those
 * lessons are added to the next task the department receives. No agent
 * definition is edited without the user seeing it.
 */

export const DEPARTMENT_MAX = 8;
export const MEMBER_MAX = 20;
export const LESSON_MAX = 200;
export const LESSONS_PER_TASK = 6;
export const LESSONS_PER_REVIEW = 3;

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function words(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** A stable, lowercase id for a department name or explicit id. */
export function departmentId(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/** Visible primary agents, i.e. the only agents that may lead a department. */
export function primaryAgents(agents) {
  const list = Array.isArray(agents) ? agents : isRecord(agents) ? Object.values(agents) : [];
  return list.filter((agent) => agent && typeof agent.id === 'string' &&
    agent.hidden !== true && agent.subagentOnly !== true && agent.subagent !== true &&
    (agent.mode === undefined || agent.mode === 'primary' || agent.mode === 'all'));
}

/**
 * Validate a saved departments value. Returns null for "not configured".
 * Throws instead of guessing: a department without a lead is not a team.
 */
export function normalizeDepartments(value) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new Error('Departments must be a list.');
  if (value.length > DEPARTMENT_MAX) throw new Error(`At most ${DEPARTMENT_MAX} departments.`);
  const seen = new Set();
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Department ${index + 1} must be an object.`);
    const name = words(entry.name, 40);
    if (!name) throw new Error(`Department ${index + 1} needs a name.`);
    const id = departmentId(entry.id || name);
    if (!id) throw new Error(`Department ${index + 1} needs an id.`);
    if (seen.has(id)) throw new Error(`Department id "${id}" appears twice.`);
    seen.add(id);
    const lead = words(entry.lead, 64);
    if (!lead) throw new Error(`Department "${name}" needs a lead agent.`);
    const members = Array.isArray(entry.members)
      ? [...new Set(entry.members.filter((m) => typeof m === 'string' && m.trim()).map((m) => m.trim()))]
      : [];
    if (members.length > MEMBER_MAX) throw new Error(`Department "${name}" has too many members.`);
    return { id, name, purpose: words(entry.purpose, 160), lead, members };
  });
}

/**
 * The departments the user will see. An unconfigured project gets one default
 * department built from the selected lead and the visible primary agents, so
 * the Office still reads as a team on first run. It is not saved.
 */
export function departmentsFor(settings, agents) {
  const saved = normalizeDepartments(settings?.departments);
  if (saved && saved.length) return saved;
  const lead = typeof settings?.lead === 'string' ? settings.lead.trim() : '';
  if (!lead) return [];
  const candidates = primaryAgents(agents).map((agent) => agent.id);
  return [{
    id: 'office',
    name: 'Office',
    purpose: 'The default team for this project.',
    lead,
    members: candidates.filter((id) => id !== lead),
  }];
}

export function departmentFor(departments, id) {
  const list = Array.isArray(departments) ? departments : [];
  return list.find((department) => department.id === id) ?? list[0] ?? null;
}

/** Lessons are stored as records; this accepts either records or strings. */
export function lessonTexts(lessons, limit = LESSONS_PER_TASK) {
  const list = Array.isArray(lessons) ? lessons : [];
  return list
    .map((lesson) => (typeof lesson === 'string' ? lesson : lesson?.text))
    .filter((text) => typeof text === 'string' && text.trim())
    .map((text) => text.trim().slice(0, LESSON_MAX))
    .slice(0, limit);
}

/** The block appended to a task so the team carries its own experience. */
export function departmentContext(department, lessons) {
  if (!department) return '';
  const lines = [`Office department: ${department.name}${department.purpose ? ` — ${department.purpose}` : ''}`];
  lines.push(`Lead: ${department.lead}${department.members?.length ? ` · Members: ${department.members.join(', ')}` : ''}`);
  const learned = lessonTexts(lessons, LESSONS_PER_TASK);
  if (learned.length) {
    lines.push('What this team learned (carry it into this task):', ...learned.map((text) => `- ${text}`));
  }
  return lines.join('\n');
}

export function withDepartmentContext(prompt, department, lessons) {
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  const block = departmentContext(department, lessons);
  return block ? `${text}\n\n—\n${block}` : text;
}

/**
 * Read the advisor's lessons. Only an explicit `LESSON:` line counts; a
 * paragraph of advice is not silently turned into a rule.
 */
export function parseLessons(text, max = LESSONS_PER_REVIEW) {
  const out = [];
  const seen = new Set();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = /^\s*lesson\s*:\s*(.+)$/i.exec(line);
    if (!match) continue;
    const lesson = match[1].replace(/\s+/g, ' ').trim().slice(0, LESSON_MAX);
    if (lesson.length < 10) continue;
    const key = lesson.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(lesson);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The advisor's brief. It is an OpenCode session like any other: the Office
 * only composes the question and stores what comes back.
 */
export function reviewPrompt(department, lessons, finished) {
  const work = (Array.isArray(finished) ? finished : [])
    .map((item) => `- ${item.title || item.id} — ${item.label || 'outcome unknown'} — ${item.id}`)
    .join('\n');
  const learned = lessonTexts(lessons, 12);
  return [
    `You are the Office advisor reviewing the ${department.name} department.`,
    department.purpose ? `Purpose: ${department.purpose}` : '',
    `Lead: ${department.lead}${department.members?.length ? ` · Members: ${department.members.join(', ')}` : ''}`,
    '',
    'Finished Office work (host-reported outcomes; completion is not verification):',
    work,
    '',
    learned.length ? 'Lessons this team already carries:' : '',
    ...learned.map((text) => `- ${text}`),
    '',
    `Write at most ${LESSONS_PER_REVIEW} lessons this team should carry into its next task.`,
    'Rules: one per line, exactly "LESSON: " followed by at most 200 characters; only from the evidence above; no generic advice; do not repeat an existing lesson.',
    'Then one final line: "VERDICT: " and a short judgement of what the team should do differently.',
  ].filter((line) => line !== '').join('\n');
}

export default {
  DEPARTMENT_MAX,
  MEMBER_MAX,
  LESSON_MAX,
  LESSONS_PER_TASK,
  LESSONS_PER_REVIEW,
  departmentId,
  primaryAgents,
  normalizeDepartments,
  departmentsFor,
  departmentFor,
  lessonTexts,
  departmentContext,
  withDepartmentContext,
  parseLessons,
  reviewPrompt,
};
