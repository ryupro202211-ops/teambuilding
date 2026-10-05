'use strict';

/* 前回ビルドの期限切れと今日を突き合わせ、消えた項目を「撃破」として返す。
   相手が動くと期限が先に進んで別の区分へ移るので、区分から外れた場合も前進として数える。
   同じ日に作り直しただけのときは、書き直しを撃破に見せないよう何も返さない。 */

const OVERDUE_SECTIONS = new Set(['selfOverdue', 'memberOverdue']);

const normalize = (value) => String(value == null ? '' : value).replace(/\s+/gu, '').toLowerCase();
const identity = (task) => normalize(task.title) + '|' + normalize(task.detail);
const gmailIdentity = (task) => {
  const match = /^gmail:([^:]+):(\d{4}-\d{2}-\d{2})(?::.*)?$/.exec(String(task?.id || ''));
  return match ? `${match[1]}|${match[2]}` : '';
};

const taskKeys = (task) => {
  const keys = new Set(['id:' + String(task.id), 'key:' + identity(task)]);
  const gmailKey = gmailIdentity(task);
  if (gmailKey) keys.add('gmail:' + gmailKey);
  return keys;
};

function resolveDefeated(previous, current) {
  if (!previous || !Array.isArray(previous.tasks)) return [];
  if (!current || !Array.isArray(current.tasks)) return [];
  if (previous.date && current.date && previous.date === current.date) return [];

  const stillOverdue = new Set();
  for (const task of current.tasks) {
    if (!task || !OVERDUE_SECTIONS.has(task.section)) continue;
    for (const key of taskKeys(task)) stillOverdue.add(key);
  }

  return previous.tasks
    .filter((task) => task && OVERDUE_SECTIONS.has(task.section) && !require('./daily_tasks').excludedMemberOverdue(task))
    .filter((task) => [...taskKeys(task)].every(key => !stillOverdue.has(key)))
    .map((task) => ({
      id: String(task.id),
      title: task.title,
      detail: task.detail == null ? '' : task.detail,
      section: task.section,
      overdueDays: Number.isInteger(task.overdueDays) && task.overdueDays > 0 ? task.overdueDays : 0
    }));
}

/* 日ごとの撃破数を積み上げ、画面の「今週／先週」の集計に使う。
   前回ビルドの履歴に今日の件数を足し、8週（56日）より古い行は落とす。 */
const VICTORY_LOG_DAYS = 56;

function appendVictoryLog(previousLog, date, count) {
  const cutoff = new Date(date + 'T00:00:00Z');
  cutoff.setUTCDate(cutoff.getUTCDate() - VICTORY_LOG_DAYS);
  const min = cutoff.toISOString().slice(0, 10);
  const kept = (Array.isArray(previousLog) ? previousLog : []).filter((row) => row
    && /^\d{4}-\d{2}-\d{2}$/.test(String(row.date))
    && Number.isInteger(row.count) && row.count >= 0
    && row.date >= min && row.date !== date)
    .map((row) => ({ date: row.date, count: row.count }));
  kept.push({ date, count: Number.isInteger(count) && count >= 0 ? count : 0 });
  return kept.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

module.exports = { resolveDefeated, appendVictoryLog };
