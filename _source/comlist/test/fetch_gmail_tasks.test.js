'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  listAllThreadIds,
  fetchVerifiedGmailTasks,
  mergeGmailTasks,
  writeJsonAtomic,
  loadOAuthFiles,
  createAuthorizedGmail,
  runCli,
  resolveTasksPath,
  GMAIL_SCOPE,
} = require('../fetch_gmail_tasks');

function encodeBase64Url(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function gmailMessage(body, internalDate = 100, subject = '件名') {
  return {
    internalDate: String(internalDate),
    payload: {
      mimeType: 'text/plain',
      body: { data: encodeBase64Url(body) },
      headers: [
        { name: 'Subject', value: subject },
        { name: 'To', value: 'cuc.member@example.com' },
      ],
    },
  };
}

function gmailThread(id, body = '【継続】09/18 つなこ', subject = id) {
  return {
    id,
    messages: [gmailMessage(body, 100, subject)],
  };
}

function fakeGmail({ list, threads = {}, getErrorFor, attachments = {} } = {}) {
  const listCalls = [];
  const getCalls = [];
  const attachmentCalls = [];
  const gmail = {
    users: {
      threads: {
        list: async params => {
          listCalls.push(params);
          return list(params);
        },
        get: async params => {
          getCalls.push(params);
          const error = getErrorFor?.(params);
          if (error) throw error;
          return { data: threads[params.id] };
        },
      },
      messages: {
        attachments: {
          get: async params => {
            attachmentCalls.push(params);
            return { data: attachments[`${params.messageId}/${params.id}`] || attachments[params.id] || {} };
          },
        },
      },
    },
  };

  return { gmail, listCalls, getCalls, attachmentCalls };
}

function verifiedSources() {
  return {
    calendar: { ok: true },
    notion: { ok: true },
    gmail: { ok: true, checkedThreads: 1, uniqueThreads: 1 },
  };
}

function mergeFixture() {
  return {
    date: '2026-09-20',
    dayLabel: '2026年9月20日（日）',
    hp: 80,
    quote: { text: '格言', source: '出典' },
    comment: 'コメント',
    calendar: [{ start: '2026-09-20T09:00', title: '予定' }],
    tasks: [
      { id: 'notion:1', type: 'notion', title: '資料', section: 'today', overdueDays: 0 },
      { id: 'calendar:1', type: 'calendar', title: '面談', section: 'upcoming', overdueDays: 0 },
      { id: 'gmail:old', type: 'gmail', title: '古い', section: 'today', overdueDays: 0 },
    ],
    sources: verifiedSources(),
  };
}

test('Gmailタスクだけを置き換え、非Gmailタスクとトップレベル項目を保持する', () => {
  const result = mergeGmailTasks(mergeFixture(), {
    tasks: [{ id: 'gmail:new', type: 'gmail', title: '新しい', section: 'today', overdueDays: 0 }],
    checkedThreads: 3,
    uniqueThreads: 3,
  }, '2026-09-20');

  assert.deepEqual(result.tasks.map(task => task.id), ['notion:1', 'calendar:1', 'gmail:new']);
  assert.deepEqual(result.sources.gmail, { ok: true, checkedThreads: 3, uniqueThreads: 3 });
  assert.deepEqual(result.sources.calendar, { ok: true });
  assert.deepEqual(result.sources.notion, { ok: true });
  assert.equal(result.dayLabel, '2026年9月20日（日）');
  assert.deepEqual(result.calendar, [{ start: '2026-09-20T09:00', title: '予定' }]);
  assert.deepEqual(result.quote, { text: '格言', source: '出典' });
  assert.equal(result.comment, 'コメント');
  assert.deepEqual(result.hp, { selfOverdue: 0, memberOverdue: 0 });
});

test('Gmail統合後に既存タスクを含めてHP集計を再計算する', () => {
  const result = mergeGmailTasks(mergeFixture(), {
    tasks: [
      { id: 'gmail:self', type: 'gmail', title: '自分', section: 'selfOverdue', overdueDays: 1 },
      { id: 'gmail:member', type: 'gmail', title: '会員', section: 'memberOverdue', overdueDays: 2 },
      { id: 'gmail:today', type: 'gmail', title: '今日', section: 'today', overdueDays: 0 },
      { id: 'gmail:future', type: 'gmail', title: '未来', section: 'upcoming', overdueDays: 0 },
    ],
    checkedThreads: 4,
    uniqueThreads: 4,
  }, '2026-09-20');

  assert.deepEqual(result.hp, { selfOverdue: 1, memberOverdue: 1 });
  assert.equal(result.hpNote, '自分の期限切れ 1件 ×-10 ／ メンバー切れ 1件 ×-5 ／ 毎朝100にリセット');
});

test('tasks保存先は指定した作業用ディレクトリの内側に限定する', () => {
  const root = path.join(os.tmpdir(), 'gmail-task-root');
  assert.equal(resolveTasksPath(path.join(root, 'daily_tasks.json'), root), path.join(root, 'daily_tasks.json'));
  assert.throws(() => resolveTasksPath(path.join(root, '..', 'outside.json'), root), /_work|inside|保存先/i);
});

test('統合関数は入力オブジェクトを変更しない', () => {
  const input = mergeFixture();
  const before = structuredClone(input);

  mergeGmailTasks(input, {
    tasks: [{ id: 'gmail:new', type: 'gmail', title: '新しい', section: 'today', overdueDays: 0 }],
    checkedThreads: 3,
    uniqueThreads: 3,
  }, '2026-09-20');

  assert.deepEqual(input, before);
});

test('入力tasksが配列でなければ置き換えずに拒否する', () => {
  const input = { ...mergeFixture(), tasks: { corrupted: true } };
  const before = structuredClone(input);

  assert.throws(
    () => mergeGmailTasks(input, {
      tasks: [{ id: 'gmail:new', type: 'gmail', title: '新しい', section: 'today', overdueDays: 0 }],
      checkedThreads: 1,
      uniqueThreads: 1,
    }, '2026-09-20'),
    /tasks.*array/i,
  );
  assert.deepEqual(input, before);
});

test('統合後の不正なタスクは書き込み前に拒否する', () => {
  assert.throws(
    () => mergeGmailTasks(mergeFixture(), {
      tasks: [{ id: 'gmail:bad', type: 'gmail', title: '不正', section: 'unknown', overdueDays: 0 }],
      checkedThreads: 3,
      uniqueThreads: 3,
    }, '2026-09-20'),
    /section/
  );
});

test('JSONを同一ディレクトリの一時ファイル経由で原子的に更新する', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-atomic-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const target = path.join(tempDir, 'daily_tasks.json');

  await writeJsonAtomic(target, { title: '日本語', count: 2 });

  const text = fs.readFileSync(target, 'utf8');
  assert.deepEqual(JSON.parse(text), { title: '日本語', count: 2 });
  assert.match(text, /\n  "title":/);
  assert.deepEqual(fs.readdirSync(tempDir), ['daily_tasks.json']);
});

