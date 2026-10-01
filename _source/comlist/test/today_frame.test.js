const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

function loadApp(t){
  const src=require("../app_sources").readApp(path.join(__dirname,'../_assets/list.html'))
    .replace('<script src="data.js"></script>','<script>let DATA=[];let DAILY_TASKS=[];</script>');
  const dom=new JSDOM(src,{runScripts:'dangerously',url:'http://localhost'});
  t.after(()=>dom.window.close());
  return dom;
}

test('renders daily tasks natively and opens only valid Notion URLs in a new tab',t=>{
  const dom=loadApp(t);
  const w=dom.window;
  const doc=w.document;
  w.DAILY_TASKS={date:'2026-09-16',tasks:[
    {id:'n-1',type:'notion',title:'Notionタスク',detail:'詳細',url:'https://www.notion.so/abc'},
    {id:'n-app',type:'notion',title:'NotionアプリURL',detail:'詳細',url:'https://app.notion.com/def'},
    {id:'g-1',type:'gmail',title:'返信する',url:''},
    {id:'n-2',type:'notion',title:'危険なリンク',url:'javascript:alert(1)'},
    {id:'c-1',type:'contact',title:'山田さん',detail:'連絡する',url:null,contact:{name:'山田さん'}}
  ]};

  w.renderTodayTasks();

  const link=doc.querySelector('.task-notion-link');
  assert.equal(link.target,'_blank');
  assert.equal(link.rel,'noopener');
  assert.equal(link.getAttribute('href'),'https://www.notion.so/abc');
  assert.equal(doc.querySelectorAll('.task-notion-link').length,2);
  assert.equal(doc.querySelectorAll('.task-notion-link')[1].getAttribute('href'),'https://app.notion.com/def');
  assert.equal(doc.querySelector('iframe:not(#calframe)'),null);
  assert.match(doc.getElementById('today-dashboard').textContent,/Notionタスク/);
  assert.match(doc.getElementById('today-dashboard').textContent,/返信する/);
  assert.doesNotMatch(doc.getElementById('today-dashboard').textContent,/山田さん/);
  assert.doesNotMatch(doc.getElementById('today-dashboard').textContent,/連絡する人/);
  assert.ok(doc.querySelector('.today-hero'));
  assert.equal(doc.querySelectorAll('#today-dashboard h2 .brief-icon').length,9);
});

test('先回り準備は明日から3日後までの期限だけを表示する',t=>{
  const w=loadApp(t).window;
  w.DAILY_TASKS={date:'2026-10-01',tasks:[
    {id:'tomorrow',type:'notion',section:'upcoming',title:'明日期限',due:'2026-10-02'},
    {id:'third',type:'notion',section:'upcoming',title:'3日後期限',due:'2026-10-04'},
    {id:'fourth',type:'notion',section:'upcoming',title:'4日後期限',due:'2026-10-05'},
    {id:'none',type:'notion',section:'upcoming',title:'期限未設定'},
    {id:'today',type:'notion',section:'today',title:'今日期限',due:'2026-10-01'}
  ]};
  w.renderTodayTasks();
  const section=w.document.querySelector('[data-section="upcoming"]');
  assert.match(section.querySelector('h2').textContent,/3日先まで/);
  assert.deepEqual([...section.querySelectorAll('.today-task')].map(x=>x.dataset.taskId),['tomorrow','third']);
  assert.equal(w.document.querySelector('[data-section="today"] .today-task').dataset.taskId,'today');
  assert.equal(w.nextActionTask({}).id,'today');
  assert.equal(w.nextActionTask({today:true}).id,'tomorrow');
  assert.equal(w.nextActionTask({today:true,tomorrow:true,third:true}),null);
});

