const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decodeBase64Url,
  extractMessageText,
  firstActionLines,
  parseContinuationLine,
  threadToTasks,
} = require('../gmail_tasks');

function encodeBase64Url(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

test('復号し、入れ子のmultipartからtext/plainを優先して冒頭3行を抽出する', () => {
  const plainText = '【継続】09/19 23:00 つなこ\n\n補足\n3行目\n4行目\n---\n引用';
  const payload = {
    mimeType: 'multipart/mixed',
    parts: [
      {
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/html',
            body: { data: encodeBase64Url('<p>HTML版</p>') },
          },
          {
            mimeType: 'text/plain',
            body: { data: encodeBase64Url(plainText) },
          },
        ],
      },
    ],
  };

  assert.equal(decodeBase64Url(encodeBase64Url('日本語')), '日本語');
  const text = extractMessageText(payload);

  assert.equal(text, plainText);
  assert.deepEqual(firstActionLines(text), [
    '【継続】09/19 23:00 つなこ',
    '補足',
    '3行目',
  ]);
});

test('text/plainがないときはtext/htmlのタグを外した本文を返す', () => {
  const payload = {
    mimeType: 'text/html',
    body: { data: encodeBase64Url('<div>本文</div><br><strong>補足</strong>') },
  };

  assert.equal(extractMessageText(payload), '\n本文\n\n補足');
});

test('HTMLのブロック要素とbrを改行として保持する', () => {
  const payload = {
    mimeType: 'text/html',
    body: { data: encodeBase64Url('<div>前置き</div><div>【継続】09/19 つなこ</div><p>補足<br>次</p>') },
  };

  assert.deepEqual(firstActionLines(extractMessageText(payload)), [
    '前置き',
    '【継続】09/19 つなこ',
    '補足',
  ]);
});

test('添付ファイルと添付メールは本文候補から除外する', () => {
  const payload = {
    mimeType: 'multipart/mixed',
    parts: [
      { mimeType: 'text/plain', body: { data: encodeBase64Url('本文') } },
      { mimeType: 'text/plain', filename: 'old.txt', body: { data: encodeBase64Url('【継続】09/18 つなこ') } },
      { mimeType: 'message/rfc822', body: { data: encodeBase64Url('【継続】09/17 つなこ') } },
      { mimeType: 'text/plain', headers: [{ name: 'Content-Disposition', value: 'attachment; filename="task.txt"' }], body: { data: encodeBase64Url('【継続】09/16 つなこ') } },
    ],
  };

  assert.equal(extractMessageText(payload), '本文');
});

test('復元不能な添付本文は正常な空本文と区別して停止する', () => {
  assert.throws(
    () => extractMessageText({ mimeType: 'text/plain', body: { attachmentId: 'attachment-1', size: 42 } }),
    /body.*unavailable/i,
  );
  assert.throws(
    () => extractMessageText({ mimeType: 'text/plain', body: { data: '', size: 42 } }),
    /body.*unavailable/i,
  );
  assert.equal(extractMessageText({ mimeType: 'text/plain', body: { size: 0 } }), '');
});

test('firstActionLinesは転送ヘッダーと引用区切り以降を除外する', () => {
  const text = '  1行目  \r\n> 引用\r\n\r\n2行目\r\n2026年9月20日 追記\r\n3行目';

  assert.deepEqual(firstActionLines(text), ['1行目', '2行目']);
  assert.deepEqual(firstActionLines('a\n b\n___\nc'), ['a', 'b']);
  assert.deepEqual(firstActionLines('a\nOn 2026/09/20\nb'), ['a']);
});

function message({ body, internalDate, subject = '件名', to = 'cuc.member@example.com' }) {
  return {
    internalDate: String(internalDate),
    payload: {
      mimeType: 'text/plain',
      body: { data: encodeBase64Url(body) },
      headers: [
        { name: 'Subject', value: subject },
        { name: 'To', value: to },
      ],
    },
  };
}

function thread({ id = 'thread-1', messages }) {
  return { id, messages };
}

