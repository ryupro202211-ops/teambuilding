const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { JSDOM } = require('jsdom');

async function decryptFromHtml(html, pass) {
  const match = html.match(/const ENC = (\{[\s\S]*?\});/);
  assert.ok(match, 'encrypted payload is embedded');
  const enc = JSON.parse(match[1]);
  const subtle = crypto.webcrypto.subtle;
  const keyMaterial = await subtle.importKey(
    'raw', Buffer.from(pass, 'utf8'), 'PBKDF2', false, ['deriveKey']
  );
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt: Buffer.from(enc.salt, 'base64'), iterations: enc.it, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const plaintext = await subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(enc.iv, 'base64') },
    key,
    Buffer.from(enc.ct, 'base64')
  );
  return JSON.parse(Buffer.from(plaintext).toString('utf8'));
}

function writeSnapshotProof(tempDir) {
  const files = {};
  for (const name of ['contacts', 'events', 'calendar']) {
    const file = path.join(tempDir, `${name}.json`);
    const bytes = fs.readFileSync(file);
    files[name] = {
      path: path.basename(file),
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    };
  }
  fs.writeFileSync(path.join(tempDir, 'snapshot_success.json'), JSON.stringify({
    version: 1, result: 'OK', source: 'snapshot', generatedAt: new Date().toISOString(), files
  }));
}

test('encrypts contacts and daily tasks together without leaking task text', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-integration-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const contactsPath = path.join(tempDir, 'contacts.json');
  const eventsPath = path.join(tempDir, 'events.json');
  const calendarPath = path.join(tempDir, 'calendar.json');
  const tasksPath = path.join(tempDir, 'daily_tasks.json');
  const outPath = path.join(tempDir, 'comlist.html');
  fs.writeFileSync(contactsPath, JSON.stringify([
    { _row: 2, '名前(あだ名)': '佐藤さん', 'カテゴリー': 'A', 'アクション日': '2026-09-16' },
    { _row: 3, '名前(あだ名)': '鈴木さん', 'カテゴリー': 'B', 'アクション日': '2026-09-20' }
  ]));
  fs.writeFileSync(eventsPath, '[]');
  fs.writeFileSync(calendarPath, '[]');
  fs.writeFileSync(tasksPath, JSON.stringify({
    date: '2026-09-16',
    sources: verifiedSources(),
    tasks: [{
      id: 'notion:private',
      type: 'notion',
      title: 'Notionの秘密タスク',
      section: 'other',
      url: 'https://www.notion.so/private-page'
    }]
  }));
  writeSnapshotProof(tempDir);

  const run = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'build.js'),
    '--today', '2026-09-16',
    '--now', '08:00',
    '--master', path.join(__dirname, '..', '_assets', 'list.html'),
    '--contacts', contactsPath,
    '--events', eventsPath,
    '--calendar', calendarPath,
    '--tasks', tasksPath,
    '--pass', 'levelup',
    '--out', outPath
  ], { encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr);
  const html = require("../app_sources").readApp(outPath);
  assert.ok(!html.includes('Notionの秘密タスク'));
  assert.ok(html.includes('連絡する人'));
  assert.ok(!html.includes('https://www.notion.so/private-page'));
  assert.match(html, /let DAILY_TASKS = \[\];/);
  assert.match(html, /setView\("today"\)/);
  const payload = await decryptFromHtml(html, 'levelup');
  assert.equal(payload.contacts.length, 2);
  assert.equal(payload.dailyTasks.tasks.some(task => task.type === 'contact'), false);
  const supportedSections = new Set(['selfOverdue', 'memberOverdue', 'todo', 'today', 'upcoming', 'other']);
  for (const task of payload.dailyTasks.tasks) {
    assert.ok(supportedSections.has(task.section), `supported normalized section: ${task.id}`);
  }
  assert.match(html, /brief-hero-morning-v2\.[a-f0-9]+\.jpg/);
  assert.match(html, /brief-icons-v2\.[a-f0-9]+\.png/);
  assert.ok(!html.includes('brief-hero-morning-v2.jpg'));
  assert.ok(!html.includes('brief-icons-v2.png'));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost',
    beforeParse(w) {
      Object.defineProperty(w, 'crypto', { value: crypto.webcrypto });
      w.TextEncoder = TextEncoder;
      w.TextDecoder = TextDecoder;
    }
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  const views = [];
  const originalSetView = w.setView;
  w.setView = function(view) { views.push(view); originalSetView(view); };
  // The refresh is unrelated network work; exercise real gate decryption and rendering.
  w.refreshRegisteredPeople = () => {};
  assert.equal(w.document.querySelector('#today-dashboard').children.length, 0);
  w.document.documentElement.scrollTop = 300;
  w.document.getElementById('lockpass').value = 'levelup';
  const unlocked = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('unlock timed out')), 5000);
    const observer = new w.MutationObserver(() => {
      if (w.document.getElementById('lockgate').style.display === 'none') {
        clearTimeout(timer); observer.disconnect(); resolve();
      }
    });
    observer.observe(w.document.getElementById('lockgate'), { attributes: true });
  });
  w.document.getElementById('lockbtn').click();
  await unlocked;
  assert.deepEqual(views, ['today']);
  assert.ok(w.document.querySelector('#lockgate .bi-18'));
  assert.equal(w.document.body.className, 'view-today');
  assert.equal(w.document.documentElement.scrollTop, 0);
  assert.ok(w.document.querySelector('[data-view="today"]').classList.contains('active'));
  assert.match(w.document.querySelector('#today-dashboard').textContent, /Notionの秘密タスク/);
});