function fullBrief(){
  return {
    date:'2026-09-16', quote:{text:'格言',source:'出典'}, comment:'最初に期限切れを片づける。',
    hp:{selfOverdue:1,memberOverdue:1}, calendar:[{id:'cal-1',title:'朝会',time:'06:30'}],
    tasks:[
      {id:'s-1',type:'gmail',section:'selfOverdue',title:'自分',overdueDays:9},
      {id:'m-1',type:'gmail',section:'memberOverdue',title:'メンバー',overdueDays:3},
      {id:'t-low',type:'notion',section:'todo',priority:'low',title:'低'},
      {id:'t-1',type:'notion',section:'todo',priority:'high',title:'今日やる'},
      {id:'t-mid',type:'notion',section:'todo',priority:'medium',title:'中'},
      {id:'d-1',type:'notion',section:'today',title:'本日期限'},
      {id:'u-1',type:'calendar',section:'upcoming',title:'先回り',due:'2026-09-17'},
      {id:'o-1',type:'notion',section:'other',title:'期限なし'},
      {id:'contact',type:'contact',section:'selfOverdue',title:'非表示の連絡先',overdueDays:99}
    ],
    sources:{calendar:{ok:true},notion:{ok:true},gmail:{checkedThreads:18,uniqueThreads:18}}
  };
}

test('次にやることは未完了の自分の期限切れを優先し、完了時に次へ進む',t=>{
  const w=loadApp(t).window;
  w.DAILY_TASKS=fullBrief();
  w.renderTodayTasks();
  const next=()=>w.document.getElementById('todayNextAction');
  assert.match(next().textContent,/自分/);
  assert.equal(next().querySelector('[data-next-task]').getAttribute('data-next-task'),'s-1');
  assert.equal(w.document.querySelectorAll('[data-task-id="s-1"] .today-task-title').length,1);
  w.setLocalTaskDone('s-1',true);
  assert.equal(next().querySelector('[data-next-task]').getAttribute('data-next-task'),'d-1');
  assert.match(next().textContent,/本日期限/);
});

test('renders all ten sections in order with each task in its section once',t=>{
  const w=loadApp(t).window;
  w.DAILY_TASKS=fullBrief();
  w.renderTodayTasks();
  const doc=w.document;
  const headings=[...doc.querySelectorAll('#today-dashboard h2')];
  assert.deepEqual(headings.map(x=>x.textContent.trim()),['今日の標的','今日の格言','自分の期限切れ','メンバーの期限切れ','今日のToDo','今日中の期限タスク','3日先までの先回り準備','その他ToDo','参謀コメント','情報ソース']);
  assert.deepEqual(headings.map(x=>[...x.querySelector('.brief-icon').classList].find(c=>/^bi-/.test(c))),['bi-21','bi-0','bi-2','bi-1','bi-23','bi-4','bi-6','bi-7','bi-8','bi-9']);
  for(const task of w.DAILY_TASKS.tasks.filter(x=>x.type!=='contact')){
    const rows=doc.querySelectorAll('.today-task[data-task-id="'+task.id+'"]');
    assert.equal(rows.length,1);
    assert.equal(rows[0].closest('[data-section]').dataset.section,task.section);
  }
  assert.deepEqual([...doc.querySelectorAll('[data-section="todo"] .today-task')].map(x=>x.dataset.taskId),['t-1','t-mid','t-low']);
  assert.ok(doc.querySelector('[data-task-id="t-1"] .bi-15'));
  assert.ok(doc.querySelector('[data-task-id="t-mid"] .bi-16'));
  assert.ok(doc.querySelector('[data-task-id="t-low"] .bi-17'));
  assert.match(doc.querySelector('.today-boss').textContent,/Lv\.9.*自分/);
  assert.equal(doc.querySelectorAll('.today-boss').length,1);
  assert.match(doc.querySelector('[data-section="todo"]').textContent,/06:30.*朝会/);
  assert.match(doc.querySelector('[data-section="comment"]').textContent,/最初に期限切れ/);
  assert.match(doc.querySelector('[data-section="sources"]').textContent,/18.*18/);
  assert.doesNotMatch(doc.querySelector('#today-dashboard').textContent,/非表示の連絡先|連絡する人|\p{Extended_Pictographic}/u);
});

