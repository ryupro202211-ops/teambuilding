'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),{webcrypto}=require('node:crypto');
const {readApp}=require('../app_sources'),M=require('../_assets/js/field-model');
function page(t,request,realPersistence=false){
 const html=readApp('_assets/list.html').replace(/const EVENTS = \[[\s\S]*?\];/,'const EVENTS = [];').replace('<script src="data.js"></script>','<script>let DATA=[{_row:2,"カテゴリー":"A","名前(あだ名)":"Fixture"}];let DAILY_TASKS={date:"2026-10-03",tasks:[]};</script>');
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://fixture.test/comlist.html',beforeParse(w){w.structuredClone=structuredClone;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;Object.defineProperty(w,'crypto',{value:webcrypto});w.fetch=async (_url,options)=>({json:async()=>request(JSON.parse(options.body))});w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};}});t.after(()=>dom.window.close());
 const w=dom.window;w.localStorage.setItem('comunitylisttolevel9','fixture-token');if(!realPersistence)w.persistSavedState=async()=>true;return w;
}
function server(){let state=M.empty(),version='v1',requestId='',writes=0,offline=false,lose=false;const calls=[];return {get state(){return state;},get writes(){return writes;},calls,set offline(v){offline=v;},set lose(v){lose=v;},request(b){calls.push(b);if(offline)throw Error('offline');if(b.action==='fieldGoalsRead')return {ok:true,state:structuredClone(state),version,requestId};if(b.action==='fieldGoalsWrite'){if(b.requestId===requestId)return {ok:true,state:structuredClone(state),version,requestId};if(b.version!==version)return {ok:false,error:'conflict'};state=M.validate(b.state);version='v'+(Number(version.slice(1))+1);requestId=b.requestId;writes++;if(lose){lose=false;throw Error('response lost');}return {ok:true,state:structuredClone(state),version,requestId};}return {ok:false};}};}
const desired=n=>({goals:{'2026-10':{prospects:n,metrics:{}}},persons:[],records:[]});
test('カレンダーから選んだ日に確定予定を追加し、同じ記録を変更・取消できる',async t=>{
 const s=server(),w=page(t,b=>s.request(b));await w.refreshFieldGoals();
 const day=w.FieldCalendarModel.shift(w.fieldGoalsToday(),1),month=day.slice(0,7);w.fieldMonthSelection=month;w.renderFieldProgress();
 const selectDay=()=>w.document.querySelector('[data-fc-day="'+day+'"]').click();
 selectDay();assert.equal(s.writes,0);assert.equal(w.document.querySelectorAll('[data-field-day-add]').length,5);
 w.document.querySelector('[data-field-day-add="individual"]').click();
 assert.equal(w.document.querySelector('[name=date]').value,day);assert.equal(w.document.querySelector('[name=dueDate]').value,day);assert.equal(w.document.querySelector('[name=status]').value,'confirmed');
 w.document.querySelector('[name=person]').value='row:2';w.document.querySelector('[name=purpose]').value='Fixture meeting';
 await w.document.querySelector('#field-goal-dialog form').onsubmit({preventDefault(){}});
 assert.equal(s.state.records.length,1);assert.equal(w.FieldCalendarModel.daily(s.state,day,w.fieldGoalsToday()).individual.planned,1);
 const id=s.state.records[0].id;selectDay();w.document.querySelector('[data-field-day-edit]').click();assert.equal(w.document.querySelector('[name=purpose]').value,'Fixture meeting');
 w.document.querySelector('[name=status]').value='cancelled';await w.document.querySelector('#field-goal-dialog form').onsubmit({preventDefault(){}});
 assert.equal(s.state.records.length,1);assert.equal(s.state.records[0].id,id);assert.equal(w.FieldCalendarModel.daily(s.state,day,w.fieldGoalsToday()).individual.planned,0);
 selectDay();w.document.querySelector('[data-cancel]').click();assert.equal(w.FIELD_GOALS_EDITING,false);assert.equal(s.writes,2);
 w.FIELD_GOALS_BUSY=true;w.renderFieldProgress();assert.equal(w.document.querySelector('[data-fc-day="'+day+'"]').disabled,true);
});
test('2端末同時編集は片方だけ保存し、競合入力を保持して取消後に再取得する',async t=>{
 const s=server(),a=page(t,b=>s.request(b)),b=page(t,x=>s.request(x));await a.refreshFieldGoals();await b.refreshFieldGoals();await a.saveFieldGoals(desired(4));await b.saveFieldGoals(desired(5));assert.equal(s.writes,1);assert.equal(s.state.goals['2026-10'].prospects,4);assert.equal(b.FIELD_GOALS_PENDING.state.goals['2026-10'].prospects,5);assert.match(b.FIELD_GOALS_PHASE,/競合/);await b.retryFieldGoals();assert.equal(s.writes,1);
 b.renderFieldProgress();b.document.getElementById('field-goals-discard').click();await new Promise(r=>setTimeout(r,5));assert.equal(b.FIELD_GOALS_PENDING,null);assert.equal(b.FIELD_GOALS_STATE.goals['2026-10'].prospects,4);
});
test('通信失敗・応答消失・反復操作は同じIDで再試行し実記録を重複させない',async t=>{
 const s=server(),w=page(t,b=>s.request(b));await w.refreshFieldGoals();s.offline=true;await w.saveFieldGoals(desired(3));assert.match(w.FIELD_GOALS_PHASE,/同期失敗/);const id=w.FIELD_GOALS_PENDING.requestId;await w.saveFieldGoals(desired(6));assert.equal(w.FIELD_GOALS_PENDING.requestId,id);s.offline=false;s.lose=true;await w.retryFieldGoals();assert.equal(s.writes,1);assert.equal(w.FIELD_GOALS_PENDING.requestId,id);await w.retryFieldGoals();assert.equal(s.writes,1);assert.equal(w.FIELD_GOALS_PENDING,null);assert.match(w.FIELD_GOALS_PHASE,/同期済み/);
});
test('応答消失後の再読込は暗号化cacheからpendingを復元し、サーバー読取で保存済みと確認する',async t=>{
 const s=server(),a=page(t,b=>s.request(b),true);
 await a.initializeSavedState('fixture-pass','2026-10-03');await a.refreshFieldGoals();s.lose=true;await a.saveFieldGoals(desired(4));assert.ok(a.FIELD_GOALS_PENDING);
 const envelope=a.localStorage.getItem(a.cacheKey());assert.ok(envelope);assert.ok(!envelope.includes('prospects'));const b=page(t,x=>s.request(x),true);b.localStorage.setItem(b.cacheKey(),envelope);await b.initializeSavedState('fixture-pass','2026-10-04');assert.ok(b.FIELD_GOALS_PENDING);assert.equal(b.FIELD_GOALS_PENDING.requestId,a.FIELD_GOALS_PENDING.requestId);await b.refreshFieldGoals();assert.equal(b.FIELD_GOALS_PENDING,null);assert.equal(s.writes,1);assert.equal(b.FIELD_GOALS_STATE.goals['2026-10'].prospects,4);
});
test('相手と目的の入力・キャンセルで記録を勝手に作らず、人脈・単位・未報告を表示する',t=>{
 const s=server(),w=page(t,b=>s.request(b));w.renderFieldProgress();const text=w.document.getElementById('fieldwrap').textContent;assert.match(text,/3人/);assert.match(text,/未報告/);assert.match(text,/月内1人/);assert.equal(w.fieldUnit('orientation'),'人');assert.equal(w.fieldUnit('introductions'),'件');w.openFieldRecordEditor(w.fieldGoalsToday().slice(0,7),null,'individual',2);assert.equal(w.document.querySelector('[name=person]').value,'row:2');assert.equal(w.document.querySelector('[name=kind]').value,'individual');w.document.querySelector('[data-cancel]').click();assert.equal(w.FIELD_GOALS_EDITING,false);assert.equal(w.FIELD_GOALS_PENDING,null);assert.equal(s.writes,0);
});
test('古い読取結果は編集中のフォームや保存開始後の内容を上書きしない',async t=>{
 let resolve;const w=page(t,()=>new Promise(r=>resolve=r));const read=w.refreshFieldGoals();await new Promise(r=>setImmediate(r));w.openFieldGoalEditor(w.fieldGoalsToday().slice(0,7));w.document.querySelector('[name=prospects]').value='9';resolve({ok:true,state:M.empty(),version:'v1'});await read;assert.equal(w.document.querySelector('[name=prospects]').value,'9');assert.equal(w.FIELD_GOALS_VERSION,null);
});
test('月達成のお祝いは確認済みだけに1度、再読込・再同期・取消後の再達成で再発火しない',async t=>{
 const s=server(),a=page(t,b=>s.request(b),true),date=a.fieldGoalsToday(),m=date.slice(0,7);await a.initializeSavedState('fixture-pass',date);
 const persons=[1,2,3].map(n=>({id:'person-fixture-000'+n,name:'Fixture '+n,row:n+1})),records=persons.map((p,i)=>({id:'record-fixture-000'+(i+1),personId:p.id,kind:'introductions',status:'completed',date,dueDate:date,purpose:'確認済み紹介',outcomeConfirmed:true,newPersonForMonth:false}));
 a.FIELD_GOALS_STATE=M.validate({goals:{},persons,records});a.FIELD_GOALS_VERSION='v1';a.FIELD_GOALS_PHASE='同期済み';a.renderFieldProgress();await new Promise(r=>setTimeout(r,50));await a.SAVED_QUEUE;assert.equal(a.FIELD_MISSION_CELEBRATED['month:'+m],true);assert.match(a.document.getElementById('field-mission-announcement').textContent,/おめでとう/);
 a.renderFieldProgress();assert.equal(a.document.getElementById('field-mission-announcement').textContent,'');const envelope=a.localStorage.getItem(a.cacheKey());assert.ok(!envelope.includes('Fixture 1'));
 const b=page(t,x=>s.request(x),true);b.localStorage.setItem(b.cacheKey(),envelope);await b.initializeSavedState('fixture-pass',date);b.renderFieldProgress();assert.equal(b.FIELD_MISSION_CELEBRATED['month:'+m],true);assert.equal(b.document.getElementById('field-mission-announcement').textContent,'');
 b.FIELD_GOALS_STATE.records[0].status='cancelled';b.FIELD_GOALS_STATE.records[0].outcomeConfirmed=false;b.renderFieldProgress();assert.equal(b.document.getElementById('field-month-celebration'),null);b.FIELD_GOALS_STATE.records[0].status='completed';b.FIELD_GOALS_STATE.records[0].outcomeConfirmed=true;b.renderFieldProgress();assert.equal(b.document.getElementById('field-mission-announcement').textContent,'');
});
test('動きを減らす設定は暗号化で保持され、未同期の達成には演出を付けない',async t=>{
 const s=server(),w=page(t,b=>s.request(b),true),date=w.fieldGoalsToday();await w.initializeSavedState('fixture-pass',date);w.FIELD_MISSION_REDUCE_MOTION=true;await w.persistSavedState();w.renderFieldProgress();assert.equal(w.document.getElementById('field-reduce-motion'),null);assert.ok(w.document.getElementById('field-mission-board').classList.contains('reduced-motion'));
 const v=page(t,x=>s.request(x),true);v.localStorage.setItem(v.cacheKey(),w.localStorage.getItem(w.cacheKey()));await v.initializeSavedState('fixture-pass',date);assert.equal(v.FIELD_MISSION_REDUCE_MOTION,true);
 w.FIELD_GOALS_PENDING={state:desired(3),version:'v1',requestId:'request-fixture-0001'};await w.maybeCelebrateFieldMission(date.slice(0,7));assert.deepEqual(Object.keys(w.FIELD_MISSION_CELEBRATED),[]);
});
test('合言葉のない端末では未送信の下書きを続けて編集でき、明示した同期でだけ送る',async t=>{
 const s=server(),w=page(t,b=>s.request(b));w.localStorage.removeItem('comunitylisttolevel9');await w.saveFieldGoals(desired(3));const id=w.FIELD_GOALS_PENDING.requestId;assert.equal(w.FIELD_GOALS_PENDING.sent,false);assert.equal(w.fieldGoalsEditingBlocked(),false);await w.saveFieldGoals(desired(4));assert.equal(w.FIELD_GOALS_PENDING.requestId,id);assert.equal(w.FIELD_GOALS_PENDING.state.goals['2026-10'].prospects,4);assert.equal(s.writes,0);assert.match(w.FIELD_GOALS_PHASE,/この端末のみ/);w.localStorage.setItem('comunitylisttolevel9','fixture-token');await w.retryFieldGoals();assert.equal(s.writes,1);assert.equal(w.FIELD_GOALS_PENDING,null);assert.equal(s.state.goals['2026-10'].prospects,4);
});