test('reuse-data normalizes legacy sections and numeric priorities without inventing overdue evidence', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-reuse-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const outPath = path.join(tempDir, 'comlist.html');
  const tasks = [
    { id: 'n:past', type: 'notion', title: 'Legacy past task', due: '2026-09-15', priority: 1 },
    { id: 'n:today', type: 'notion', title: 'Legacy today task', due: '2026-09-16', priority: 2 },
    { id: 'c:next', type: 'calendar', title: 'Legacy future task', due: '2026-09-17', priority: 3 },
    { id: 'n:other', type: 'notion', title: 'Legacy undated task', priority: 4 },
    { id: 'g:unknown', type: 'gmail', title: 'Legacy task with unknown owner', due: '2026-09-15', priority: 1 },
    { id: 'c:removed', type: 'contact', title: 'Removed contact task' }
  ];
  const payload = { contacts: [{ _row: 2, 'カテゴリー': 'A', '名前(あだ名)': 'Synthetic fixture' }], dailyTasks: { date: '2026-09-16', tasks } };
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), it = 250000;
  const key = crypto.pbkdf2Sync('levelup', salt, it, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final(), cipher.getAuthTag()]);
  const enc = { salt: salt.toString('base64'), iv: iv.toString('base64'), it, ct: ct.toString('base64') };
  fs.writeFileSync(outPath, `const ENC = ${JSON.stringify(enc)};\nconst EVENTS = [];\nconst FREE_SLOTS = [];\nデータ更新日: 2026/9/16`);
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'build.js'), '--reuse-data', '--today', '2026-09-16', '--now', '12:40', '--master', path.join(__dirname, '..', '_assets', 'list.html'), '--out', outPath], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const result = await decryptFromHtml(require("../app_sources").readApp(outPath), 'levelup');
  assert.deepEqual(result.dailyTasks.tasks.map(task => task.section), ['selfOverdue', 'today', 'upcoming', 'other', 'other']);
  assert.deepEqual(result.dailyTasks.tasks.map(task => task.priority), [null, null, null, null, null]);
  assert.deepEqual(result.dailyTasks.tasks.map(task => task.overdueDays), [0, 0, 0, 0, 0]);
  assert.deepEqual(result.dailyTasks.sources, {});
});

