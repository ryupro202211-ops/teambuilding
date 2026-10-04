'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');
const {JSDOM}=require('jsdom');
const initial=[{_row:2,_version:'fixture-version','カテゴリー':'A','名前(あだ名)':'Fixture','アクション日':'2026/01/01'}];
function app(t,saved={}){
  const html=require("../app_sources").readApp('_assets/list.html').replace(/const EVENTS = \[[\s\S]*?\];/, 'const EVENTS = [];').replace('<script src="data.js"></script>','<script>let DATA='+JSON.stringify(initial)+';let DAILY_TASKS={date:"2026-01-01",tasks:[]};</script>');
  const d=new JSDOM(html,{runScripts:'dangerously',url:'https://fixture.test/comlist.html',beforeParse(w){Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.HTMLElement.prototype.scrollIntoView=function(){};for(const [k,v] of Object.entries(saved))w.localStorage.setItem(k,v);}});
  t.after(()=>d.window.close());return d.window;
}
const snapshot=w=>Object.fromEntries(Array.from({length:w.localStorage.length},(_,i)=>{const k=w.localStorage.key(i);return [k,w.localStorage.getItem(k)];}));
const data=w=>JSON.parse(w.eval('JSON.stringify(DATA)'));
test('saved contacts survive a new page and failed sheet refresh without plaintext storage',async t=>{
  const w=app(t);await w.initializeSavedState('fixture-pass','2026-01-01');
  w.eval('DATA[0]["アクション日"]="2026/01/03"');await w.persistSavedState();
  const saved=snapshot(w);assert.ok(!JSON.stringify(saved).includes('Fixture'));
  const v=app(t,saved);await v.initializeSavedState('fixture-pass','2026-01-01');v.setWriteToken('fixture-token');v.fetch=async()=>{throw Error('offline')};await v.refreshRegisteredPeople();assert.equal(data(v)[0]['アクション日'],'2026/01/03');
});
test('cache persists contact additions and event deletion',async t=>{
  const w=app(t);await w.initializeSavedState('fixture-pass','2026-01-01');
  w.eval('DATA.push({_row:3,"カテゴリー":"B","名前(あだ名)":"Added"}); EVENTS.splice(0,EVENTS.length)');await w.persistSavedState();
  const v=app(t,snapshot(w));await v.initializeSavedState('fixture-pass','2026-01-01');assert.equal(data(v).length,2);assert.equal(v.eval('EVENTS.length'),0);
});
test('corrupt cache and wrong passphrase fall back to initial data',async t=>{
  const w=app(t);await w.initializeSavedState('fixture-pass','2026-01-01');await w.persistSavedState();
  const saved=snapshot(w),key=Object.keys(saved).find(k=>k.startsWith('comlist-cache:'));
  assert.ok(key);for(const altered of [{...saved,[key]:'{bad'},saved]){const v=app(t,altered);await v.initializeSavedState('wrong-pass','2026-01-01');assert.deepEqual(data(v),initial);}
});
test('older daily cache cannot overwrite a newer published day',async t=>{
  const w=app(t);await w.initializeSavedState('fixture-pass','2026-01-01');w.eval('DATA[0]["メモ"]="old cache"');await w.persistSavedState();
  const v=app(t,snapshot(w));await v.initializeSavedState('fixture-pass','2026-01-02');assert.deepEqual(data(v),initial);
});
test('failed uncheck survives reload and overrides stale remote true',async t=>{
  const w=app(t);w.setWriteToken('fixture-token');w.DAILY_TASKS={date:'2026-01-01',tasks:[{id:'t',type:'notion',title:'Task',section:'today'}]};w.localStorage.setItem('daily-task:2026-01-01','{"t":true}');w.fetch=async()=>{throw Error('offline')};w.setLocalTaskDone('t',false);await new Promise(r=>setImmediate(r));
  const v=app(t,snapshot(w));v.DAILY_TASKS=w.DAILY_TASKS;v.fetch=async(_url,opt)=>({json:async()=>({ok:true,date:'2026-01-01',done:JSON.parse(opt.body).op==='get'?{t:true}:{}})});await v.syncTaskState();assert.notEqual(v.localTaskState().t,true);
});
test('localStorage write failure does not throw or prevent visible task update',t=>{
  const w=app(t);w.DAILY_TASKS={date:'2026-01-01',tasks:[{id:'t',type:'notion',title:'Task',section:'today'}]};w.renderTodayTasks();Object.getPrototypeOf(w.localStorage).setItem=function(){throw Error('quota')};assert.doesNotThrow(()=>w.setLocalTaskDone('t',true));assert.equal(w.document.querySelector('.today-task-check').checked,true);assert.equal(w.localTaskState().t,true);
});
test('actual schedule save is cached before the editor closes',async t=>{
  const w=app(t);await w.initializeSavedState('fixture-pass','2026-01-01');w.setWriteToken('fixture-token');
  w.eval('SELECTED=plantKey(DATA[0]);PANEL_EDIT_KEY=SELECTED;PANEL_EDIT=true;setView("garden")');w.document.getElementById('ge-ad').value='2026-01-03';
  w.fetch=async()=>({json:async()=>({ok:true,row:2,updated:{'アクション日':'2026/01/03'}})});w.eval('saveEdit(DATA[0])');
  for(let i=0;i<50&&w.eval('PANEL_EDIT');i++)await new Promise(r=>setTimeout(r,20));
  assert.equal(w.eval('PANEL_EDIT'),false);const v=app(t,snapshot(w));await v.initializeSavedState('fixture-pass','2026-01-01');assert.equal(data(v)[0]['アクション日'],'2026/01/03');
});
test('successful sheet refresh including cleared fields survives the next offline reload',async t=>{
  const w=app(t);await w.initializeSavedState('fixture-pass','2026-01-01');w.setWriteToken('fixture-token');const records=[{...initial[0],'メモ':'latest'}];w.fetch=async()=>({json:async()=>({ok:true,records})});await w.refreshRegisteredPeople();
  const v=app(t,snapshot(w));await v.initializeSavedState('fixture-pass','2026-01-01');assert.deepEqual(data(v),records);
});
test('a read begun before a local operation cannot restore the previous check',async t=>{
  const w=app(t);w.setWriteToken('fixture-token');w.DAILY_TASKS={date:'2026-01-01',tasks:[{id:'t',type:'notion',title:'Task',section:'today'}]};let release;
  w.fetch=async(_url,opt)=>JSON.parse(opt.body).op==='get'?await new Promise(r=>release=r):{json:async()=>({ok:true,date:'2026-01-01',done:{}})};
  const syncing=w.syncTaskState();w.setLocalTaskDone('t',false);await new Promise(r=>setImmediate(r));release({json:async()=>({ok:true,date:'2026-01-01',done:{t:true}})});await syncing;assert.notEqual(w.localTaskState().t,true);
});
test('remote uncheck wins over an acknowledged local check with no pending edits',async t=>{
  const w=app(t);w.setWriteToken('fixture-token');w.DAILY_TASKS={date:'2026-01-01',tasks:[{id:'t',type:'notion',title:'Task',section:'today'}]};let remote={};
  w.fetch=async(_url,opt)=>{const b=JSON.parse(opt.body);if(b.op==='set'){if(b.done)remote[b.id]=true;else delete remote[b.id];}return {json:async()=>({ok:true,date:'2026-01-01',done:remote})};};
  w.setLocalTaskDone('t',true);await new Promise(r=>setImmediate(r));remote={};await w.syncTaskState();assert.notEqual(w.localTaskState().t,true);
});

