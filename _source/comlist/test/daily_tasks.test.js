const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateDailyTasks } = require('../daily_tasks');

function verifiedSources() {
  return { calendar: { ok: true }, notion: { ok: true }, gmail: { ok: true, checkedThreads: 0, uniqueThreads: 0 } };
}

test('rejects a payload for another day and duplicate ids', () => {
  assert.throws(
    () => validateDailyTasks({ date: '2026-09-15', tasks: [] }, '2026-09-16'),
    /date/
  );
  assert.throws(
    () => validateDailyTasks({ date: '2026-09-16', tasks: [
      { id: 'n-1', type: 'notion', title: 'A' },
      { id: 'n-1', type: 'gmail', title: 'B' }
    ] }, '2026-09-16'),
    /duplicate/
  );
});

test('normalizes optional task fields', () => {
  const result = validateDailyTasks({
    sources: verifiedSources(),
    date: '2026-09-16',
    tasks: [{ id: 'n-1', type: 'notion', title: '確認する' }]
  }, '2026-09-16');

  assert.deepEqual(result.tasks[0], {
    id: 'n-1',
    type: 'notion',
    title: '確認する',
    detail: '',
    due: null,
    priority: null,
    section: 'other',
    overdueDays: 0,
    owner: null,
    url: null,
    contact: null
  });
});

test('normalizes morning brief section, priority and overdue days', () => {
  const result = validateDailyTasks({
    date: '2026-09-16',
    tasks: [
      { id: 'gmail:self', type: 'gmail', title: '集計', section: 'selfOverdue', overdueDays: 9 },
      { id: 'notion:todo', type: 'notion', title: '資料', section: 'todo', priority: 'high' },
      { id: 'calendar:next', type: 'calendar', title: '面談', section: 'upcoming' }
    ],
    sources: { ...verifiedSources(), gmail: { ok: true, checkedThreads: 18, uniqueThreads: 18 } }
  }, '2026-09-16');

  assert.deepEqual(result.tasks.map(({ section, priority, overdueDays }) => ({ section, priority, overdueDays })), [
    { section: 'selfOverdue', priority: null, overdueDays: 9 },
    { section: 'todo', priority: 'high', overdueDays: 0 },
    { section: 'upcoming', priority: null, overdueDays: 0 }
  ]);
  assert.equal(result.sources.gmail.checkedThreads, 18);
});

test('rejects invalid morning brief classification', () => {
  assert.throws(() => validateDailyTasks({
    date: '2026-09-16', tasks: [{ id: 'x', type: 'gmail', title: 'x', section: 'boss' }]
  }, '2026-09-16'), /section/);
  assert.throws(() => validateDailyTasks({
    date: '2026-09-16', tasks: [{ id: 'x', type: 'gmail', title: 'x', overdueDays: -1 }]
  }, '2026-09-16'), /overdueDays/);
});

test('rejects inconsistent required fields for explicit sections', () => {
  const cases = [
    [{ id: 'todo', type: 'notion', title: 'todo', section: 'todo' }, /priority/],
    [{ id: 'self', type: 'gmail', title: 'self', section: 'selfOverdue', overdueDays: 0 }, /overdueDays/],
    [{ id: 'member', type: 'gmail', title: 'member', section: 'memberOverdue', overdueDays: 0 }, /overdueDays/],
    [{ id: 'today', type: 'notion', title: 'today', section: 'today', overdueDays: 1 }, /overdueDays/],
    [{ id: 'other', type: 'notion', title: 'other', section: 'other', overdueDays: 2 }, /overdueDays/]
  ];
  for (const [task, error] of cases) {
    assert.throws(() => validateDailyTasks({ date: '2026-09-16', tasks: [task], sources: verifiedSources() }, '2026-09-16'), error);
  }
});

test('infers supported sections for legacy tasks without a section', () => {
  const result = validateDailyTasks({
    sources: verifiedSources(),
    date: '2026-09-16',
    tasks: [
      { id: 'calendar:today', type: 'calendar', title: '面談', due: '2026-09-16' },
      { id: 'calendar:next', type: 'calendar', title: '会議' },
      { id: 'notion:today', type: 'notion', title: '今日', due: '2026-09-16' },
      { id: 'gmail:next', type: 'gmail', title: '先回り', due: '2026-09-17' },
      { id: 'gmail:overdue', type: 'gmail', title: '期限切れ', due: '2026-09-15' },
      { id: 'notion:other', type: 'notion', title: 'いつか' }
    ]
  }, '2026-09-16');

  assert.deepEqual(result.tasks.map(task => task.section), [
    'today', 'upcoming', 'today', 'upcoming', 'selfOverdue', 'other'
  ]);
});