test('rename失敗時は元ファイルを保持し一時ファイルを残さない', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-atomic-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const target = path.join(tempDir, 'daily_tasks.json');
  fs.writeFileSync(target, 'previous\n', 'utf8');
  const realPromises = fs.promises;
  const failingFs = {
    promises: {
      open: (...args) => realPromises.open(...args),
      rename: async () => { throw new Error('rename failed'); },
      unlink: (...args) => realPromises.unlink(...args),
    },
  };

  await assert.rejects(
    () => writeJsonAtomic(target, { title: 'new' }, failingFs),
    /rename failed/
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'previous\n');
  assert.deepEqual(fs.readdirSync(tempDir), ['daily_tasks.json']);
});

test('不足または不正なOAuthファイルは秘密値を含まない安全なエラーにする', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-oauth-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const clientPath = path.join(tempDir, 'client.json');
  const tokenPath = path.join(tempDir, 'token.json');
  const secret = 'client-secret-value';

  await assert.rejects(
    () => loadOAuthFiles({ clientPath, tokenPath, fsApi: fs }),
    error => {
      assert.match(error.message, /client\.json/);
      assert.match(error.message, /保存|設定|配置|OAuth/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    }
  );

  fs.writeFileSync(clientPath, JSON.stringify({ installed: { client_id: 'client-id', client_secret: secret } }));
  fs.writeFileSync(tokenPath, '{"refresh_token":"refresh-secret"');
  await assert.rejects(
    () => loadOAuthFiles({ clientPath, tokenPath, fsApi: fs }),
    error => {
      assert.match(error.message, /token\.json/);
      assert.doesNotMatch(error.message, /refresh-secret/);
      return true;
    }
  );
});

test('通常ロードはアクセストークンもリフレッシュトークンもないJSONを拒否する', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-oauth-empty-token-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const clientPath = path.join(tempDir, 'client.json');
  const tokenPath = path.join(tempDir, 'token.json');
  fs.writeFileSync(clientPath, JSON.stringify({ installed: {
    client_id: 'client-id',
    client_secret: 'client-secret',
  } }));
  for (const token of [{}, { access_token: '' }, { refresh_token: '   ' }]) {
    fs.writeFileSync(tokenPath, JSON.stringify(token));
    await assert.rejects(
      () => loadOAuthFiles({ clientPath, tokenPath, fsApi: fs }),
      error => {
        assert.match(error.message, /token\.json/);
        assert.doesNotMatch(error.message, /client-secret/);
        return true;
      },
    );
  }
});