test('過去の監視対象への継続をmemberOverdueとして分類する', () => {
  const parsed = parseContinuationLine('【継続】09/18 23:00 つなこ・ノスタ', '2026-09-20');

  assert.deepEqual(parsed, {
    due: '2026-09-18',
    dueDisplay: '09/18 23:00',
    section: 'memberOverdue',
    overdueDays: 2,
    owner: 'つなこ・ノスタ',
  });
});

test('りゅうちゃんの過去の継続をselfOverdueとして分類する', () => {
  const parsed = parseContinuationLine('【継続】09/19 りゅうちゃん', '2026-09-20');

  assert.equal(parsed.section, 'selfOverdue');
  assert.equal(parsed.overdueDays, 1);
  assert.equal(parsed.owner, 'りゅうちゃん');
});

test('今日と未来の継続はtodayとupcomingになりoverdueDaysは0になる', () => {
  const today = parseContinuationLine('【継続】09/20 つなこ', '2026-09-20');
  const upcoming = parseContinuationLine('【継続】09/21 つなこ', '2026-09-20');

  assert.equal(today.section, 'today');
  assert.equal(today.overdueDays, 0);
  assert.equal(upcoming.section, 'upcoming');
  assert.equal(upcoming.overdueDays, 0);
});

test('24:00は当日末として許可し24時台の他の時刻は拒否する', () => {
  const parsed = parseContinuationLine('【継続】09/20 24:00 つなこ', '2026-09-20');

  assert.equal(parsed.due, '2026-09-20');
  assert.equal(parsed.dueDisplay, '09/20 24:00');
  assert.throws(
    () => parseContinuationLine('【継続】09/20 24:01 つなこ', '2026-09-20'),
    /invalid continuation date or time/,
  );
});

test('監視対象外だけの過去の継続は無視する', () => {
  assert.equal(parseContinuationLine('【継続】09/19 ローランド', '2026-09-20'), null);
});

test('年またぎでは今日から最も近い有効な年を選ぶ', () => {
  assert.equal(parseContinuationLine('【継続】12/31 つなこ', '2027-01-02').due, '2026-12-31');
  assert.equal(parseContinuationLine('【継続】01/02 つなこ', '2026-12-31').due, '2027-01-02');
});

test('不正または存在しない日付はエラーにする', () => {
  assert.throws(() => parseContinuationLine('【継続】02/30 つなこ', '2026-03-01'), /date/);
  assert.throws(() => parseContinuationLine('【継続】09/xx つなこ', '2026-09-20'), /date/);
});

test('最新メッセージが完了でも会員宛でなければ直前の継続を期限切れとして残す', () => {
  const gmailThread = thread({
    messages: [
      message({ body: '【継続】09/19 つなこ', internalDate: 100 }),
      message({ body: '【完了】つなこ', internalDate: 200, to: 'member@example.com' }),
    ],
  });

  const tasks = threadToTasks(gmailThread, '2026-09-20');

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].due, '2026-09-19');
  assert.equal(tasks[0].section, 'memberOverdue');
});

test('最新メッセージが会員宛の完了なら継続タスクを返さない', () => {
  const gmailThread = thread({
    messages: [
      message({ body: '【継続】09/19 つなこ', internalDate: 100 }),
      message({ body: '【完了】つなこ', internalDate: 200 }),
    ],
  });

  assert.deepEqual(threadToTasks(gmailThread, '2026-09-20'), []);
});

test('最新メッセージの継続からGmailタスクを作る', () => {
  const gmailThread = thread({
    id: 'abc123',
    messages: [message({ body: '【継続】09/18 23:00 つなこ', internalDate: 100, subject: '古い件名' })],
  });

  assert.deepEqual(threadToTasks(gmailThread, '2026-09-20'), [{
    id: 'gmail:abc123:2026-09-18',
    type: 'gmail',
    title: '古い件名',
    detail: '期限 09/18 23:00・担当 つなこ',
    due: '2026-09-18',
    section: 'memberOverdue',
    overdueDays: 2,
    owner: 'つなこ',
    priority: null,
    url: 'https://mail.google.com/mail/u/0/#all/abc123',
  }]);
});

