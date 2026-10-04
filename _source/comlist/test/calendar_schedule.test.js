'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeCalendar,applyCalendarSchedule}=require('../calendar_schedule');
const base={tasks:[{id:'notion:kept',type:'notion',title:'保持するタスク'},{id:'calendar:old',type:'calendar',title:'予定'}],calendar:[{title:'予定'}],sources:{calendar:{ok:true},notion:{ok:true},gmail:{ok:true}}};
const row=(id,start,end,extra={})=>[start,end,{source:'primary',eventId:id,title:'FIXTURE_PRIVATE_TITLE_'+id,location:'FIXTURE_PRIVATE_PLACE',description:'FIXTURE_PRIVATE_DESCRIPTION',detailsAvailable:true,allDay:false,...extra}];
test('JSTの日またぎ予定・当日・未来を原本の詳細から構成し、原稿の仮題へ依存しない',()=>{
 const rows=[row('multi','2026-10-03T00:00','2026-10-04T23:59'),row('today','2026-10-04T08:00','2026-10-04T08:30',{location:'',description:'   '}),row('future','2026-10-05T09:00','2026-10-05T10:00'),row('finished','2026-10-03T22:00','2026-10-04T00:00')];
 const out=applyCalendarSchedule(base,rows,'2026-10-04');assert.equal(out.calendar.length,2);assert.equal(out.calendar[0].time,'10/03 00:00〜10/04 23:59（継続中）');assert.equal(out.calendar[1].time,'08:00〜08:30');assert.equal(out.calendar[1].description,'');assert.equal(out.calendar[0].title,'FIXTURE_PRIVATE_TITLE_multi');assert.ok(out.tasks.some(t=>t.id==='notion:kept'));assert.equal(out.tasks.filter(t=>t.type==='calendar').length,1);assert.equal(out.tasks.at(-1).due,'2026-10-05');assert.equal(base.calendar[0].title,'予定');
});
test('終日は終了日を排他的に扱い、終了後・翌日の予定を今日に混ぜない',()=>{
 const out=applyCalendarSchedule(base,[row('day','2026-10-03T00:00','2026-10-05T00:00',{allDay:true}),row('tomorrow','2026-10-05T00:00','2026-10-06T00:00',{allDay:true})],'2026-10-04');assert.equal(out.calendar.length,1);assert.equal(out.calendar[0].time,'終日（10/03〜10/04）');
});
test('旧時刻配列では確認済み原稿を保持し、権限不足の詳細は推測しない',()=>{
 assert.equal(applyCalendarSchedule(base,[['2026-10-04T09:00','2026-10-04T10:00']],'2026-10-04'),base);
 const e=normalizeCalendar([row('restricted','2026-10-04T09:00','2026-10-04T10:00',{detailsAvailable:false})])[0];assert.equal(e.title,'予定名未取得');assert.equal(e.location,'');assert.equal(e.description,'');
});
test('本人メイン以外・不正日付・逆転・重複IDを拒否し、空の原本は古い予定を消す',()=>{
 assert.throws(()=>normalizeCalendar([row('x','2026-02-30T09:00','2026-03-01T10:00')]));assert.throws(()=>normalizeCalendar([row('x','2026-10-04T10:00','2026-10-04T09:00')]));assert.throws(()=>normalizeCalendar([row('x','2026-10-04T09:00','2026-10-04T10:00',{source:'shared'})]));assert.throws(()=>normalizeCalendar([row('x','2026-10-04T09:00','2026-10-04T10:00'),row('x','2026-10-04T11:00','2026-10-04T12:00')]));assert.deepEqual(applyCalendarSchedule(base,[],'2026-10-04').calendar,[]);
});