test('通常ロードの明示scopeは文字列と配列のreadonly単独だけを許可する', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-oauth-scope-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const clientPath = path.join(tempDir, 'client.json');
  const tokenPath = path.join(tempDir, 'token.json');
  fs.writeFileSync(clientPath, JSON.stringify({ installed: {
    client_id: 'client-id',
    client_secret: 'client-secret',
  } }));

  for (const token of [
    { access_token: 'access-secret', scope: GMAIL_SCOPE },
    { refresh_token: 'refresh-secret', scope: [GMAIL_SCOPE] },
  ]) {
    fs.writeFileSync(tokenPath, JSON.stringify(token));
    const loaded = await loadOAuthFiles({ clientPath, tokenPath, fsApi: fs });
    assert.deepEqual(loaded.token, token);
  }

  for (const token of [
    { access_token: 'access-secret', scope: `${GMAIL_SCOPE} https://mail.google.com/` },
    { refresh_token: 'refresh-secret', scope: [GMAIL_SCOPE, 'https://mail.google.com/'] },
    { access_token: 'access-secret', scope: [] },
    { access_token: 'access-secret', scope: '   ' },
  ]) {
    fs.writeFileSync(tokenPath, JSON.stringify(token));
    await assert.rejects(
      () => loadOAuthFiles({ clientPath, tokenPath, fsApi: fs }),
      /OAuthトークンファイル/,
    );
  }
});

test('OAuth2にクライアント情報とトークン資格情報を渡しGmailクライアントを作る', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-oauth-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const clientPath = path.join(tempDir, 'client.json');
  const tokenPath = path.join(tempDir, 'token.json');
  const token = { refresh_token: 'refresh-secret', expiry_date: 123 };
  fs.writeFileSync(clientPath, JSON.stringify({ web: {
    client_id: 'client-id',
    client_secret: 'client-secret',
  } }));
  fs.writeFileSync(tokenPath, JSON.stringify(token));

  const calls = {};
  class FakeOAuth2 {
    constructor(...args) { calls.constructor = args; }
    setCredentials(value) { calls.credentials = value; }
  }
  const gmailResult = { kind: 'gmail' };
  const googleApi = {
    auth: { OAuth2: FakeOAuth2 },
    gmail(options) {
      calls.gmail = options;
      return gmailResult;
    },
  };

  const result = await createAuthorizedGmail({ clientPath, tokenPath, fsApi: fs, googleApi });

  assert.equal(result, gmailResult);
  assert.deepEqual(calls.constructor, ['client-id', 'client-secret', undefined]);
  assert.deepEqual(calls.credentials, token);
  assert.equal(calls.gmail.version, 'v1');
  assert.ok(calls.gmail.auth instanceof FakeOAuth2);
});

class FakeAuthServer extends EventEmitter {
  constructor(handler) {
    super();
    this.handler = handler;
    this.listening = false;
    this.closed = false;
  }

  listen(_port, _host, callback) {
    this.listening = true;
    this.port = 43123;
    callback();
    return this;
  }

  address() {
    return { address: '127.0.0.1', family: 'IPv4', port: this.port };
  }

  close(callback) {
    this.closed = true;
    this.listening = false;
    callback?.();
    return this;
  }

  async request(url) {
    const response = { statusCode: 200, body: '', end: value => { response.body = value || ''; } };
    await this.handler({ url }, response);
    return response;
  }
}

function oauthFixture(tempDir) {
  const clientPath = path.join(tempDir, 'client.json');
  const tokenPath = path.join(tempDir, 'token.json');
  fs.writeFileSync(clientPath, JSON.stringify({ installed: {
    client_id: 'client-id',
    client_secret: 'client-secret-should-not-print',
  } }));
  return { clientPath, tokenPath };
}

