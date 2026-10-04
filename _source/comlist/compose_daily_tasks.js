'use strict';

/* Claude / Codex が書いた下書き（_work/daily_draft.json）から _work/daily_tasks.json を組み立てる。
   人が決めるのは「どのタスクを今日やるか（pick）」「格言」「参謀コメント」だけにし、
   区分・期限切れ日数・HP・曜日・ID・情報ソースの件数と格言の重複チェックはここで機械的に決める。

   使い方:
     node compose_daily_tasks.js --today YYYY-MM-DD [--draft _work/daily_draft.json] [--out _work/daily_tasks.json]

   下書きの形:
     { "notion":   [{ "pageId", "title", "due"?: "YYYY-MM-DD"|null, "owner"?, "url", "detail"?, "pick"?: "high"|"medium"|"low" }],
       "calendar": [{ "eventId", "title", "date": "YYYY-MM-DD", "time"? }],   // 今日の予定と、準備が要る先の予定
       "quote": { "text", "source" }, "comment": "..." } */

const fs = require('node:fs');
const path = require('node:path');

const { MONITORED_MEMBERS } = require('./gmail_tasks');
const { validateDailyTasks } = require('./daily_tasks');

const SELF = 'りゅうちゃん';
const PRIORITIES = new Set(['high', 'medium', 'low']);
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const dayNumber = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;

// _quote_history.json の _rules.normalize と同じ考え方: 括弧・句読点・空白・ダッシュを除いて比べる
const normalizeQuote = (s) => String(s || '').normalize('NFKC')
  .replace(/[「」『』（）()、。，．,.・\s\-‐－—―~〜]/g, '').toLowerCase();

function checkQuote(quote, history, today) {
  if (!quote || !String(quote.text || '').trim()) throw new Error('格言がありません');
  const text = normalizeQuote(quote.text);
  const source = normalizeQuote(quote.source);
  for (const used of (history && Array.isArray(history.used) ? history.used : [])) {
    if (!used || !ISO.test(String(used.date)) || used.date === today) continue;
    const age = dayNumber(today) - dayNumber(used.date);
    if (age <= 90 && normalizeQuote(used.quote) === text) {
      throw new Error(`格言が90日以内（${used.date}）に使ったものと同じです`);
    }
    if (age <= 30 && source && normalizeQuote(used.source) === source) {
      throw new Error(`出典「${quote.source}」を30日以内（${used.date}）に使っています`);
    }
  }
}

function ownerKind(owner) {
  const text = String(owner || '').trim();
  if (!text || text.includes(SELF)) return 'self';
  return MONITORED_MEMBERS.some((name) => text.includes(name)) ? 'member' : 'other';
}

function notionTask(item, today) {
  if (!item || !item.pageId || !item.title) throw new Error('Notionタスクに pageId と title が必要です');
  if (item.due != null && !ISO.test(String(item.due))) throw new Error('due の形式が不正です: ' + item.pageId);
  if (item.pick != null && !PRIORITIES.has(item.pick)) throw new Error('pick は high / medium / low のどれか: ' + item.pageId);
  const due = item.due || null;
  let section;
  let overdueDays = 0;
  if (due && due < today) {
    const kind = ownerKind(item.owner);
    if (kind === 'other') section = 'other';
    else { section = kind === 'self' ? 'selfOverdue' : 'memberOverdue'; overdueDays = dayNumber(today) - dayNumber(due); }
  } else if (due === today) section = 'today';
  else if (due) section = 'upcoming';
  else section = item.pick ? 'todo' : 'other';
  const task = { id: 'notion:' + item.pageId, type: 'notion', title: String(item.title), detail: item.detail || '',
    due, section, overdueDays, url: item.url || null };
  if (item.owner) task.owner = String(item.owner);
  if (section === 'todo') task.priority = item.pick;
  return task;
}