test('accepts every supported section', () => {
  const result = validateDailyTasks({
    date: '2026-09-16',
    tasks: [
      { id: 'task:0', type: 'gmail', title: 'selfOverdue', section: 'selfOverdue', overdueDays: 1 },
      { id: 'task:1', type: 'gmail', title: 'memberOverdue', section: 'memberOverdue', overdueDays: 1 },
      { id: 'task:2', type: 'gmail', title: 'todo', section: 'todo', priority: 'low' },
      { id: 'task:3', type: 'gmail', title: 'today', section: 'today' },
      { id: 'task:4', type: 'gmail', title: 'upcoming', section: 'upcoming' },
      { id: 'task:5', type: 'gmail', title: 'other', section: 'other' }
    ],
    sources: verifiedSources()
  }, '2026-09-16');

  assert.deepEqual(result.tasks.map(task => task.section), [
    'selfOverdue', 'memberOverdue', 'todo', 'today', 'upcoming', 'other'
  ]);
});

test('rejects an invalid priority', () => {
  assert.throws(() => validateDailyTasks({
    date: '2026-09-16', tasks: [{ id: 'x', type: 'gmail', title: 'x', priority: 'urgent' }]
  }, '2026-09-16'), /priority/);
});

test('rejects non-integer and negative Gmail thread counts', () => {
  assert.throws(() => validateDailyTasks({
    date: '2026-09-16', tasks: [], sources: { gmail: { checkedThreads: 1.5 } }
  }, '2026-09-16'), /checkedThreads/);
  assert.throws(() => validateDailyTasks({
    date: '2026-09-16', tasks: [], sources: { gmail: { uniqueThreads: -1 } }
  }, '2026-09-16'), /uniqueThreads/);
});

test('normalizes sources to serializable data only', () => {
  const result = validateDailyTasks({
    date: '2026-09-16',
    tasks: [],
    sources: {
      ...verifiedSources(),
      gmail: { ok: true, checkedThreads: 18, uniqueThreads: 18, ignored: () => 'not JSON' },
      calendar: { ok: true },
      omitted: undefined
    }
  }, '2026-09-16');

  assert.deepEqual(result.sources, {
    gmail: { ok: true, checkedThreads: 18, uniqueThreads: 18 },
    notion: { ok: true },
    calendar: { ok: true }
  });
});

for (const source of ['calendar', 'notion', 'gmail']) {
  for (const ok of [false, undefined, 'true']) {
    test(`rejects unverified ${source} source: ${String(ok)}`, () => {
      const sources = verifiedSources();
      sources[source].ok = ok;
      assert.throws(() => validateDailyTasks({ date: '2026-09-16', tasks: [], sources }, '2026-09-16'), new RegExp(source));
    });
  }
}

for (const gmail of [{ ok: true }, { ok: true, uniqueThreads: 1 }, { ok: true, checkedThreads: 1 },
  { ok: true, checkedThreads: 17, uniqueThreads: 18 }, { ok: true, checkedThreads: 19, uniqueThreads: 18 }]) {
  test(`rejects incomplete Gmail verification ${JSON.stringify(gmail)}`, () => {
    assert.throws(() => validateDailyTasks({ date: '2026-09-16', tasks: [],
      sources: { ...verifiedSources(), gmail } }, '2026-09-16'), /Gmail/);
  });
}

test('normal validation rejects absent sources even with no tasks', () => {
  assert.throws(() => validateDailyTasks({ date: '2026-09-16', tasks: [] }, '2026-09-16'), /sources/);
});

test('keeps a supplied owner and rejects an unusable one', () => {
  const base = { sources: verifiedSources(), date: '2026-09-16', tasks: [{ id: 'a', type: 'gmail', title: 't', owner: 'お笑いマサ' }] };
  assert.equal(validateDailyTasks(base, '2026-09-16').tasks[0].owner, 'お笑いマサ');
  for (const owner of ['', 'あ'.repeat(41)]) {
    assert.throws(() => validateDailyTasks({ ...base, tasks: [{ id: 'a', type: 'gmail', title: 't', owner }] }, '2026-09-16'), /owner/);
  }
});
