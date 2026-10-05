const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveDefeated } = require('../resolved_tasks');

const prev = (tasks, date = '2026-09-15') => ({ date, tasks });
const now = (tasks, date = '2026-09-16') => ({ date, tasks });
const task = (over) => Object.assign({ id: 'a', type: 'gmail', title: '集金', detail: '9/15 つなこ', section: 'memberOverdue', overdueDays: 3 }, over);

test('reports an overdue task that disappeared as defeated', () => {
  const result = resolveDefeated(prev([task()]), now([]));
  assert.deepEqual(result.map(x => [x.id, x.section, x.overdueDays]), [['a', 'memberOverdue', 3]]);
});

test('reports an overdue task that moved out of the overdue sections', () => {
  // 相手が動いて期限が先に進んだ場合も前進として数える
  const result = resolveDefeated(prev([task()]), now([task({ section: 'upcoming', overdueDays: 0, detail: '9/18 つなこ' })]));
  assert.equal(result.length, 1);
});

test('keeps a still-overdue task out of the result, by id or by title and detail', () => {
  assert.deepEqual(resolveDefeated(prev([task()]), now([task({ overdueDays: 4 })])), []);
  assert.deepEqual(resolveDefeated(prev([task()]), now([task({ id: 'renamed-id', overdueDays: 4 })])), []);
  assert.deepEqual(resolveDefeated(prev([task()]), now([task({ id: 'renamed-id', detail: ' 9/15　つなこ ' })])), []);
});

test('keeps a Gmail task out of defeats across the legacy section ID migration', () => {
  const previous = prev([task({
    id: 'gmail:thread-1:2026-09-15:memberOverdue',
    detail: '期限 09/15・担当 つなこ',
  })]);
  const current = now([task({
    id: 'gmail:thread-1:2026-09-15',
    detail: '期限 09/15・担当 つなこ・ノスタ',
    owner: 'つなこ・ノスタ',
  })]);

  assert.deepEqual(resolveDefeated(previous, current), []);
});

test('ignores tasks that were never overdue', () => {
  for (const section of ['today', 'upcoming', 'todo', 'other']) {
    assert.deepEqual(resolveDefeated(prev([task({ section, overdueDays: 0 })]), now([])), []);
  }
});

test('never invents a defeat when rebuilding the same day', () => {
  assert.deepEqual(resolveDefeated(prev([task()], '2026-09-16'), now([])), []);
});

test('returns nothing when there is no usable previous build', () => {
  for (const previous of [null, undefined, {}, { date: '2026-09-15' }, { tasks: 'x' }]) {
    assert.deepEqual(resolveDefeated(previous, now([])), []);
  }
  assert.deepEqual(resolveDefeated(prev([task()]), { date: '2026-09-16' }), []);
});

test('carries only display fields and normalizes a broken overdue count', () => {
  const [item] = resolveDefeated(prev([task({ overdueDays: null, url: 'https://example.com', type: 'gmail' })]), now([]));
  assert.deepEqual(Object.keys(item).sort(), ['detail', 'id', 'overdueDays', 'section', 'title']);
  assert.equal(item.overdueDays, 0);
});

test('removing an excluded canonical owner is not credited as a completed task',()=>{const {resolveDefeated}=require('../resolved_tasks');const task={id:'chef',type:'gmail',title:'fixture',section:'memberOverdue',owner:'\u30b7\u30a7\u30d5\u5bcc\u5fb3',overdueDays:1};assert.deepEqual(resolveDefeated({date:'2026-10-04',tasks:[task]},{date:'2026-10-05',tasks:[]}),[]);assert.equal(resolveDefeated({date:'2026-10-04',tasks:[{...task,owner:task.owner+'2'}]},{date:'2026-10-05',tasks:[]}).length,1);});