test('最新メッセージは配列順ではなくinternalDateの最大値で決める', () => {
  const gmailThread = thread({
    id: 'ordered-by-date',
    messages: [
      message({ body: '【完了】つなこ', internalDate: 300 }),
      message({ body: '【継続】09/18 つなこ', internalDate: 200 }),
    ],
  });

  assert.deepEqual(threadToTasks(gmailThread, '2026-09-20'), []);
});

test('完了だけの最新メッセージに以前の継続がなければタスクを作らない', () => {
  const gmailThread = thread({
    messages: [message({ body: '【完了】09/19 つなこ', internalDate: 100, to: 'member@example.com' })],
  });

  assert.deepEqual(threadToTasks(gmailThread, '2026-09-20'), []);
});

test('最新メッセージの2行目にある最初のaction行を継続として判定する', () => {
  const gmailThread = thread({
    id: 'action-on-second-line',
    messages: [message({ body: '前置き\n【継続】09/19 つなこ\n補足', internalDate: 100 })],
  });

  assert.equal(threadToTasks(gmailThread, '2026-09-20')[0].section, 'memberOverdue');
});

test('冒頭3行内の継続行をすべて処理し、先行する対象外行で落とさない', () => {
  const gmailThread = thread({
    id: 'multiple-actions',
    messages: [message({ body: 'ローランド\n【継続】09/19 つなこ\n【継続】09/21 ローランド', internalDate: 100 })],
  });

  assert.deepEqual(threadToTasks(gmailThread, '2026-09-20').map(task => [task.due, task.section, task.owner]), [
    ['2026-09-19', 'memberOverdue', 'つなこ'],
    ['2026-09-21', 'upcoming', 'ローランド'],
  ]);
});

test('同じ件名と期限の継続行を安定した1タスクへ統合する', () => {
  const gmailThread = thread({
    id: 'stable-task-id',
    messages: [message({ body: '【継続】09/19 つなこ\n【継続】09/19 ノスタ', internalDate: 100 })],
  });

  assert.deepEqual(threadToTasks(gmailThread, '2026-09-20'), [{
    id: 'gmail:stable-task-id:2026-09-19',
    type: 'gmail',
    title: '件名',
    detail: '期限 09/19・担当 つなこ・ノスタ',
    due: '2026-09-19',
    section: 'memberOverdue',
    overdueDays: 1,
    owner: 'つなこ・ノスタ',
    priority: null,
    url: 'https://mail.google.com/mail/u/0/#all/stable-task-id',
  }]);
});

test('group宛の完了判定でも過去の不正な継続日付を検証する', () => {
  const gmailThread = thread({
    messages: [
      message({ body: '【継続】02/30 つなこ', internalDate: 100 }),
      message({ body: '【完了】つなこ', internalDate: 200 }),
    ],
  });

  assert.throws(() => threadToTasks(gmailThread, '2026-09-20'), /date/);
});

test('有効な過去継続の後にある不正な継続日付も検証する', () => {
  const gmailThread = thread({
    messages: [
      message({ body: '【継続】09/19 つなこ', internalDate: 100 }),
      message({ body: '【継続】02/30 つなこ', internalDate: 150 }),
      message({ body: '【完了】つなこ', internalDate: 200 }),
    ],
  });

  assert.throws(() => threadToTasks(gmailThread, '2026-09-20'), /date/);
});

test('監視対象外の過去継続は非group宛の完了でもタスクにしない', () => {
  const gmailThread = thread({
    messages: [
      message({ body: '【継続】09/19 ローランド', internalDate: 100 }),
      message({ body: '【完了】ローランド', internalDate: 200, to: 'member@example.com' }),
    ],
  });

  assert.deepEqual(threadToTasks(gmailThread, '2026-09-20'), []);
});