for(const [days,index] of [[1,10],[2,10],[3,11],[4,11],[5,12],[6,12],[7,13],[8,13],[9,14],[14,14]]){
  test('monster and boss boundary at '+days+' overdue days',t=>{
    const w=loadApp(t).window;
    w.DAILY_TASKS={date:'2026-09-16',tasks:[{id:'s',type:'gmail',section:'selfOverdue',title:'期限切れ',overdueDays:days}]};
    w.renderTodayTasks();
    const row=w.document.querySelector('.today-task');
    assert.ok(row.querySelector('.bi-'+index));
    assert.equal(row.querySelector('.today-overdue-lv').textContent,'Lv.'+days);
    assert.equal(row.querySelector('.today-overdue-days').textContent,days+'日超過');
    assert.equal(row.querySelector('.today-monster'),null);  // 左のマークに集約したので本文には出さない
    assert.equal(w.document.querySelectorAll('.today-boss').length,days>=7?1:0);
  });
}

test('uses verified overdue sections for HP and boss, and clamps HP',t=>{
  const w=loadApp(t).window;
  w.DAILY_TASKS={date:'2026-09-16',tasks:[
    {id:'s',type:'gmail',section:'selfOverdue',title:'自分',overdueDays:6},
    {id:'m',type:'gmail',section:'memberOverdue',title:'メンバー',overdueDays:2},
    {id:'t',type:'notion',section:'todo',title:'今日',overdueDays:99}
  ]};
  w.renderTodayTasks();
  assert.equal(w.document.querySelector('.today-hp-value').textContent,'85 / 100');
  assert.equal(w.document.querySelector('.today-boss'),null);
  for(const [counts,hp] of [[{selfOverdue:20,memberOverdue:1},0],[{selfOverdue:0,memberOverdue:0},100]]){
    w.DAILY_TASKS.hp=counts;
    w.renderTodayTasks();
    assert.equal(w.document.querySelector('.today-hp-value').textContent,hp+' / 100');
  }
});

test('escapes content and shows only source status and counts, never source secrets',t=>{
  const w=loadApp(t).window;
  w.DAILY_TASKS=fullBrief();
  w.DAILY_TASKS.tasks[0].title='<img src=x onerror=alert(1)>';
  w.DAILY_TASKS.quote.text='<b>格言</b>';
  w.DAILY_TASKS.comment='<script>alert(1)</script>';
  w.DAILY_TASKS.sources={calendar:{ok:false,token:'secret-token'},notion:{ok:true,url:'https://private.example'},gmail:{checkedThreads:17,uniqueThreads:18,details:'secret-thread'}};
  w.renderTodayTasks();
  const box=w.document.querySelector('#today-dashboard');
  assert.equal(box.querySelector('img,script,b'),null);
  assert.match(box.textContent,/<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(box.textContent,/secret-token|private\.example|secret-thread/);
  assert.match(box.querySelector('[data-section="sources"]').textContent,/未取得/);
  assert.match(box.querySelector('[data-section="sources"]').textContent,/未確認/);
  assert.ok(box.querySelector('[data-section="sources"] .bi-4'));
});

test('completion survives rerenders and remains isolated by date',t=>{
  const w=loadApp(t).window;
  w.DAILY_TASKS=fullBrief();
  w.loadToday();
  w.document.querySelector('input[data-task-id="t-1"]').click();
  w.loadToday();
  assert.equal(w.document.querySelector('input[data-task-id="t-1"]').checked,true);
  assert.ok(w.document.querySelector('.today-task[data-task-id="t-1"] .bi-3'));
  w.DAILY_TASKS.date='2026-09-17';
  w.loadToday();
  assert.equal(w.document.querySelector('input[data-task-id="t-1"]').checked,false);
  w.DAILY_TASKS.date='2026-09-16';
  w.loadToday();
  assert.equal(w.document.querySelector('input[data-task-id="t-1"]').checked,true);
});

test('converts registered emoji and removes unsupported emoji from every dashboard text field',t=>{
  const w=loadApp(t).window;
  w.DAILY_TASKS=fullBrief();
  w.DAILY_TASKS.quote={text:'🌅 格言 <b>本文</b> 😀',source:'🔗 出典 🏳️‍🌈'};
  w.DAILY_TASKS.calendar=[{title:'📅 朝会 🧑🏽‍💻',time:'⚠️ 06:30 🇯🇵'}];
  w.DAILY_TASKS.comment='💡 コメント <img src=x onerror=alert(1)> 🤝🏽 1️⃣';
  w.DAILY_TASKS.hpNote='🛡️ HP補足 🦄';
  Object.assign(w.DAILY_TASKS.tasks[0],{
    title:'🔥 タスク 🐻‍❄️', detail:'✅ 詳細 <script>alert(1)</script> 🫠', due:'📅 2026-09-15 🏴\u{E0067}\u{E0062}\u{E007F}'
  });
  const original=JSON.stringify(w.DAILY_TASKS);
  w.renderTodayTasks();
  const box=w.document.querySelector('#today-dashboard');
  const rawEmoji=/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\u200D\u20E3\u{E0020}-\u{E007F}]/u;
  assert.doesNotMatch(box.innerHTML,rawEmoji);
  assert.doesNotMatch(box.textContent,rawEmoji);
  for(const [selector,index] of [
    ['.today-quote',0],['.today-quote-source',9],['[data-section="todo"] .today-task-detail',5],
    ['.today-comment',8],['.today-hp-note',24],['.today-boss .today-task-title',1],
    ['.today-task[data-task-id="s-1"] .today-task-title',1],
    ['.today-task[data-task-id="s-1"] .today-task-detail',3]
  ]) assert.ok(box.querySelector(selector+' .bi-'+index),selector);
  assert.equal(box.querySelector('img,script,b'),null);
  assert.match(box.textContent,/<b>本文<\/b>/);
  assert.match(box.textContent,/<img src=x onerror=alert\(1\)>/);
  assert.match(box.textContent,/<script>alert\(1\)<\/script>/);
  assert.equal(JSON.stringify(w.DAILY_TASKS),original);
});

