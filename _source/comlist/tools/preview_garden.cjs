// Local design preview: synthetic contacts only, no external requests or writes.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const demo = Array.from({ length: 24 }, (_, i) => ({
  'カテゴリー': 'ABCD'[Math.floor(i / 6)],
  '名前(あだ名)': `デモ ${String(i + 1).padStart(2, '0')}`,
  '仕事(O)': ['デザイナー', '営業', 'エンジニア'][i % 3],
  'アクション日': i % 3 ? '2099/12/31' : '2020/1/1',
  _row: i + 2
}));
const ASSETS = [
  ['menu-icons-v1.png', 'image/png'],
  ['garden-icons-v1.png', 'image/png'],
  ['brief-icons-v2.png', 'image/png'],
  ['victory-icons-v1.png', 'image/png'],
  ['brief-hero-morning-v2.jpg', 'image/jpeg'],
  ['victory-banner-v1.jpg', 'image/jpeg']
];
// 今日のタスクの見た目を確認するためのサンプル。実データは読まない。
const demoTasks = {
  date: '2026-09-16',
  dayLabel: '2026年9月16日（水）',
  hp: { selfOverdue: 2, memberOverdue: 3 },
  hpNote: '今日の締切を落とさなければ明日から戻せる',
  quote: { text: '石の上にも三年', source: '日本のことわざ' },
  comment: 'まず今日の締切を閉じる。次に一番止まっている相手へ一本入れる。',
  calendar: [{ id: 'cal-1', title: 'デモ会議', time: '19:00' }],
  resolved: [
    { id: 'r-1', title: 'デモ会の集金', detail: '9/6 デモさん・デモ子さん', section: 'memberOverdue', overdueDays: 10 },
    { id: 'r-2', title: 'デモ資料の提出', detail: '9/14 自分', section: 'selfOverdue', overdueDays: 2 }
  ],
  tasks: [
    { id: 's-1', type: 'gmail', section: 'selfOverdue', title: 'デモ実行タスク', detail: '9/13 自分', overdueDays: 3 },
    { id: 's-2', type: 'notion', section: 'selfOverdue', title: 'デモNotionタスク', detail: '9/15 自分', overdueDays: 1 },
    { id: 'm-1', type: 'gmail', section: 'memberOverdue', title: 'デモ飲み会の集計', detail: '9/13 デモさん', overdueDays: 3 },
    { id: 'm-2', type: 'gmail', section: 'memberOverdue', title: 'デモ引越しタスク', detail: '9/15 デモ子さん', overdueDays: 1 },
    { id: 'm-3', type: 'gmail', section: 'memberOverdue', title: 'デモ目標タスク', detail: '9/15 デモ三郎さん', overdueDays: 1 },
    { id: 't-1', type: 'notion', section: 'todo', priority: 'high', title: 'デモの今日やること' },
    { id: 'd-1', type: 'gmail', section: 'today', title: 'デモ本日締切', detail: '本日 19:00 自分' },
    { id: 'u-1', type: 'gmail', section: 'upcoming', title: 'デモ先回り準備', due: '2026-09-18' },
    { id: 'o-1', type: 'gmail', section: 'other', title: 'デモ受領確認' }
  ],
  sources: { calendar: { ok: true }, notion: { ok: true }, gmail: { ok: true, checkedThreads: 40, uniqueThreads: 40 } }
};
function page() {
  let html = fs.readFileSync(path.join(root, '_assets/list.html'), 'utf8');
  for (const [file, mime] of ASSETS) {
    const uri = 'url("data:' + mime + ';base64,' + fs.readFileSync(path.join(root, '_assets', file)).toString('base64') + '")';
    html = html.split('url("' + file + '")').join(uri);
  }
  return html
    .replace('<script src="data.js"></script>', `<script>const DATA=${JSON.stringify(demo)};const DAILY_TASKS=${JSON.stringify(demoTasks)};</script>`)
    .replace('<body>', '<body><div style="padding:8px 0;color:#677487;font-size:11px">DESIGN PREVIEW · サンプルデータ</div>');
}
if (process.argv.includes('--check')) {
  const dom = new JSDOM(page(), { runScripts: 'dangerously', url: 'http://localhost:8765' });
  const w = dom.window, d = w.document;
  const assert = require('node:assert/strict');
  // 初期表示は今日のタスク。庭は開いたときに描かれるので、先に切り替える
  assert.ok(d.querySelector('[data-section="victory"] .victory-icon'));
  w.setView('garden');
  assert.equal(d.querySelectorAll('.plant').length, 24);
  d.querySelector('.plant').click();
  assert.ok(d.querySelector('.gd-panel'));
  w.setView('list');
  assert.equal(d.querySelectorAll('#app .card').length, 24);
  const search = d.getElementById('search');
  search.value = 'デモ 01'; search.dispatchEvent(new w.Event('input'));
  assert.equal(d.querySelectorAll('#app .card').length, 1);
  search.value = ''; search.dispatchEvent(new w.Event('input'));
  const cat = d.querySelector('#catfilter input');
  cat.checked = false; cat.dispatchEvent(new w.Event('change'));
  assert.equal(d.querySelectorAll('#app .card').length, 18);
  d.querySelector('[data-view="events"]').click();
  assert.equal(d.body.className, 'view-events');
  console.log('PASS: garden, detail, list, search, category filter, events; synthetic data only.');
  w.close();
} else {
  http.createServer((req, res) => {
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'"
    });
    res.end(page());
  }).listen(18769, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:18769'));
}
