const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

function loadApp(t,opts){
  const src=require("../app_sources").readApp(path.join(__dirname,'../_assets/list.html'))
    .replace('<script src="data.js"></script>','<script>let DATA=[];let DAILY_TASKS=[];</script>');
  const dom=new JSDOM(src,Object.assign({runScripts:'dangerously',url:'http://localhost'},opts||{}));
  t.after(()=>dom.window.close());
  return dom;
}

function brief(extra){
  return Object.assign({
    date:'2026-09-25', quote:{text:'格言',source:'出典'}, comment:'c', hp:{selfOverdue:0,memberOverdue:0},
    calendar:[], tasks:[{id:'t-1',type:'notion',section:'todo',priority:'high',title:'今日やる'}],
    sources:{calendar:{ok:true},notion:{ok:true},gmail:{checkedThreads:1,uniqueThreads:1}}
  },extra||{});
}
test('本日期限の表示と優先タスクは本人担当だけにし、詳細欄の担当者も判定する',t=>{
 const w=loadApp(t).window,day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const task=(id,extra)=>Object.assign({id,type:'gmail',section:'today',due:day,title:id},extra);
 w.DAILY_TASKS=brief({date:day,tasks:[
 task('member',{owner:'ラブリー'}),task('detail-member',{detail:'10/7 09:00 のぞみーる'}),
 task('self',{owner:'りゅうちゃん'}),task('joint',{owner:'ノスタ・りゅうちゃん'}),
 task('alias',{owner:'自分'}),task('detail-self',{detail:'10/7 23:00 りゅうちゃん'}),task('implicit'),
 {id:'overdue-member',type:'gmail',section:'memberOverdue',owner:'ラブリー',overdueDays:1,title:'メンバー期限切れ'}]});
 w.renderTodayTasks();
 assert.deepEqual(Array.from(w.document.querySelectorAll('[data-section="today"] .today-task'),r=>r.dataset.taskId),['self','joint','alias','detail-self','implicit']);
 assert.equal(w.document.querySelector('[data-section="today"] .today-due-badge').textContent,'5');
 assert.equal(w.nextActionTask({}).id,'self');
 assert.doesNotMatch(w.importantTasksHTML({}),/data-important-task="(?:member|detail-member)"/);
 assert.equal(w.tasksIn('memberOverdue').length,1);
 assert.equal(w.DAILY_TASKS.tasks.length,8);
});
test('自分の本日期限の未完了タスクだけにバッジを付け、メニューは完了・解除・同期に追従する',async t=>{
 const w=loadApp(t).window,day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 w.DAILY_TASKS=brief({date:day,tasks:[
 {id:'self',type:'notion',section:'today',due:day,owner:'りゅうちゃん',title:'自分'},
 {id:'implicit',type:'notion',section:'today',due:day,title:'自分のNotion'},
 {id:'member',type:'gmail',section:'today',due:day,owner:'ラブリー',title:'他の人'},
 {id:'todo',type:'notion',section:'todo',title:'期限なし'}]});
 w.render();assert.equal(w.document.querySelector('[data-view="today"] .today-due-badge').textContent,'2');
 w.renderTodayTasks();assert.equal(w.document.querySelectorAll('.today-task .today-due-badge').length,2);
 w.setLocalTaskDone('self',true);assert.equal(w.document.querySelector('[data-view="today"] .today-due-badge').textContent,'1');
 w.setLocalTaskDone('implicit',true);assert.equal(w.document.querySelectorAll('.today-due-badge').length,0);
 w.setLocalTaskDone('self',false);assert.equal(w.document.querySelector('[data-view="today"] .today-due-badge').textContent,'1');
 w.writeTaskObject('daily-task-schema:'+day,{version:2},w.TASK_PENDING_MEMORY);w.savePendingTasks(day,{});
 w.taskStateRequest=async()=>({date:day,done:{self:true,implicit:true}});await w.syncTaskState();assert.equal(w.document.querySelectorAll('.today-due-badge').length,0);
 w.DAILY_TASKS.date=w.FieldCalendarModel.shift(day,-1);w.renderTodayTasks();assert.equal(w.document.querySelectorAll('.today-due-badge').length,0);
});