test('--auth-onlyは認可URLの条件を守り、トークンを秘密のまま原子的に保存する', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-auth-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const { clientPath, tokenPath } = oauthFixture(tempDir);
  const calls = {};
  let server;

  class FakeOAuth2 {
    constructor(...args) { calls.constructor = args; }
    generateAuthUrl(options) {
      calls.authUrl = options;
      return `https://accounts.example/authorize?state=${encodeURIComponent(options.state)}&client_secret=must-not-print`;
    }
    async getToken(code) {
      calls.code = code;
      return { tokens: { access_token: 'access-secret', refresh_token: 'refresh-secret' } };
    }
    setCredentials(value) { calls.credentials = value; }
  }
  const googleApi = { auth: { OAuth2: FakeOAuth2 } };
  const output = [];
  const result = await runCli(['--auth-only'], {
    fsApi: fs,
    clientPath,
    tokenPath,
    googleApi,
    serverFactory: handler => { server = new FakeAuthServer(handler); return server; },
    launcher: async url => {
      calls.launchedUrl = url;
      const state = new URL(url).searchParams.get('state');
      await server.request(`/oauth2callback?state=${encodeURIComponent(state)}&code=authorization-code-secret`);
    },
    writeJsonAtomic: (filePath, value, fsApi) => writeJsonAtomic(filePath, value, fsApi),
    log: line => output.push(line),
    error: line => output.push(line),
    timeoutMs: 100,
  });

  assert.equal(result, 0);
  assert.equal(server.closed, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(tokenPath, 'utf8')), {
    access_token: 'access-secret', refresh_token: 'refresh-secret'
  });
  assert.deepEqual(calls.authUrl.scope, [GMAIL_SCOPE]);
  assert.equal(calls.authUrl.access_type, 'offline');
  assert.equal(calls.authUrl.prompt, 'consent');
  assert.equal(calls.authUrl.redirect_uri, calls.constructor[2]);
  assert.match(calls.constructor[2], /^http:\/\/127\.0\.0\.1:43123\/oauth2callback$/);
  assert.deepEqual(calls.credentials, { access_token: 'access-secret', refresh_token: 'refresh-secret' });
  assert.deepEqual(output, [`AUTH_RESULT: OK token=${tokenPath}`]);
  for (const secret of [
    'client-secret-should-not-print', 'access-secret', 'refresh-secret',
    'authorization-code-secret', 'accounts.example/authorize'
  ]) {
    assert.equal(output.join('\n').includes(secret), false, `output leaked ${secret}`);
  }
});

test('production launcherはrundll32へURLを引数で直接渡す', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-auth-launcher-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const { clientPath, tokenPath } = oauthFixture(tempDir);
  let server;
  let spawnCall;
  let unrefCalls = 0;
  const timerHandle = { id: 'launcher-timeout' };

  class FakeOAuth2 {
    generateAuthUrl(options) {
      return `https://accounts.example/authorize?state=${encodeURIComponent(options.state)}`;
    }
    async getToken() { return { tokens: { access_token: 'access-secret' } }; }
    setCredentials() {}
  }

  const status = await runCli(['--auth-only'], {
    fsApi: fs,
    clientPath,
    tokenPath,
    googleApi: { auth: { OAuth2: FakeOAuth2 } },
    serverFactory: handler => { server = new FakeAuthServer(handler); return server; },
    spawnApi: (executable, args, options) => {
      spawnCall = { executable, args, options };
      const state = new URL(args.at(-1)).searchParams.get('state');
      queueMicrotask(() => server.request(
        `/oauth2callback?state=${encodeURIComponent(state)}&code=code-secret`,
      ));
      return { unref: () => { unrefCalls += 1; } };
    },
    scheduleTimeout: () => timerHandle,
    cancelTimeout: () => {},
    writeJsonAtomic: async () => {},
    state: 'fixed-state',
    log: () => {},
    error: () => {},
  });

  assert.equal(status, 0);
  assert.equal(server.closed, true);
  assert.equal(unrefCalls, 1);
  assert.deepEqual(spawnCall, {
    executable: 'rundll32.exe',
    args: [
      'url.dll,FileProtocolHandler',
      'https://accounts.example/authorize?state=fixed-state',
    ],
    options: {
      shell: false,
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    },
  });
});

test('production launcherの非同期spawn errorはURLを出さず固定エラーで終了する', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-auth-launcher-error-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const { clientPath, tokenPath } = oauthFixture(tempDir);
  let server;
  const output = [];
  const secretUrl = 'https://accounts.example/authorize?state=secret-state&code=never-print';

  class FakeOAuth2 {
    generateAuthUrl() { return secretUrl; }
  }
  const status = await runCli(['--auth-only'], {
    fsApi: fs,
    clientPath,
    tokenPath,
    googleApi: { auth: { OAuth2: FakeOAuth2 } },
    serverFactory: handler => { server = new FakeAuthServer(handler); return server; },
    spawnApi: () => {
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit('error', new Error(secretUrl)));
      return child;
    },
    log: line => output.push(line),
    error: line => output.push(line),
    timeoutMs: 100,
  });

  assert.equal(status, 1);
  assert.equal(server.closed, true);
  assert.deepEqual(output, ['AUTH_RESULT: ERROR type=oauth-browser OAuth authorization browser launch failed']);
  assert.equal(output.join('\n').includes(secretUrl), false);
});

