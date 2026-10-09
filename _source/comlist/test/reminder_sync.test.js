'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
function client(t){const {JSDOM}=require('jsdom'),html=require('../app_sources').readApp('_assets/list.html').replace('<script src="data.js"></script>','<script>let DATA=[];let DAILY_TASKS=[];</script>');const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost'});t.after(()=>dom.window.close());const w=dom.window;Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.SAVED_SESSION={};w.persistSavedState=async()=>true;w.getWriteToken=()=>'fixture';w.MEETING_REMINDERS=[];w.MeetingRemindersModel.update(w.MEETING_REMINDERS,[{_row:2,'名前(あだ名)':'Fixture','次会う日':w.MeetingRemindersModel.shift(w.meetingReminderToday(),7)}],w.meetingReminderToday());return w;}
test('完了状態を別端末に共有し、送信IDは名前を含まない',async t=>{
 const a=client(t),b=client(t),done={},calls=[];
 for(const w of [a,b])w.fetch=async(_url,opts)=>{const body=JSON.parse(opts.body);calls.push(body);if(body.op==='set')done[body.id]=true;return {json:async()=>({ok:true,version:1,done:Object.fromEntries(body.ids?body.ids.filter(id=>done[id]).map(id=>[id,true]):[[body.id,true]])})};};
 await a.completeMeetingReminder(a.MEETING_REMINDERS[0].id);await b.syncMeetingReminders();
 assert.equal(b.MEETING_REMINDERS[0].done,true);assert.equal(b.document.querySelector('.tab[data-view="garden"] .meeting-new-badge'),null);
 assert.ok(calls.every(c=>c.action==='reminderState'));assert.ok(calls.filter(c=>c.id).every(c=>/^[a-f0-9]{64}$/.test(c.id)));assert.doesNotMatch(JSON.stringify(calls),/Fixture/);
});
test('送信失敗はバッジを残し、再試行・旧端末の完了記録の移行で同期する',async t=>{
 const w=client(t);let fail=true;w.fetch=async(_url,opts)=>{if(fail)throw Error('offline');const body=JSON.parse(opts.body);return {json:async()=>({ok:true,version:1,done:body.op==='set'?{[body.id]:true}:{}})};};
 await w.completeMeetingReminder(w.MEETING_REMINDERS[0].id);assert.equal(w.MEETING_REMINDERS[0].done,true);assert.ok(w.document.querySelector('.tab[data-view="garden"] .meeting-new-badge'));
 fail=false;await w.syncMeetingReminders();assert.equal(w.MEETING_REMINDERS[0].synced,true);assert.equal(w.document.querySelector('.tab[data-view="garden"] .meeting-new-badge'),null);
 w.MEETING_REMINDERS[0].synced=undefined;await w.syncMeetingReminders();assert.equal(w.MEETING_REMINDERS[0].synced,true);
});
test('日次タスクの保存期限とは独立してリマインドを保存し、不正IDを拒否する',()=>{
 const store={},props={getProperty:k=>store[k]||null,setProperty:(k,v)=>store[k]=v,getProperties:()=>({...store})},ctx={PropertiesService:{getScriptProperties:()=>props},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('sheet-api.gs','utf8'),ctx);
 const id='a'.repeat(64);assert.equal(ctx.reminderState_({op:'set',id,done:true}).ok,true);assert.equal(ctx.reminderState_({op:'get',ids:[id]}).done[id],true);assert.equal(ctx.reminderState_({op:'set',id:'name',done:true}).ok,false);assert.equal(ctx.reminderState_({op:'set',id,done:false}).ok,false);assert.equal(ctx.reminderState_({op:'get',ids:Array(101).fill(id)}).ok,false);
});