test('撃破の履歴を今週と先週の合計で表示する',t=>{
  const w=loadApp(t).window;
  // 2026-09-25 は金曜。今週=9/21(月)〜、先週=9/14〜9/20
  w.DAILY_TASKS=brief({resolved:[{id:'x',title:'片づけた',section:'selfOverdue',overdueDays:2}],
    victoryLog:[{date:'2026-09-15',count:2},{date:'2026-09-20',count:1},{date:'2026-09-22',count:4},{date:'2026-09-25',count:1}]});
  w.renderTodayTasks();
  const box=w.document.querySelector('.victory-history');
  assert.ok(box);
  assert.match(box.textContent,/今週\s*5/);
  assert.match(box.textContent,/先週\s*3/);
});

test('撃破が0件の日でも履歴があれば表示する',t=>{
  const w=loadApp(t).window;
  w.DAILY_TASKS=brief({resolved:[],victoryLog:[{date:'2026-09-22',count:2}]});
  w.renderTodayTasks();
  assert.match(w.document.getElementById('today-dashboard').textContent,/今週\s*2/);
});

test('3日以内に会う人を今日の予定に準備として出す',t=>{
  const w=loadApp(t).window;
  const today=new Date(); const iso=d=>{const x=new Date(today);x.setDate(x.getDate()+d);return x.getFullYear()+'/'+(x.getMonth()+1)+'/'+x.getDate();};
  w.eval('DATA='+JSON.stringify([
    {'名前(あだ名)':'近いさん','次会う日':iso(2),'次会う日にする事':'サシ'},
    {'名前(あだ名)':'遠いさん','次会う日':iso(6)},
    {'名前(あだ名)':'過去さん','次会う日':iso(-1)}
  ]));
  w.DAILY_TASKS=brief();
  w.renderTodayTasks();
  const rows=[...w.document.querySelectorAll('.meet-prep-row')].map(e=>e.textContent);
  assert.equal(rows.length,1);
  assert.match(rows[0],/近いさん/);
  assert.match(rows[0],/サシ/);
  assert.ok(w.document.querySelector('[data-section="schedule"] .meet-prep-row'));
});

test('近く会う人に連絡先・前回の履歴・話題・カードを開くボタンを出す',t=>{
  const w=loadApp(t).window;
  const x=new Date(); x.setDate(x.getDate()+1);
  w.eval('DATA='+JSON.stringify([{'名前(あだ名)':'近いさん','次会う日':x.getFullYear()+'/'+(x.getMonth()+1)+'/'+x.getDate(),
    'LINE/Insta名':'chika_line','Insta URL':'https://instagram.com/chika','履歴':'7/22 夢マップ 8/5 飲み会で転職の話',
    '趣味・部活(R)':'サウナ','目標(D)':'起業','_row':5}]));
  w.DAILY_TASKS=brief();
  w.renderTodayTasks(); w.wireTodayTasks();
  const row=w.document.querySelector('.meet-prep-row');
  assert.match(row.textContent,/chika_line/);
  assert.equal(row.querySelector('a').getAttribute('href'),'https://instagram.com/chika');
  assert.match(row.textContent,/前回: 8\/5 飲み会で転職の話/);
  assert.doesNotMatch(row.textContent,/夢マップ/);
  assert.match(row.textContent,/趣味: サウナ/);
  row.querySelector('[data-meet-open]').click();
  assert.equal(w.document.body.className,'view-garden');
});