test('a read begun during a write cannot undo the write after its acknowledgment',async t=>{
  const w=app(t);w.setWriteToken('fixture-token');w.DAILY_TASKS={date:'2026-01-01',tasks:[{id:'t',type:'notion',title:'Task',section:'today'}]};let releaseSet,releaseGet;
  w.fetch=(_url,opt)=>new Promise(resolve=>{if(JSON.parse(opt.body).op==='set')releaseSet=resolve;else releaseGet=resolve;});
  w.setLocalTaskDone('t',true);await new Promise(r=>setImmediate(r));const syncing=w.syncTaskState();
  releaseSet({json:async()=>({ok:true,date:'2026-01-01',done:{t:true}})});await w.TASK_PUSH_QUEUE['2026-01-01|t'];
  releaseGet({json:async()=>({ok:true,date:'2026-01-01',done:{}})});await syncing;assert.equal(w.localTaskState().t,true);
});

test('a late refresh cannot replace the people held by an open bulk editor',async t=>{
  const w=app(t);await w.initializeSavedState('fixture-pass','2026-01-01');w.setWriteToken('fixture-token');w.confirm=()=>true;
  let releaseRead;w.fetch=(_url,opt)=>JSON.parse(opt.body).action==='read'?new Promise(resolve=>releaseRead=resolve):Promise.resolve({json:async()=>({ok:true,results:[{ok:true,row:2,updated:{'アクション内容':'Bulk saved'}}]})});
  const refreshing=w.refreshRegisteredPeople();w.eval('BULK_LIST=[DATA[0]]');const dialog=w.document.getElementById('bulk-dialog');dialog.open=true;dialog.close=()=>{dialog.open=false};
  w.document.getElementById('bulk-rows').innerHTML=w.eval('BULK_LIST.map(bulkRowHTML).join("")');w.document.getElementById('br0-ac').value='Bulk saved';
  releaseRead({json:async()=>({ok:true,records:[{...initial[0]}]})});await refreshing;w.saveBulk();
  for(let i=0;i<50&&dialog.open;i++)await new Promise(r=>setTimeout(r,20));assert.equal(dialog.open,false);assert.equal(data(w)[0]['アクション内容'],'Bulk saved');
  const v=app(t,snapshot(w));await v.initializeSavedState('fixture-pass','2026-01-01');assert.equal(data(v)[0]['アクション内容'],'Bulk saved');
});
test('switching away during a schedule write still protects its object from a late refresh',async t=>{
  const w=app(t);w.setWriteToken('fixture-token');w.eval('SELECTED=plantKey(DATA[0]);PANEL_EDIT_KEY=SELECTED;PANEL_EDIT=true;setView("garden")');w.document.getElementById('ge-ad').value='2026-01-03';let release;
  w.fetch=(_u,o)=>JSON.parse(o.body).action==='read'?Promise.resolve({json:async()=>({ok:true,records:initial.map(p=>({...p}))})}):new Promise(r=>release=r);
  w.eval('saveEdit(DATA[0]);PANEL_EDIT=false');await w.refreshRegisteredPeople();release({json:async()=>({ok:true,row:2,version:'new',updated:{'アクション日':'2026/01/03'}})});
  await new Promise(r=>setImmediate(r));assert.equal(data(w)[0]['アクション日'],'2026/01/03');
});


test('same-day cached edits cannot hide newly published read-only friendship advice',async t=>{
 const w=app(t);await w.initializeSavedState('fixture-pass','2026-01-01');w.eval('DATA[0]["仕事(O)"]="cached edit"');await w.persistSavedState();
 const v=app(t,snapshot(w));v.eval('DATA[0]["仲間づくりアドバイス"]="new published advice"');await v.initializeSavedState('fixture-pass','2026-01-01');assert.equal(data(v)[0]['仲間づくりアドバイス'],'new published advice');assert.equal(data(v)[0]['仕事(O)'],'cached edit');
});