test('master uses native daily-task rendering instead of the legacy brief iframe', () => {
  const html = require("../app_sources").readApp(path.join(__dirname, '..', '_assets', 'list.html'));
  assert.ok(!html.includes('todayframe'));
  assert.ok(!/<iframe(?![^>]*\bid="calframe")[^>]*>/i.test(html));
  assert.ok(!html.includes('srcdoc'));
  assert.ok(!html.includes('fetch("morningblief.html'));
  assert.match(html, /id="today-dashboard"/);
  assert.match(html, /function renderTodayTasks\(/);
  assert.match(html, /function wireTodayTasks\(/);
  assert.match(html, /function setLocalTaskDone\(/);
});

function verifiedSources() {
  return { calendar: { ok: true }, notion: { ok: true }, gmail: { ok: true, checkedThreads: 18, uniqueThreads: 18 } };
}

function normalBuildFixture(t, dailyTasks) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-validation-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const outPath = path.join(tempDir, 'comlist.html');
  for (const [file, value] of Object.entries({
    contacts: [{ _row: 2, '名前(あだ名)': 'Synthetic fixture', 'カテゴリー': 'A' }],
    events: [], calendar: [], tasks: dailyTasks
  })) fs.writeFileSync(path.join(tempDir, `${file}.json`), JSON.stringify(value));
  writeSnapshotProof(tempDir);
  const args = [path.join(__dirname, '..', 'build.js'), '--today', '2026-09-16', '--now', '08:00',
    '--master', path.join(__dirname, '..', '_assets', 'list.html'), '--out', outPath];
  for (const file of ['contacts', 'events', 'calendar', 'tasks']) args.push(`--${file}`, path.join(tempDir, `${file}.json`));
  return { outPath, run: () => spawnSync(process.execPath, args, { encoding: 'utf8' }) };
}

const invalidSources = [
  ['missing sources', undefined, /sources/],
  ...['calendar', 'notion', 'gmail'].map(source => [
    `${source} failed`, { ...verifiedSources(), [source]: { ok: false } }, new RegExp(source)
  ]),
  ['unchecked Gmail', { ...verifiedSources(), gmail: { ok: true, checkedThreads: 17, uniqueThreads: 18 } }, /Gmail/],
  ['overcounted Gmail', { ...verifiedSources(), gmail: { ok: true, checkedThreads: 19, uniqueThreads: 18 } }, /Gmail/],
  ['missing Gmail counts', { ...verifiedSources(), gmail: { ok: true } }, /Gmail/]
];

const invalidClassifications = [
  ['missing section', { id: 'missing-section', type: 'notion', title: 'task' }, /section/],
  ['todo priority', { id: 'todo-without-priority', type: 'notion', title: 'task', section: 'todo' }, /priority/],
  ['overdue zero', { id: 'overdue-zero', type: 'gmail', title: 'task', section: 'selfOverdue', overdueDays: 0 }, /overdueDays/],
  ['non-overdue positive', { id: 'today-positive', type: 'notion', title: 'task', section: 'today', overdueDays: 1 }, /overdueDays/]
];

for (const [name, sources, error] of invalidSources) {
  test(`normal build refuses ${name} without writing an artifact`, t => {
    const fixture = normalBuildFixture(t, { date: '2026-09-16', tasks: [], sources });
    const run = fixture.run();
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, error);
    assert.equal(fs.existsSync(fixture.outPath), false);
    fs.writeFileSync(fixture.outPath, 'previous artifact must survive');
    const rerun = fixture.run();
    assert.equal(rerun.status, 1, rerun.stderr);
    assert.equal(require("../app_sources").readApp(fixture.outPath), 'previous artifact must survive');
  });
}

for (const [name, task, error] of invalidClassifications) {
  test(`normal build refuses ${name} without writing an artifact`, t => {
    const fixture = normalBuildFixture(t, { date: '2026-09-16', tasks: [task], sources: verifiedSources() });
    const run = fixture.run();
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, error);
    assert.equal(fs.existsSync(fixture.outPath), false);
  });
}

test('normal build accepts verified empty Gmail results', t => {
  const sources = verifiedSources();
  sources.gmail = { ok: true, checkedThreads: 0, uniqueThreads: 0 };
  const fixture = normalBuildFixture(t, { date: '2026-09-16', tasks: [], sources });
  const run = fixture.run();
  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.existsSync(fixture.outPath), true);
});