test('--auth-onlyは空tokenで既存トークンファイルを上書きしない', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-auth-empty-token-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const { clientPath, tokenPath } = oauthFixture(tempDir);
  const original = '{"refresh_token":"existing-secret"}\n';
  fs.writeFileSync(tokenPath, original, 'utf8');
  let server;
  let credentialsWereSet = false;
  const output = [];

  class FakeOAuth2 {
    generateAuthUrl(options) {
      return `https://accounts.example/authorize?state=${encodeURIComponent(options.state)}`;
    }
    async getToken() { return { tokens: {} }; }
    setCredentials() { credentialsWereSet = true; }
  }

  const status = await runCli(['--auth-only'], {
    fsApi: fs,
    clientPath,
    tokenPath,
    googleApi: { auth: { OAuth2: FakeOAuth2 } },
    serverFactory: handler => { server = new FakeAuthServer(handler); return server; },
    launcher: async url => {
      const state = new URL(url).searchParams.get('state');
      await server.request(`/oauth2callback?state=${encodeURIComponent(state)}&code=code-secret`);
    },
    log: line => output.push(line),
    error: line => output.push(line),
    timeoutMs: 100,
  });

  assert.equal(status, 1);
  assert.equal(credentialsWereSet, false);
  assert.equal(server.closed, true);
  assert.equal(fs.readFileSync(tokenPath, 'utf8'), original);
  assert.deepEqual(output, ['AUTH_RESULT: ERROR type=oauth-exchange OAuth token exchange returned no token']);
});

async function runAuthFailure(t, mode) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `gmail-auth-${mode}-`));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const { clientPath, tokenPath } = oauthFixture(tempDir);
  let server;
  let tokenCalls = 0;
  class FakeOAuth2 {
    generateAuthUrl(options) {
      return `https://accounts.example/authorize?state=${encodeURIComponent(options.state)}`;
    }
    async getToken() {
      tokenCalls += 1;
      if (mode === 'exchange') throw new Error('exchange failed with refresh-secret');
      if (mode === 'scope') {
        return { tokens: {
          access_token: 'access-secret',
          scope: [GMAIL_SCOPE, 'https://mail.google.com/'],
        } };
      }
      return { tokens: { refresh_token: 'should-not-be-written' } };
    }
    setCredentials() {}
  }
  const output = [];
  const status = await runCli(['--auth-only'], {
    fsApi: fs,
    clientPath,
    tokenPath,
    googleApi: { auth: { OAuth2: FakeOAuth2 } },
    serverFactory: handler => { server = new FakeAuthServer(handler); return server; },
    launcher: async url => {
      const state = new URL(url).searchParams.get('state');
      if (mode === 'oauth-error') {
        await server.request(`/oauth2callback?state=${encodeURIComponent(state)}&error=access_denied`);
        return;
      }
      if (mode === 'missing-code') {
        await server.request(`/oauth2callback?state=${encodeURIComponent(state)}`);
        return;
      }
      const callbackState = mode === 'mismatch' ? 'wrong-state' : state;
      await server.request(`/oauth2callback?state=${encodeURIComponent(callbackState)}&code=code-secret`);
    },
    log: line => output.push(line),
    error: line => output.push(line),
    timeoutMs: 100,
  });

  return { status, server, tokenPath, output, tokenCalls };
}

test('認可コールバックのstate不一致ではサーバーを閉じトークンを作らない', async t => {
  const result = await runAuthFailure(t, 'mismatch');

  assert.equal(result.status, 1);
  assert.equal(result.server.closed, true);
  assert.equal(fs.existsSync(result.tokenPath), false);
  assert.equal(result.output.join('\n').includes('wrong-state'), false);
});

test('認可コールバックのOAuth errorではサーバーを閉じトークンを作らない', async t => {
  const result = await runAuthFailure(t, 'oauth-error');

  assert.equal(result.status, 1);
  assert.equal(result.tokenCalls, 0);
  assert.equal(result.server.closed, true);
  assert.equal(fs.existsSync(result.tokenPath), false);
  assert.deepEqual(result.output, ['AUTH_RESULT: ERROR type=oauth-denied OAuth authorization was denied']);
});

test('認可コールバックのcode欠落ではサーバーを閉じトークンを作らない', async t => {
  const result = await runAuthFailure(t, 'missing-code');

  assert.equal(result.status, 1);
  assert.equal(result.tokenCalls, 0);
  assert.equal(result.server.closed, true);
  assert.equal(fs.existsSync(result.tokenPath), false);
  assert.deepEqual(result.output, ['AUTH_RESULT: ERROR type=oauth-callback OAuth authorization code was missing']);
});