test('https以外のInsta URLはリンクにしない',t=>{
  const w=loadApp(t).window;
  const x=new Date();
  w.eval('DATA='+JSON.stringify([{'名前(あだ名)':'危険さん','次会う日':x.getFullYear()+'/'+(x.getMonth()+1)+'/'+x.getDate(),'Insta URL':'javascript:alert(1)'}]));
  w.DAILY_TASKS=brief();
  w.renderTodayTasks();
  assert.equal(w.document.querySelector('.meet-prep-row a'),null);
});

function stubTaskApi(w, remote){
  const calls=[];
  w.fetch=async(_url,opt)=>{ const b=JSON.parse(opt.body); calls.push(b);
    if(b.op==='get') return {json:async()=>({ok:true,date:b.date,done:remote})};
    return {json:async()=>({ok:true,date:b.date,done:{}})}; };
  return calls;
}
function twoTasks(){ return brief({date:'2026-09-25',tasks:[
  {id:'a',type:'notion',section:'todo',priority:'high',title:'A'},
  {id:'b',type:'notion',section:'todo',priority:'low',title:'B'}]}); }

test('合言葉がある端末は他の端末のチェックを取り込み、端末だけのチェックを送り返す',async t=>{
  const w=loadApp(t).window;
  w.getWriteToken=()=>'tok';
  w.DAILY_TASKS=twoTasks();
  w.localStorage.setItem('daily-task:2026-09-25',JSON.stringify({b:true}));
  const calls=stubTaskApi(w,{a:true});
  w.renderTodayTasks(); w.wireTodayTasks();
  await w.syncTaskState();
  const checked=[...w.document.querySelectorAll('.today-task-check')].filter(c=>c.checked).map(c=>c.getAttribute('data-task-id'));
  assert.deepEqual(checked.sort(),['a','b']);
  assert.deepEqual(calls.filter(c=>c.op==='set').map(c=>[c.id,c.done,c.token,c.date]),[['b',true,'tok','2026-09-25']]);
  assert.equal(calls.some(c=>'title' in c),false);
});

test('チェックを付け外しするとサーバーにも送る',async t=>{
  const w=loadApp(t).window;
  w.getWriteToken=()=>'tok';
  w.DAILY_TASKS=twoTasks();
  const calls=stubTaskApi(w,{});
  w.renderTodayTasks(); w.wireTodayTasks();
  w.setLocalTaskDone('a',true);
  w.setLocalTaskDone('a',false);
  await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(calls.map(c=>[c.op,c.id,c.done]),[['set','a',false]],'送信前の反復操作は最新の状態だけを送る');
});

test('合言葉が無い端末は通信しない',async t=>{
  const w=loadApp(t).window;
  w.getWriteToken=()=>'';
  w.DAILY_TASKS=twoTasks();
  const calls=stubTaskApi(w,{a:true});
  w.renderTodayTasks(); w.wireTodayTasks();
  await w.syncTaskState();
  w.setLocalTaskDone('b',true);
  assert.equal(calls.length,0);
});

test('見出しを押すとカードを畳める',t=>{
  const w=loadApp(t).window;
  w.DAILY_TASKS=brief();
  w.renderTodayTasks(); w.wireTodayTasks();
  const card=w.document.querySelector('[data-section="quote"]');
  assert.equal(card.classList.contains('collapsed'),false);
  card.querySelector('h2').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  assert.equal(card.classList.contains('collapsed'),true);
});

test('スマホ幅では期限切れとToDo以外を最初から畳む',t=>{
  const w=loadApp(t).window;
  w.matchMedia=q=>({matches:/max-width/.test(q),addListener(){},removeListener(){}});
  w.DAILY_TASKS=brief();
  w.renderTodayTasks();
  const c=s=>w.document.querySelector('[data-section="'+s+'"]').classList.contains('collapsed');
  assert.equal(c('todo'),false);
  assert.equal(c('selfOverdue'),false);
  assert.equal(c('quote'),true);
  assert.equal(c('sources'),true);
});
