'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),M=require('../_assets/js/field-model'),C=require('../_assets/js/field-calendar');
const people=Array.from({length:4},(_,i)=>({id:'person-calendar-000'+i,name:'Person '+i,row:i+2}));
const row=(id,patch={})=>({id:'record-calendar-000'+id,personId:people[0].id,kind:'individual',status:'confirmed',date:'2026-10-05',dueDate:'2026-10-05',purpose:'Fixture',outcomeConfirmed:false,newPersonForMonth:true,...patch});
const data=records=>({goals:{'2026-10':{prospects:3,metrics:{orientation:null,introductions:null,individual:10,first_individual:null,new_friends:0}}},persons:people,records});
const report={activityDate:'2026-10-03',values:{orientation:0,introductions:0,individual:4,first_individual:0,new_friends:0},goals:{}};
test('weekly totals sum the seven visible days across months and preserve missing actuals',()=>{
 const days=C.cells('2026-10-01','week');const progress={days:[{activityDate:days[0],reportDate:days[1],values:{individual:2,introductions:0}},{activityDate:days[4],reportDate:days[5],values:{individual:1}}]};
 const result=C.week(data([row(0,{date:days[6],dueDate:days[6]})]),days,days[4],progress);
 assert.equal(result.individual.actual,3);assert.equal(result.individual.recordedDays,2);assert.equal(result.individual.planned,1);assert.equal(result.orientation.actual,null);assert.equal(result.introductions.actual,0);
});
test('Notion activity-day progress replaces local actual without adding it twice; plans remain editable',()=>{
 const d=data([row(0,{date:'2026-10-04',status:'completed'}),row(1,{date:'2026-10-04',status:'confirmed'})]);
 const progress={days:[{activityDate:'2026-10-04',reportDate:'2026-10-05',values:{individual:3,orientation:null,introductions:0,first_individual:null,new_friends:null}}]};
 const counts=C.daily(d,'2026-10-04','2026-10-04',progress);
 assert.equal(counts.individual.actual,3);assert.equal(counts.individual.planned,1);assert.equal(counts.orientation.actual,null);assert.equal(counts.introductions.actual,0);
 assert.equal(C.daily(d,'2026-10-05','2026-10-04',progress).individual.actual,null);
});
test('31-day month on fourth: 28 days; T10 A4 P3 gaps6 and3',()=>{
 const s=M.summarize(data([row(0),row(1),row(2)]),report,'2026-10','2026-10-04');assert.equal(s.remainingDays,28);assert.equal(s.metrics.individual.goal,10);assert.equal(s.metrics.individual.actual,4);assert.equal(s.metrics.individual.gap,6);assert.equal(s.metrics.individual.secured,3);assert.equal(s.metrics.individual.unsecured,3);
 assert.equal(s.metrics.orientation.goal,null);assert.equal(s.metrics.new_friends.goal,0);assert.equal(s.metrics.new_friends.gap,0);
});
test('proposed, cancelled, unrescheduled postponed, expired and completed never count as P',()=>{
 const rows=['proposed','cancelled','postponed','completed'].map((status,i)=>row(i,{status})).concat(row(4,{dueDate:'2026-10-03'}));assert.equal(M.summarize(data(rows),report,'2026-10','2026-10-04').metrics.individual.secured,0);
});
test('month/week Monday start, cross month and leap year',()=>{
 assert.deepEqual(C.cells('2026-07-01','week'),['2026-06-29','2026-06-30','2026-07-01','2026-07-02','2026-07-03','2026-07-04','2026-07-05']);assert.equal(C.cells('2024-02-29','month').filter(d=>d.startsWith('2024-02')).length,29);
 assert.equal(M.summarize(data([]),report,'2024-02','2024-02-01').remainingDays,29);assert.equal(M.summarize(data([]),report,'2026-09','2026-10-04').remainingDays,0);assert.equal(M.summarize(data([]),report,'2026-11','2026-10-04').remainingDays,30);
});
test('all five daily metrics distinguish actual/planned and deduplicate persons',()=>{
 const rows=[row(0,{kind:'orientation'}),row(1,{kind:'orientation'}),row(2,{kind:'orientation',personId:people[1].id}),row(3,{date:'2026-10-04',status:'completed'}),row(4,{date:'2026-10-04',status:'confirmed'})],d=data(rows);assert.equal(C.daily(d,'2026-10-05','2026-10-04').orientation.planned,2);assert.equal(C.daily(d,'2026-10-04','2026-10-04').individual.actual,1);assert.equal(C.daily(d,'2026-10-04','2026-10-04').individual.planned,1);assert.deepEqual(Object.keys(C.daily(d,'2026-10-04','2026-10-04')),M.keys);
});
test('monthly people P cannot count a completed person again; imported base cutoff remains protected',()=>{
 const d=data([row(0,{kind:'orientation',date:'2026-10-04',status:'completed'}),row(1,{kind:'orientation'}),row(2,{kind:'orientation',personId:people[1].id})]);assert.equal(M.summarize(d,report,'2026-10','2026-10-04').metrics.orientation.secured,1);assert.equal(M.summarize(d,{...report,activityDate:'2026-10-05'},'2026-10','2026-10-04').metrics.orientation.secured,0);
});