test('トークン交換失敗ではサーバーを閉じトークンを作らない', async t => {
  const result = await runAuthFailure(t, 'exchange');

  assert.equal(result.status, 1);
  assert.equal(result.tokenCalls, 1);
  assert.equal(result.server.closed, true);
  assert.equal(fs.existsSync(result.tokenPath), false);
  assert.equal(result.output.join('\n').includes('refresh-secret'), false);
});

test('--auth-onlyはreadonly以外のscopeを含むtokenを保存しない', async t => {
  const result = await runAuthFailure(t, 'scope');

  assert.equal(result.status, 1);
  assert.equal(result.tokenCalls, 1);
  assert.equal(result.server.closed, true);
  assert.equal(fs.existsSync(result.tokenPath), false);
  assert.equal(result.output.join('\n').includes('access-secret'), false);
});

test('認可タイムアウトは実時間を待たずにサーバーを閉じトークンを作らない', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-auth-timeout-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const { clientPath, tokenPath } = oauthFixture(tempDir);
  let server;
  let fireTimeout;
  let scheduledDelay;
  const timerHandle = { id: 'oauth-timeout' };
  const cancelled = [];
  const output = [];

  class FakeOAuth2 {
    generateAuthUrl() { return 'https://accounts.example/authorize'; }
  }

  const status = await runCli(['--auth-only'], {
    fsApi: fs,
    clientPath,
    tokenPath,
    googleApi: { auth: { OAuth2: FakeOAuth2 } },
    serverFactory: handler => { server = new FakeAuthServer(handler); return server; },
    scheduleTimeout: (callback, delay) => {
      fireTimeout = callback;
      scheduledDelay = delay;
      return timerHandle;
    },
    cancelTimeout: handle => cancelled.push(handle),
    launcher: async () => fireTimeout(),
    log: line => output.push(line),
    error: line => output.push(line),
    timeoutMs: 5000,
  });

  assert.equal(status, 1);
  assert.equal(scheduledDelay, 5000);
  assert.deepEqual(cancelled, [timerHandle]);
  assert.equal(server.closed, true);
  assert.equal(fs.existsSync(tokenPath), false);
  assert.deepEqual(output, ['AUTH_RESULT: ERROR type=oauth-timeout OAuth authorization timed out']);
});

test('通常CLIは取得、統合、書き込みの順に実行し分類件数を秘密なしでログに出す', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-cli-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const tasksPath = path.join(tempDir, 'daily_tasks.json');
  fs.writeFileSync(tasksPath, JSON.stringify(mergeFixture()), 'utf8');
  const order = [];
  const output = [];
  const gmailResult = {
    tasks: [
      { id: 'gmail:new-1', type: 'gmail', title: '新1', section: 'today', overdueDays: 0 },
      { id: 'gmail:new-2', type: 'gmail', title: '新2', section: 'upcoming', overdueDays: 0 },
    ],
    checkedThreads: 4,
    uniqueThreads: 4,
  };

  const status = await runCli(['--today', '2026-09-20', '--tasks', tasksPath], {
    fsApi: fs,
    tasksRoot: tempDir,
    createAuthorizedGmail: async () => { order.push('create'); return { fake: 'gmail' }; },
    fetchVerifiedGmailTasks: async (gmail, today) => {
      order.push('fetch');
      assert.deepEqual(gmail, { fake: 'gmail' });
      assert.equal(today, '2026-09-20');
      return gmailResult;
    },
    mergeGmailTasks: (input, result, today) => {
      order.push('merge');
      assert.equal(input.date, '2026-09-20');
      assert.equal(result, gmailResult);
      assert.equal(today, '2026-09-20');
      return { ...input, tasks: result.tasks };
    },
    writeJsonAtomic: async (filePath, value) => {
      order.push('write');
      assert.equal(filePath, tasksPath);
      assert.deepEqual(value.tasks.map(task => task.id), ['gmail:new-1', 'gmail:new-2']);
    },
    log: line => output.push(line),
    error: line => output.push(line),
  });

  assert.equal(status, 0);
  assert.deepEqual(order, ['create', 'fetch', 'merge', 'write']);
  assert.deepEqual(output, ['GMAIL_RESULT: OK unique=4 checked=4 overdue=0 today=1 upcoming=1 tasks=2']);
});

