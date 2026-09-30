'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { appendVictoryLog } = require('../resolved_tasks');

test('前回の履歴に今日の撃破数を積む', () => {
  const log = appendVictoryLog([{ date: '2026-09-24', count: 2 }], '2026-09-25', 3);
  assert.deepEqual(log, [{ date: '2026-09-24', count: 2 }, { date: '2026-09-25', count: 3 }]);
});

test('同じ日に作り直したときは上書きする', () => {
  const log = appendVictoryLog([{ date: '2026-09-25', count: 1 }], '2026-09-25', 4);
  assert.deepEqual(log, [{ date: '2026-09-25', count: 4 }]);
});

test('8週より古い記録と壊れた行は捨てる', () => {
  const log = appendVictoryLog([
    { date: '2026-07-01', count: 5 }, { date: 'bad', count: 1 }, { date: '2026-09-01', count: -1 },
    { date: '2026-08-10', count: 2 }
  ], '2026-09-25', 0);
  assert.deepEqual(log, [{ date: '2026-08-10', count: 2 }, { date: '2026-09-25', count: 0 }]);
});

test('前回の履歴が無くても動く', () => {
  assert.deepEqual(appendVictoryLog(undefined, '2026-09-25', 1), [{ date: '2026-09-25', count: 1 }]);
});