test('maps all 25 registered text emoji to matching sprite cells and preserves ordinary text',t=>{
  const w=loadApp(t).window;
  const symbols=['🌅','🔥','⚡','✅','⚠️','📅','👀','📭','💡','🔗','🐛','🐝','🦈','👹','💀','🔴','🟡','🟢','🔒','🎉','↗️','🚨','⭐','📋','🛡️'];
  w.DAILY_TASKS={date:'2026-09-16',tasks:[],comment:symbols.join('')+'通常の123 # * & <本文>\n次行'};
  w.renderTodayTasks();
  const comment=w.document.querySelector('.today-comment');
  assert.deepEqual([...comment.querySelectorAll('.brief-icon')].map(x=>x.className),symbols.map((_,i)=>'brief-icon bi-'+i));
  assert.equal(comment.textContent,'通常の123 # * & <本文>\n次行');
});

test('emoji conversion leaves task ID attributes and Notion URL values unchanged',t=>{
  const w=loadApp(t).window;
  const id='id-📅-😀-"';
  const url='https://www.notion.so/page?label=📅&other=😀';
  w.DAILY_TASKS={date:'2026-09-16',tasks:[{id,type:'notion',section:'other',title:'📅 本文 😀',url}]};
  w.loadToday();
  const row=w.document.querySelector('.today-task');
  assert.equal(row.dataset.taskId,id);
  assert.equal(row.querySelector('input').dataset.taskId,id);
  assert.equal(row.querySelector('a').getAttribute('href'),new URL(url).href);
  assert.ok(row.querySelector('.today-task-title .bi-5'));
  assert.equal(row.querySelector('.today-task-title').textContent,' 本文 ');
  row.querySelector('input').click();
  assert.deepEqual(JSON.parse(w.localStorage.getItem('daily-task:2026-09-16')),{[id]:true});
});

test('computes HP from overdue count fields',t=>{
  const dom=loadApp(t);
  const w=dom.window;
  w.DAILY_TASKS={date:'2026-09-16',hp:{selfOverdue:2,memberOverdue:1},tasks:[]};
  w.renderTodayTasks();
  assert.match(w.document.querySelector('.today-hp-value').textContent,/75 \/ 100/);
});