test('統合検証に失敗した場合は元JSONを変更せず書き込みを行わない', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-cli-invalid-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const tasksPath = path.join(tempDir, 'daily_tasks.json');
  const original = JSON.stringify(mergeFixture(), null, 2);
  fs.writeFileSync(tasksPath, original, 'utf8');
  let writes = 0;

  const status = await runCli(['--today', '2026-09-20', '--tasks', tasksPath], {
    fsApi: fs,
    tasksRoot: tempDir,
    createAuthorizedGmail: async () => ({}),
    fetchVerifiedGmailTasks: async () => ({ tasks: [], checkedThreads: 0, uniqueThreads: 0 }),
    mergeGmailTasks: () => { throw new Error('invalid merged result'); },
    writeJsonAtomic: async () => { writes += 1; },
    log: () => {},
    error: () => {},
  });

  assert.equal(status, 1);
  assert.equal(writes, 0);
  assert.equal(fs.readFileSync(tasksPath, 'utf8'), original);
});

test('統合関数が不正な結果を返した場合も書き込み前に検証する', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-cli-invalid-return-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const tasksPath = path.join(tempDir, 'daily_tasks.json');
  const original = JSON.stringify(mergeFixture(), null, 2);
  fs.writeFileSync(tasksPath, original, 'utf8');
  let writes = 0;

  const status = await runCli(['--today', '2026-09-20', '--tasks', tasksPath], {
    fsApi: fs,
    tasksRoot: tempDir,
    createAuthorizedGmail: async () => ({}),
    fetchVerifiedGmailTasks: async () => ({ tasks: [], checkedThreads: 0, uniqueThreads: 0 }),
    mergeGmailTasks: input => ({
      ...input,
      tasks: [{ id: 'gmail:bad', type: 'gmail', title: '不正', section: 'invalid', overdueDays: 0 }],
    }),
    writeJsonAtomic: async () => { writes += 1; },
    log: () => {},
    error: () => {},
  });

  assert.equal(status, 1);
  assert.equal(writes, 0);
  assert.equal(fs.readFileSync(tasksPath, 'utf8'), original);
});

test('未知flagと不正日付は外部処理を始める前に拒否する', async () => {
  for (const fixture of [
    {
      argv: ['--unknown'],
      expected: 'GMAIL_RESULT: ERROR type=cli unknown CLI argument',
    },
    {
      argv: ['--today', '2026-02-30', '--tasks', 'unused.json'],
      expected: 'GMAIL_RESULT: ERROR type=cli --today must be a valid YYYY-MM-DD date',
    },
  ]) {
    const output = [];
    const status = await runCli(fixture.argv, {
      log: line => output.push(line),
      error: line => output.push(line),
    });

    assert.equal(status, 1);
    assert.deepEqual(output, [fixture.expected]);
  }
});

test('tasksが_work外ならOAuthやファイル書き込みを始めず拒否する', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-cli-outside-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const tasksPath = path.join(tempDir, 'daily_tasks.json');
  fs.writeFileSync(tasksPath, JSON.stringify(mergeFixture()), 'utf8');
  const output = [];
  let created = false;

  const status = await runCli(['--today', '2026-09-20', '--tasks', tasksPath], {
    createAuthorizedGmail: async () => { created = true; return {}; },
    log: line => output.push(line),
    error: line => output.push(line),
  });

  assert.equal(status, 1);
  assert.equal(created, false);
  assert.deepEqual(output, ['GMAIL_RESULT: ERROR type=input tasks保存先は_work内に限定されています']);
});