function composeDailyTasks(draft, { today, history, calendarMaterial }) {
  if (!ISO.test(String(today))) throw new Error('--today は YYYY-MM-DD');
  const notion = Array.isArray(draft && draft.notion) ? draft.notion : [];
  const calendar = Array.isArray(draft && draft.calendar) ? draft.calendar : [];
  checkQuote(draft && draft.quote, history, today);

  const tasks = notion.map((item) => notionTask(item, today));
  const todayEvents = [];
  for (const ev of calendar) {
    if (!ev || !ev.eventId || !ev.title || !ISO.test(String(ev.date))) throw new Error('予定に eventId・title・date が必要です');
    if (ev.date < today) continue;
    if (ev.date === today) todayEvents.push({ id: 'calendar:' + ev.eventId, title: String(ev.title), time: ev.time || '' });
    else tasks.push({ id: 'calendar:' + ev.eventId, type: 'calendar', title: String(ev.title),
      detail: ev.date.slice(5).replace('-', '/') + (ev.time ? ' ' + ev.time : ''), due: ev.date,
      section: 'upcoming', overdueDays: 0, url: null });
  }
  const seen = new Set();
  for (const t of tasks) { if (seen.has(t.id)) throw new Error('タスクが重複しています: ' + t.id); seen.add(t.id); }

  const hp = { selfOverdue: tasks.filter((t) => t.section === 'selfOverdue').length,
    memberOverdue: tasks.filter((t) => t.section === 'memberOverdue').length };
  const d = new Date(today + 'T00:00:00Z');
  const out = {
    date: today,
    dayLabel: `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEKDAYS[d.getUTCDay()]}）`,
    hp,
    hpNote: `自分の期限切れ ${hp.selfOverdue}件 ×-10 ／ メンバー切れ ${hp.memberOverdue}件 ×-5 ／ 毎朝100にリセット`,
    quote: { text: String(draft.quote.text), source: String(draft.quote.source || '') },
    comment: String((draft && draft.comment) || ''),
    calendar: todayEvents,
    tasks,
    sources: { calendar: { ok: true, count: calendar.length }, notion: { ok: true, count: notion.length } }
  };
  // Gmail はまだ入っていないので、区分の契約だけを先に検査する（Gmail統合後に全体をもう一度検査する）
  validateDailyTasks(Object.assign({}, out, { sources: Object.assign({}, out.sources, { gmail: { ok: true, checkedThreads: 0, uniqueThreads: 0 } }) }),
    today, { requireSection: true });
  return calendarMaterial === undefined ? out : require('./calendar_schedule').applyCalendarSchedule(out, calendarMaterial, today);
}

function main(argv) {
  const arg = (name, fallback) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : fallback; };
  const today = arg('today');
  const draftPath = arg('draft', path.join(__dirname, '_work', 'daily_draft.json'));
  const outPath = arg('out', path.join(__dirname, '_work', 'daily_tasks.json'));
  const history = JSON.parse(fs.readFileSync(path.join(__dirname, '_quote_history.json'), 'utf8'));
  const calendarPath = arg('calendar-material', path.join(path.dirname(draftPath), 'calendar.json'));
  const calendarMaterial = fs.existsSync(calendarPath) ? JSON.parse(fs.readFileSync(calendarPath, 'utf8')) : undefined;
  const out = composeDailyTasks(JSON.parse(fs.readFileSync(draftPath, 'utf8')), { today, history, calendarMaterial });
  const tmp = outPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n');
  fs.renameSync(tmp, outPath);
  const count = (s) => out.tasks.filter((t) => t.section === s).length;
  console.log(`COMPOSE_RESULT: OK tasks=${out.tasks.length} selfOverdue=${count('selfOverdue')} memberOverdue=${count('memberOverdue')} todo=${count('todo')} today=${count('today')} upcoming=${count('upcoming')} other=${count('other')}`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error('COMPOSE_RESULT: FAILED ' + e.message); process.exit(1); }
}

module.exports = { composeDailyTasks, normalizeQuote };
