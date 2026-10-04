'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),A=require('../_assets/js/calendar-availability');
const now=Date.parse('2026-10-04T10:00:00+09:00'),d='2026-10-04',prefs={weekday:[[480,1320]],weekend:[[480,1320]],buffer:0,excludedDates:[],confirmed:true};
const event=(a,b,extra={})=>[a,b,{allDay:false,status:'confirmed',selfStatus:'yes',transparency:'opaque',...extra}];
function snapshot(events=[],extra={}){return {events,info:{source:'primary',fetchedAt:new Date(now).toISOString(),rangeStart:d+'T00:00:00+09:00',rangeEnd:'2026-11-05T00:00:00+09:00',complete:true,...extra}};}
test('90 minutes qualifies, 89 does not, long gaps produce one candidate',()=>{
 assert.equal(A.compute(snapshot(),prefs,now).slots.length,8);
 const p={...prefs,weekend:[[600,689]],weekday:[],excludedDates:[]};assert.equal(A.compute(snapshot(),p,now).slots.length,0);
 p.weekend=[[600,690]];assert.equal(A.compute(snapshot(),p,now).slots.filter(s=>s.date===d).length,1);
});
test('rolling seven days clips end and excludes starts before now',()=>{
 const slots=A.compute(snapshot(),prefs,now).slots;assert.ok(slots.every(s=>s.start>=now&&s.end<=now+7*86400000));assert.equal(slots.at(-1).date,'2026-10-11');
 const limit=now+7*86400000,p={...prefs,weekend:[[510,600]],weekday:[]};assert.equal(A.compute(snapshot(),p,now).slots.at(-1).end,limit);
});
test('overlapping busy and buffer merge; cancelled, declined and transparent ignored',()=>{
 const rows=[event(d+'T10:00',d+'T11:00'),event(d+'T10:30',d+'T12:00')];
 assert.equal(A.compute(snapshot(rows),{...prefs,buffer:15},now).slots[0].start,Date.parse(d+'T12:15:00+09:00'));
 for(const meta of [{status:'cancelled'},{selfStatus:'declined'},{selfStatus:'no'},{transparency:'transparent'}])assert.equal(A.compute(snapshot([event(d+'T10:00',d+'T20:00',meta)]),prefs,now).slots[0].start,now);
});
test('all-day and multiday block fully, excluded dates remain unavailable',()=>{
 const rows=[event(d+'T00:00','2026-10-06T00:00',{allDay:true})];assert.equal(A.compute(snapshot(rows),prefs,now).slots[0].date,'2026-10-06');
 assert.equal(A.compute(snapshot(),{...prefs,excludedDates:[d]},now).slots[0].date,'2026-10-05');
});
test('partial, stale, future timestamps and insufficient coverage never yield free candidates',()=>{
 for(const extra of [{complete:false},{fetchedAt:new Date(now-3*3600000-1).toISOString()},{fetchedAt:new Date(now+300001).toISOString()},{rangeStart:new Date(now+1).toISOString()},{rangeEnd:new Date(now+7*86400000-1).toISOString()}]){const result=A.compute(snapshot([],extra),prefs,now);assert.equal(result.slots.length,0);assert.ok(result.reason);}
});
test('settings must be confirmed; unknown buffer and invalid times rejected',()=>{
 assert.throws(()=>A.compute(snapshot(),A.defaults(),now));assert.throws(()=>A.settings({...prefs,buffer:null}));assert.throws(()=>A.settings({...prefs,weekday:[[900,600]]}));assert.throws(()=>A.validate(snapshot([event(d+'T10:00',d+'T09:00')])));
});
test('overlapping activity windows do not generate overlapping candidates',()=>{
 const p={...prefs,weekend:[[600,720],[690,900]]};const s=A.compute(snapshot(),p,now).slots.filter(s=>s.date===d);assert.equal(s.length,1);
});
test('JST midnight boundary uses the new local day and 90 minutes may end at midnight',()=>{
 const ms=Date.parse('2026-10-04T15:00:00Z');assert.equal(A.date(ms),'2026-10-05');
 const late=Date.parse('2026-10-04T22:30:00+09:00'),s=A.compute(snapshot([],{fetchedAt:new Date(late).toISOString()}),{...prefs,weekend:[[1350,1440]],weekday:[]},late).slots[0];assert.equal(s.end-s.start,90*60000);assert.equal(A.date(s.end),'2026-10-05');
 const {normalizeEvent}=require('../event_records');assert.ok(normalizeEvent({id:'evt_fixture_midnight00001',status:'公開',date:'2026-10-04',startTime:'22:30',endTime:'24:00',title:'Fixture midnight',version:1,updatedAt:'2026-10-04T10:00:00+09:00'}));
});