test('モジュールのimportだけではI/Oやサーバー待機を始めない', () => {
  const modulePath = path.resolve(__dirname, '..', 'fetch_gmail_tasks.js');
  const child = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(modulePath)})`],
    { encoding: 'utf8', timeout: 1000 },
  );

  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, '');
});

test('2検索の全ページを読み、thread IDを初出順で重複排除して全件取得する', async () => {
  const pages = {
    'りゅうちゃん in:inbox': [
      { data: { threads: [{ id: 'a' }], nextPageToken: 'page-2' } },
      { data: { threads: [{ id: 'b' }] } },
    ],
    'label:"◆自分タスク"': [
      { data: { threads: [{ id: 'b' }, { id: 'c' }] } },
    ],
  };
  const pageIndexes = new Map();
  const { gmail, listCalls, getCalls } = fakeGmail({
    list: async params => {
      const index = pageIndexes.get(params.q) || 0;
      pageIndexes.set(params.q, index + 1);
      return pages[params.q][index];
    },
    threads: {
      a: gmailThread('a'),
      b: gmailThread('b'),
      c: gmailThread('c'),
    },
  });

  const result = await fetchVerifiedGmailTasks(gmail, '2026-09-20');

  assert.equal(result.uniqueThreads, 3);
  assert.equal(result.checkedThreads, 3);
  assert.equal(result.tasks.length, 3);
  assert.deepEqual(getCalls, [
    { userId: 'me', format: 'full', id: 'a' },
    { userId: 'me', format: 'full', id: 'b' },
    { userId: 'me', format: 'full', id: 'c' },
  ]);
  assert.deepEqual(listCalls, [
    { userId: 'me', maxResults: 100, q: 'りゅうちゃん in:inbox' },
    { userId: 'me', maxResults: 100, q: 'りゅうちゃん in:inbox', pageToken: 'page-2' },
    { userId: 'me', maxResults: 100, q: 'label:"◆自分タスク"' },
  ]);
});

test('検索ページの失敗は結果を返さずにrejectする', async () => {
  const expectedError = new Error('search page failed');
  const { gmail } = fakeGmail({
    list: async () => { throw expectedError; },
  });

  await assert.rejects(
    () => listAllThreadIds(gmail, ['りゅうちゃん in:inbox']),
    error => error === expectedError,
  );
});

test('thread取得の失敗は成功件数を返さずにrejectする', async () => {
  const expectedError = new Error('thread get failed');
  const { gmail, getCalls } = fakeGmail({
    list: async () => ({ data: { threads: [{ id: 'a' }, { id: 'b' }] } }),
    threads: { a: gmailThread('a'), b: gmailThread('b') },
    getErrorFor: params => params.id === 'b' ? expectedError : null,
  });

  await assert.rejects(
    () => fetchVerifiedGmailTasks(gmail, '2026-09-20'),
    error => error.failureType === 'api-thread',
  );
  assert.deepEqual(getCalls.map(call => call.id), ['a', 'b']);
});

test('空の検索結果はタスクと件数を0で返す', async () => {
  const { gmail, getCalls } = fakeGmail({
    list: async () => ({ data: { threads: [] } }),
  });

  const result = await fetchVerifiedGmailTasks(gmail, '2026-09-20');

  assert.deepEqual(result, {
    tasks: [],
    checkedThreads: 0,
    uniqueThreads: 0,
    counts: { overdue: 0, today: 0, upcoming: 0 },
  });
  assert.deepEqual(getCalls, []);
});

test('本文attachmentIdはattachments.getで復元し、添付ファイル本文は解析しない', async () => {
  const body = '【継続】09/19 つなこ';
  const { gmail, attachmentCalls } = fakeGmail({
    list: async () => ({ data: { threads: [{ id: 'attachment-thread' }] } }),
    threads: {
      'attachment-thread': {
        id: 'attachment-thread',
        messages: [{
          id: 'message-1',
          internalDate: '100',
          payload: {
            mimeType: 'multipart/mixed',
            parts: [
              { mimeType: 'text/plain', body: { attachmentId: 'body-1', size: body.length } },
              { mimeType: 'text/plain', filename: 'old.txt', body: { data: encodeBase64Url('【継続】09/01 ノスタ') } },
            ],
            headers: [{ name: 'Subject', value: '添付本文' }, { name: 'To', value: 'cuc.member@example.com' }],
          },
        }],
      },
    },
    attachments: { 'message-1/body-1': { data: encodeBase64Url(body) } },
  });

  const result = await fetchVerifiedGmailTasks(gmail, '2026-09-20');

  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].due, '2026-09-19');
  assert.deepEqual(attachmentCalls, [{ userId: 'me', messageId: 'message-1', id: 'body-1' }]);
});

test('本文attachmentIdを復元できなければ結果を返さず停止する', async () => {
  const { gmail } = fakeGmail({
    list: async () => ({ data: { threads: [{ id: 'unrestorable' }] } }),
    threads: {
      unrestorable: {
        id: 'unrestorable',
        messages: [{
          id: 'message-2',
          internalDate: '100',
          payload: { mimeType: 'text/plain', body: { attachmentId: 'missing', size: 10 }, headers: [] },
        }],
      },
    },
  });

  await assert.rejects(
    () => fetchVerifiedGmailTasks(gmail, '2026-09-20'),
    error => error.failureType === 'body-unavailable',
  );
});

test('検索スニペットではなく完全取得した最新メッセージで分類する', async () => {
  const { gmail } = fakeGmail({
    list: async () => ({
      data: {
        threads: [{ id: 'latest-diff', snippet: '【継続】09/18 つなこ' }],
      },
    }),
    threads: {
      'latest-diff': gmailThread('latest-diff', '【継続】09/20 つなこ'),
    },
  });

  const result = await fetchVerifiedGmailTasks(gmail, '2026-09-20');

  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].section, 'today');
  assert.equal(result.tasks[0].due, '2026-09-20');
});
