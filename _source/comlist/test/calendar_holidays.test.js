'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),A=require('../_assets/js/calendar-availability');
function candidates(date,events=[],excludedDates=[]){const now=A.wall(date+'T00:00');return A.compute({events,info:{source:'primary',fetchedAt:new Date(now).toISOString(),rangeStart:new Date(now).toISOString(),rangeEnd:new Date(A.rangeEnd(now)).toISOString(),complete:true}},{weekday:[[720,810]],weekend:[[480,1440]],buffer:0,confirmed:true,excludedDates},now).slots.filter(s=>s.date===date);}
test('スポーツの日は平日でも土日設定を使う',()=>{
 const year=new Date().getFullYear(),first=new Date(Date.UTC(year,9,1)),secondMonday=1+(8-first.getUTCDay())%7+7,date=year+'-10-'+String(secondMonday).padStart(2,'0');
 assert.equal(A.holidayName(date),'スポーツの日');assert.equal(candidates(date)[0].start,A.wall(date+'T08:00'));assert.equal(candidates(date).length,10);
});
test('振替休日・国民の休日にも対応し、通常の平日は平日設定を維持する',()=>{
 for(const date of ['2025-02-24','2026-09-22']){assert.equal(A.holidayName(date),'休日');assert.equal(candidates(date).length,10);}
 assert.equal(A.holidayName('2026-10-07'),'');assert.equal(candidates('2026-10-07')[0].start,A.wall('2026-10-07T12:00'));
});
test('祝日でも予定・除外日を優先する',()=>{
 const date='2026-09-22';assert.equal(candidates(date,[],[date]).length,0);
 assert.equal(candidates(date,[[date+'T00:00','2026-09-23T00:00',{allDay:true}]]).length,0);
});
test('未公表の年を祝日なしと判断しない',()=>{
 const date=(A.holidayLastYear+1)+'-01-01',now=A.wall(date+'T00:00');
 const result=A.compute({events:[],info:{source:'primary',fetchedAt:new Date(now).toISOString(),rangeStart:new Date(now).toISOString(),rangeEnd:new Date(A.rangeEnd(now)).toISOString(),complete:true}},{...A.defaults(),buffer:0,confirmed:true},now);
 assert.equal(result.slots.length,0);assert.match(result.reason,/祝日データが未更新/);
});
