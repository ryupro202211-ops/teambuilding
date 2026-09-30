'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { composeDailyTasks } = require('../compose_daily_tasks');
const { validateDailyTasks } = require('../daily_tasks');

const TODAY = '2026-09-26';
const history = { used: [
  { date: '2026-09-20', source: 'イチロー', quote: '小さなことを積み重ねる' },
  { date: '2026-05-01', source: '孟子', quote: '古い格言' }
] };

function draft(extra) {
  return Object.assign({
    notion: [
      { pageId: 'p1', title: '自分の遅れ', due: '2026-09-23', url: 'https://www.notion.so/p1' },
      { pageId: 'p2', title: 'メンバーの遅れ', due: '2026-09-25', owner: 'つなこ', url: 'https://www.notion.so/p2' },
      { pageId: 'p3', title: '監視外の人の遅れ', due: '2026-09-20', owner: '知らない人', url: 'https://www.notion.so/p3' },
      { pageId: 'p4', title: '今日締切', due: '2026-09-26', url: 'https://www.notion.so/p4' },
      { pageId: 'p5', title: '来週締切', due: '2026-10-02', url: 'https://www.notion.so/p5' },
      { pageId: 'p6', title: '今日やる', due: null, pick: 'high', url: 'https://www.notion.so/p6' },
      { pageId: 'p7', title: 'いつか', url: 'https://www.notion.so/p7' }
    ],
    calendar: [
      { eventId: 'e1', title: '朝会', date: '2026-09-26', time: '09:00' },
      { eventId: 'e2', title: '面談の準備', date: '2026-09-28', time: '14:00' }
    ],
    quote: { text: '新しい格言', source: '渋沢栄一' },
    comment: '期限切れから片づける。'
  }, extra || {});
}

const bySection = (out, s) => out.tasks.filter(t => t.section === s).map(t => t.title);

test('期限と担当者から区分と期限切れ日数を決める', () => {
  const out = composeDailyTasks(draft(), { today: TODAY, history });
  assert.deepEqual(bySection(out, 'selfOverdue'), ['自分の遅れ']);
  assert.deepEqual(bySection(out, 'memberOverdue'), ['メンバーの遅れ']);
  assert.deepEqual(bySection(out, 'today'), ['今日締切']);
  assert.deepEqual(bySection(out, 'upcoming'), ['来週締切', '面談の準備']);
  assert.deepEqual(bySection(out, 'todo'), ['今日やる']);
  assert.deepEqual(bySection(out, 'other'), ['監視外の人の遅れ', 'いつか']);
  assert.equal(out.tasks.find(t => t.title === '自分の遅れ').overdueDays, 3);
  assert.equal(out.tasks.find(t => t.title === 'メンバーの遅れ').overdueDays, 1);
  assert.equal(out.tasks.find(t => t.title === '監視外の人の遅れ').overdueDays, 0);
  assert.equal(out.tasks.find(t => t.title === '今日やる').priority, 'high');
});

test('IDと日付表示・HP・情報ソースを埋める', () => {
  const out = composeDailyTasks(draft(), { today: TODAY, history });
  assert.equal(out.date, TODAY);
  assert.equal(out.dayLabel, '2026年9月26日（土）');
  assert.equal(out.tasks[0].id, 'notion:p1');
  assert.ok(out.tasks.some(t => t.id === 'calendar:e2'));
  assert.deepEqual(out.calendar, [{ id: 'calendar:e1', title: '朝会', time: '09:00' }]);
  assert.deepEqual(out.hp, { selfOverdue: 1, memberOverdue: 1 });
  assert.match(out.hpNote, /自分の期限切れ 1件/);
  assert.deepEqual(out.sources.notion, { ok: true, count: 7 });
  assert.deepEqual(out.sources.calendar, { ok: true, count: 2 });
});

test('Gmail統合後の検証に通る形を出す', () => {
  const out = composeDailyTasks(draft(), { today: TODAY, history });
  const withGmail = Object.assign({}, out, { sources: Object.assign({}, out.sources, { gmail: { ok: true, checkedThreads: 0, uniqueThreads: 0 } }) });
  assert.doesNotThrow(() => validateDailyTasks(withGmail, TODAY, { requireSection: true }));
});

test('90日以内に使った格言は句読点が違っても弾く', () => {
  assert.throws(() => composeDailyTasks(draft({ quote: { text: '小さなことを、積み重ねる。', source: '別人' } }), { today: TODAY, history }), /90日/);
});

test('30日以内に使った出典は弾く', () => {
  assert.throws(() => composeDailyTasks(draft({ quote: { text: '別の言葉', source: 'イチロー' } }), { today: TODAY, history }), /30日/);
});

test('古い格言は再利用できる', () => {
  assert.doesNotThrow(() => composeDailyTasks(draft({ quote: { text: '古い格言', source: '孟子' } }), { today: TODAY, history }));
});

test('今日やる印の値が不正なら止める', () => {
  assert.throws(() => composeDailyTasks(draft({ notion: [{ pageId: 'x', title: 't', pick: 'urgent' }] }), { today: TODAY, history }), /pick/);
});

test('同じページが2回あれば止める', () => {
  assert.throws(() => composeDailyTasks(draft({ notion: [{ pageId: 'x', title: 'a' }, { pageId: 'x', title: 'b' }] }), { today: TODAY, history }), /重複/);
});
