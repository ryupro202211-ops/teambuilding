'use strict';

// Existing canonical owner key; only Gmail member-overdue monitoring is excluded.
const EXCLUDED_GMAIL_OVERDUE_OWNERS = new Set(['シェフ富徳']);
function excludedMemberOverdue(task){return task?.type==='gmail' && task.section==='memberOverdue' && EXCLUDED_GMAIL_OVERDUE_OWNERS.has(task.owner);}
const TASK_TYPES = new Set(['notion', 'gmail', 'calendar']);
const TASK_SECTIONS = new Set(['selfOverdue', 'memberOverdue', 'todo', 'today', 'upcoming', 'other']);
const PRIORITIES = new Set(['high', 'medium', 'low']);

function inferSection(task, today) {
  if (task.type === 'calendar') return task.due === today ? 'today' : 'upcoming';
  if (!task.due) return 'other';
  if (task.due < today) return 'selfOverdue';
  if (task.due === today) return 'today';
  return 'upcoming';
}

function jsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.map(item => {
      const normalized = jsonValue(item);
      return normalized === undefined ? null : normalized;
    });
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key, jsonValue(item)])
      .filter(([, item]) => item !== undefined));
  }
  return undefined;
}

function normalizeSources(input, reuseData) {
  const sources = jsonValue(input);
  const normalized = sources && !Array.isArray(sources) && typeof sources === 'object' ? sources : {};
  const gmail = normalized.gmail;
  if (gmail && !Array.isArray(gmail) && typeof gmail === 'object') {
    for (const field of ['checkedThreads', 'uniqueThreads']) {
      if (field in gmail && (!Number.isInteger(gmail[field]) || gmail[field] < 0)) {
        throw new Error(`invalid Gmail ${field}`);
      }
    }
  }
  const missing = input == null || (Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 0);
  if (reuseData && missing) return normalized;
  for (const source of ['calendar', 'notion', 'gmail']) {
    if (normalized[source]?.ok !== true) throw new Error(`unverified sources.${source}`);
  }
  for (const field of ['checkedThreads', 'uniqueThreads']) {
    if (!Number.isInteger(gmail[field])) throw new Error(`missing Gmail ${field}`);
  }
  if (gmail.checkedThreads !== gmail.uniqueThreads) throw new Error('Gmail checkedThreads must equal uniqueThreads');
  return normalized;
}

function validateDailyTasks(input, today, { reuseData = false, requireSection = false } = {}) {
  if (!input || input.date !== today || !Array.isArray(input.tasks)) {
    throw new Error('daily task date or tasks is invalid');
  }

  const seen = new Set();
  const tasks = input.tasks.map(task => {
    if (!task || !task.id || !TASK_TYPES.has(task.type) || !task.title) {
      throw new Error('invalid daily task');
    }
    if (seen.has(task.id)) throw new Error('duplicate daily task id: ' + task.id);
    seen.add(task.id);

    if (requireSection && task.section == null) throw new Error('daily task section is required');
    const section = task.section ?? inferSection(task, today);
    if (!TASK_SECTIONS.has(section)) throw new Error('invalid daily task section');
    const priority = task.priority ?? null;
    if (priority !== null && !PRIORITIES.has(priority)) throw new Error('invalid daily task priority');
    const overdueDays = task.overdueDays ?? 0;
    if (!Number.isInteger(overdueDays) || overdueDays < 0) {
      throw new Error('invalid daily task overdueDays');
    }
    if (task.section != null) {
      if (section === 'todo' && priority === null) throw new Error('todo priority is required');
      if ((section === 'selfOverdue' || section === 'memberOverdue') && overdueDays < 1) {
        throw new Error(`${section} overdueDays must be positive`);
      }
      if (section !== 'selfOverdue' && section !== 'memberOverdue' && overdueDays !== 0) {
        throw new Error(`${section} overdueDays must be zero`);
      }
    }

    const owner = task.owner == null ? null : String(task.owner);
    if (owner !== null && (owner.length === 0 || owner.length > 40)) throw new Error('invalid daily task owner');

    return {
      id: task.id,
      type: task.type,
      title: task.title,
      owner,
      detail: task.detail ?? '',
      due: task.due ?? null,
      section,
      priority,
      overdueDays,
      url: task.url ?? null,
      contact: null
    };
  });

  const included=tasks.filter(task=>!excludedMemberOverdue(task));
  const hp=tasks.length===included.length?input.hp:{selfOverdue:included.filter(t=>t.section==='selfOverdue').length,memberOverdue:included.filter(t=>t.section==='memberOverdue').length};
  return { ...input, tasks:included, ...(hp===undefined?{}:{hp}), ...(tasks.length===included.length?{}:{hpNote:`\u672c\u4eba\u306e\u671f\u9650\u5207\u308c ${hp.selfOverdue}\u4ef6 \u00d7-10 / \u30e1\u30f3\u30d0\u30fc\u5207\u308c ${hp.memberOverdue}\u4ef6 \u00d7-5 / \u6bce\u65e5100\u306b\u30ea\u30bb\u30c3\u30c8`}), sources: normalizeSources(input.sources, reuseData) };
}

module.exports = { validateDailyTasks, excludedMemberOverdue, EXCLUDED_GMAIL_OVERDUE_OWNERS };
