'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),{webcrypto}=require('node:crypto');
function app(t,contacts=[],saved={}){
  const html=require('../app_sources').readApp('_assets/list.html').replace(/const EVENTS = \[[\s\S]*?\];/,'const EVENTS = [];').replace('<script src="data.js"></script>','<script>let DATA='+JSON.stringify(contacts)+';let DAILY_TASKS={date:"2026-10-02",tasks:[]};</script>');
  const d=new JSDOM(html,{runScripts:'dangerously',url:'https://fixture.test/comlist.html',beforeParse(w){Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.HTMLElement.prototype.scrollIntoView=function(){};for(const [k,v] of Object.entries(saved))w.localStorage.setItem(k,v);}});
  t.after(()=>d.window.close());d.window.todayISO=()=> '2026-10-02';return d.window;
}
const person=(n,cat='A',date='')=>({_row:n,_version:'fixture-'+n,'カテゴリー':cat,'名前(あだ名)':'Person'+n,'アクション日':date});
const tick=()=>new Promise(r=>setImmediate(r));
test('analytics KPI and unplanned list use the same people and label the action date',t=>{
  const w=app(t,[{...person(2),'アクション日':'2026-10-01','次会う日':'2026-12-01'},person(3,'B','2026-10-03'),person(4,'B')]);w.renderAnalytics();
  assert.equal(w.document.querySelector('[data-metric="unplanned"]').textContent,'2');
  assert.equal(w.document.querySelectorAll('[data-analysis-list="unplanned"] li button').length,2);
  assert.match(w.document.querySelector('[data-analysis-list="late"]').textContent,/アクション日.*2026-10-01/);
  assert.doesNotMatch(w.document.querySelector('[data-analysis-list="late"]').textContent,/2026-12-01/);
});
test('home keeps deadlines and schedule without the removed contact card',t=>{
  const w=app(t,[person(2)]);w.DAILY_TASKS={date:'2026-10-02',tasks:[{id:'due',type:'notion',section:'today',title:'期限'},{id:'old',type:'gmail',section:'selfOverdue',title:'超過',overdueDays:3},{id:'high',type:'notion',section:'todo',title:'高',priority:'high'}]};w.renderTodayTasks();
  assert.deepEqual(Array.from(w.document.querySelectorAll('#today-dashboard [data-section]')).slice(0,2).map(x=>x.dataset.section),['today','schedule']);
  assert.equal(w.document.querySelector('#today-dashboard [data-section=contacts]'),null);
  assert.equal(w.eval('DATA.length'),1);
  assert.equal(w.contactSuggestions('2026-10-02').length,1);
  assert.equal(w.document.querySelectorAll('.today-task-check').length,3);
  assert.equal(w.document.querySelectorAll('[data-important-task]').length,0);
  assert.ok(w.document.querySelector('[data-section="selfOverdue"]'));
});
test('task sync distinguishes local, saving, failed and acknowledged and retries retained pending writes',async t=>{
  const w=app(t);w.DAILY_TASKS={date:'2026-10-02',tasks:[{id:'t',type:'notion',section:'today',title:'T'}]};w.renderTodayTasks();
  w.setLocalTaskDone('t',true);await tick();assert.match(w.document.getElementById('task-sync-status').textContent,/この端末のみ/);
  w.setWriteToken('fixture');let release;w.fetch=()=>new Promise(r=>release=r);const retry=w.retryTaskSync();await tick();
  assert.match(w.document.getElementById('task-sync-status').textContent,/保存中/);release({json:async()=>({ok:false})});await retry;
  assert.match(w.document.getElementById('task-sync-status').textContent,/同期失敗/);assert.ok(w.pendingTaskState('2026-10-02').t);
  w.fetch=async()=>({json:async()=>({ok:true,date:'2026-10-02',done:{t:true}})});await w.retryTaskSync();
  assert.match(w.document.getElementById('task-sync-status').textContent,/同期済み/);assert.deepEqual(Object.keys(w.pendingTaskState('2026-10-02')),[]);
});
test('suggestions honor promises before category, skip future dates and already contacted today',t=>{
  const w=app(t,[person(2,'A','2026-10-10'),person(3,'D','2026-09-30'),person(4,'B','2026-10-02'),person(5,'A'),{...person(6,'A'),_contactState:{status:'contacted',date:'2026-10-02'}}]);
  const candidates=w.contactSuggestions('2026-10-02');assert.deepEqual(Array.from(candidates,x=>x.person._row),[3,4,5]);
  assert.match(candidates[0].reason,/アクション日.*2026-09-30/);assert.match(candidates[2].reason,/A.*14日/);
});
test('contact record requires explicit click, cancellation sends nothing, retry retains request identity and preserves profile/schedule',async t=>{
  const original={...person(2,'A','2026-10-01'),'次会う日':'2026-11-01','履歴':'9/1 会食','仕事(O)':'Engineer'};
  const w=app(t,[original]);await w.initializeSavedState('fixture-pass','2026-10-02');w.setWriteToken('fixture');let bodies=[];w.fetch=async(_u,o)=>{bodies.push(JSON.parse(o.body));throw Error('offline');};
  w.confirm=()=>false;await w.recordContactAction(w.eval('DATA[0]'),'contacted');assert.equal(bodies.length,0);
  w.confirm=()=>true;await w.recordContactAction(w.eval('DATA[0]'),'waiting');assert.equal(bodies.length,1);assert.match(w.document.getElementById('contact-action-status').textContent,/同期失敗/);
  const snapshot=Object.fromEntries(Array.from({length:w.localStorage.length},(_,i)=>{const k=w.localStorage.key(i);return [k,w.localStorage.getItem(k)];}));
  assert.ok(!JSON.stringify(snapshot).includes('Engineer'));
  const v=app(t,[original],snapshot);await v.initializeSavedState('fixture-pass','2026-10-02');v.fetch=async(_u,o)=>{bodies.push(JSON.parse(o.body));return {json:async()=>({ok:true,row:2,version:'new-version',updated:{},contactState:{status:'waiting',date:'2026-10-02'}})};};
  await v.retryContactAction();assert.equal(bodies[1].requestId,bodies[0].requestId);assert.equal(v.eval('DATA[0]["仕事(O)"]'),'Engineer');assert.equal(v.eval('DATA[0]["次会う日"]'),'2026-11-01');assert.equal(v.eval('DATA[0]["履歴"]'),'9/1 会食');assert.equal(v.eval('DATA[0]._contactState.status'),'waiting');
});
test('successful record re-enables panel actions so a subsequent status can be recorded',async t=>{
  const w=app(t,[person(2)]);w.setWriteToken('fixture');w.confirm=()=>true;
  w.eval('SELECTED=plantKey(DATA[0]);setView("garden")');
  w.fetch=async(_u,o)=>{const b=JSON.parse(o.body);return {json:async()=>({ok:true,row:2,version:'updated',contactState:{status:b.status,date:b.date},updated:{}})};};
  await w.recordContactAction(w.eval('DATA[0]'),'contacted');
  assert.equal(w.document.querySelector('#gdpanel [data-contact-status="planning"]').disabled,false);
  await w.recordContactAction(w.eval('DATA[0]'),'planning');assert.equal(w.eval('DATA[0]._contactState.status'),'planning');assert.equal(w.eval('PANEL_EDIT'),true);
});
test('recording uses the actual local day even when the published task date is older; full-year history shows the last entry',async t=>{
  const w=app(t,[person(2)]);w.DAILY_TASKS={date:'2026-10-01',tasks:[]};w.setWriteToken('fixture');w.confirm=()=>true;let body;
  w.fetch=async(_u,o)=>{body=JSON.parse(o.body);return {json:async()=>({ok:true,row:2,version:'updated',contactState:{status:body.status,date:body.date},updated:{}})};};
  await w.recordContactAction(w.eval('DATA[0]'),'waiting');assert.equal(body.date,'2026-10-02');
  assert.equal(w.lastHistory({'履歴':'9/1 会食 2026/10/2 連絡'}),'2026/10/2 連絡');
});
test('retrying a pending contact action cannot erase an open editor draft',async t=>{
  const w=app(t,[person(2)]);w.setWriteToken('fixture');w.confirm=()=>true;let calls=0;
  w.fetch=async()=>{calls++;throw Error('offline');};await w.recordContactAction(w.eval('DATA[0]'),'waiting');
  w.eval('SELECTED=plantKey(DATA[0]);PANEL_EDIT_KEY=SELECTED;PANEL_EDIT=true;setView("garden")');w.document.getElementById('ge-nw').value='Keep draft';
  await w.retryContactAction();assert.equal(calls,1);assert.equal(w.document.getElementById('ge-nw').value,'Keep draft');
});
test('a receipt replay restores the full current record so its new version cannot authorize stale schedule fields',async t=>{
  const w=app(t,[{...person(2),'次会う日':'2026/11/01'}]);w.setWriteToken('fixture');w.confirm=()=>true;w.fetch=async()=>{throw Error('response lost');};await w.recordContactAction(w.eval('DATA[0]'),'waiting');
  const record={...person(2),_version:'current','次会う日':'2027/01/01','仕事(O)':'Other device',_contactState:{status:'waiting',date:'2026-10-02'}};
  w.fetch=async()=>({json:async()=>({ok:true,row:2,version:'current',updated:{},contactState:record._contactState,record})});await w.retryContactAction();
  assert.equal(w.eval('DATA[0]["次会う日"]'),'2027/01/01');assert.equal(w.eval('DATA[0]["仕事(O)"]'),'Other device');assert.equal(w.eval('DATA[0]._version'),'current');
});

test('legacy synced excluded member cannot reappear or lower team HP; original data stays intact',t=>{const w=app(t),chef='シェフ富徳',tasks=[{id:'chef',type:'gmail',title:'excluded fixture',owner:chef,section:'memberOverdue',overdueDays:2},{id:'other',type:'gmail',title:'retained fixture',owner:chef+'2',section:'memberOverdue',overdueDays:2}];w.DAILY_TASKS={date:'2026-10-02',tasks,hp:{selfOverdue:0,memberOverdue:2}};w.renderTodayTasks();assert.equal(w.document.querySelectorAll('[data-task-id="chef"]').length,0);assert.ok(w.document.querySelector('[data-task-id="other"]'));assert.match(w.document.querySelector('.today-teamhp-value').textContent,/95 \/ 100/);w.renderTodayTasks();assert.equal(w.todayData().tasks.length,1);assert.equal(w.DAILY_TASKS.tasks.length,2);});