test('persists local completion by date for supported task types and ignores removed contact tasks',t=>{
  const dom=loadApp(t);
  const w=dom.window;
  w.DAILY_TASKS={date:'2026-09-16',tasks:[
    {id:'n-1',type:'notion',title:'Notionタスク',url:null},
    {id:'g-1',type:'gmail',title:'返信する',url:null},
    {id:'c-1',type:'contact',title:'山田さん',url:null,contact:{name:'山田さん'}}
  ]};
  w.renderTodayTasks();
  w.wireTodayTasks();

  w.setLocalTaskDone('n-1',true);
  w.setLocalTaskDone('c-1',true);

  assert.deepEqual(JSON.parse(w.localStorage.getItem('daily-task:2026-09-16')),{'n-1':true});
  assert.equal(w.document.querySelector('[data-task-id="n-1"]').classList.contains('done'),true);
  assert.equal(w.document.querySelector('[data-task-id="c-1"]'),null);
});

/* 自分とメンバーの期限切れは別の枠に分け、背景色で持ち主を見分けられるようにする */
test('splits own and member overdue into separate cards with different backgrounds',t=>{
  const w=loadApp(t).window;
  w.DAILY_TASKS=fullBrief();
  w.renderTodayTasks();
  const doc=w.document;
  const self=doc.querySelector('[data-section="selfOverdue"]');
  const member=doc.querySelector('[data-section="memberOverdue"]');

  assert.notEqual(self,member);
  for(const card of [self,member]) assert.equal(card.tagName,'SECTION');
  assert.ok(self.classList.contains('today-card')&&self.classList.contains('today-self'));
  assert.ok(member.classList.contains('today-card')&&member.classList.contains('today-member'));
  assert.equal(self.querySelector('[data-section="memberOverdue"]'),null);
  assert.equal(member.querySelector('[data-section="selfOverdue"]'),null);
  assert.match(self.textContent,/自分/);
  assert.match(member.textContent,/メンバー/);
  assert.equal(doc.querySelector('[data-section="overdue"]'),null);

  const css=require("../app_sources").readApp(path.join(__dirname,'../_assets/list.html'));
  const background=name=>(css.match(new RegExp('\.'+name+' \{[^}]*background: (#[0-9a-f]{3,6})'))||[])[1];
  const [selfBg,memberBg]=[background('today-self'),background('today-member')];
  assert.ok(selfBg&&memberBg,'両方の枠に背景色を定義する');
  assert.notEqual(selfBg,memberBg);
});

/* 報酬は「期限切れが消えたとき」だけに置く。 */
test('shows yesterday の戦果 when overdue items disappeared, and names a target otherwise',t=>{
  const w=loadApp(t).window;
  const doc=w.document;
  w.DAILY_TASKS=Object.assign(fullBrief(),{resolved:[
    {id:'m-old',title:'0927CFG会',detail:'9/6 シェフ富徳・ノスタ',section:'memberOverdue',overdueDays:10},
    {id:'s-old',title:'BEATONE',detail:'9/14 りゅうちゃん',section:'selfOverdue',overdueDays:2}
  ]});
  w.renderTodayTasks();

  const victory=doc.querySelector('[data-section="victory"]');
  assert.ok(victory.classList.contains('today-victory'));
  assert.equal(doc.querySelector('#today-dashboard section:nth-of-type(2)'),victory);
  assert.equal(victory.querySelector('h2').textContent.trim(),'昨日からの戦果');
  assert.deepEqual([...victory.querySelectorAll('.victory-lv')].map(x=>x.textContent),['Lv.10 撃破','Lv.2 撃破']);
  assert.ok(victory.querySelector('.victory-row .victory-icon.vi-0'));
  assert.ok(victory.querySelector('.victory-row .victory-icon.vi-1'));

  // メンバーが1件解消したぶんだけチームHPの回復量を金色で出す
  const member=doc.querySelector('[data-section="memberOverdue"]');
  assert.match(member.querySelector('.today-teamhp-value').textContent,/チームHP 95 \/ 100/);
  assert.equal(member.querySelector('.today-teamhp-delta').textContent,'+5');
  assert.ok(member.querySelector('.today-teamhp .victory-icon.vi-3'));

  // 戦果ゼロの日は最大Lvの相手を標的として名指しする
  w.DAILY_TASKS.resolved=[];
  w.renderTodayTasks();
  const target=doc.querySelector('[data-section="victory"]');
  assert.equal(target.querySelector('h2').textContent.trim(),'今日の標的');
  assert.match(target.textContent,/自分/);
  assert.ok(target.querySelector('.victory-icon.vi-2'));
  assert.equal(doc.querySelector('.today-teamhp-delta'),null);
});

/* 超過日数は段階で目立たせ、担当者は名前のバッジで即分かるようにする */
test('marks overdue rows by severity tier and sorts the worst first',t=>{
  const w=loadApp(t).window;
  const doc=w.document;
  w.DAILY_TASKS={date:'2026-09-16',tasks:[
    {id:'m-1',type:'gmail',section:'memberOverdue',title:'軽い',detail:'9/15 デモ一郎',overdueDays:1},
    {id:'m-9',type:'gmail',section:'memberOverdue',title:'重い',detail:'9/6 デモ二郎',overdueDays:10},
    {id:'m-5',type:'gmail',section:'memberOverdue',title:'中くらい',detail:'9/11 デモ三郎',overdueDays:5},
    {id:'t-1',type:'notion',section:'today',title:'本日期限',detail:'本日 19:00 デモ四郎'}
  ]};
  w.renderTodayTasks();

  const rows=[...doc.querySelectorAll('[data-section="memberOverdue"] .today-task')];
  assert.deepEqual(rows.map(x=>x.dataset.taskId),['m-9','m-5','m-1']);
  assert.deepEqual(rows.map(x=>[...x.classList].find(c=>/^ov-/.test(c))),['ov-5','ov-3','ov-1']);
  assert.deepEqual(rows.map(x=>x.querySelector('.today-overdue-days').textContent),['10日超過','5日超過','1日超過']);
  // 日数とアイコンは行の左端（チェックボックスの次）に置く
  assert.deepEqual(rows.map(x=>x.children[1].className),['today-overdue-mark','today-overdue-mark','today-overdue-mark']);

  // 期限切れでない行には帯も日数も付けない
  const today=doc.querySelector('[data-task-id="t-1"]');
  assert.equal([...today.classList].find(c=>/^ov-/.test(c)),undefined);
  assert.equal(today.querySelector('.today-overdue-mark'),null);
});

test('shows the owner as a chip, falling back to the detail when the field is missing',t=>{
  const w=loadApp(t).window;
  const doc=w.document;
  w.DAILY_TASKS={date:'2026-09-16',tasks:[
    {id:'a',type:'gmail',section:'memberOverdue',title:'集計',owner:'お笑いマサ',detail:'9/13 だれか',overdueDays:3},
    {id:'b',type:'gmail',section:'memberOverdue',title:'集金',detail:'9/15 23:00 シェフ富徳・ラブリー',overdueDays:1},
    {id:'c',type:'gmail',section:'memberOverdue',title:'連絡',detail:'本日 19:00 りゅうちゃん。1000円／人',overdueDays:2},
    {id:'d',type:'notion',section:'selfOverdue',title:'読了',detail:'Notion 期限 9/15（23:00 JST）',overdueDays:1},
    {id:'e',type:'gmail',section:'selfOverdue',title:'自分の件',detail:'9/13 自分',overdueDays:3}
  ]};
  w.renderTodayTasks();

  const chip=id=>doc.querySelector('[data-task-id="'+id+'"] .today-owner');
  assert.equal(chip('a').textContent,'お笑いマサ');           // owner を優先する
  assert.equal(chip('b').textContent,'シェフ富徳・ラブリー');   // 日付と時刻を外した残り
  assert.equal(chip('c').textContent,'りゅうちゃん');          // 句点より前だけ
  assert.equal(chip('d'),null);                                // 担当者と読めないものは出さない
  assert.equal(chip('e'),null);                                // 「自分」は自分の枠では出さない

  // 名前は本文より大きく、黄色のバッジで見せる
  const css=require("../app_sources").readApp(path.join(__dirname,'../_assets/list.html'));
  const rule=css.match(/\.today-owner \{([^}]*)\}/)[1];
  assert.match(rule,/background: #ffe066/);
  const size=Number(rule.match(/font-size: (\d+)px/)[1]);
  const titleSize=Number(css.match(/\.today-task-title \{[^}]*font-size: (\d+)px/)[1]);
  assert.ok(size >= titleSize, '担当者名は本文と同じか大きく出す');
});
