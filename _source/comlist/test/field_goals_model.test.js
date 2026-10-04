'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),M=require('../_assets/js/field-model');
const person={id:'person-fixture-0001',name:'Fixture',row:2};
const record=(id,patch={})=>({id,personId:person.id,kind:'introductions',status:'completed',date:'2026-10-02',dueDate:'2026-10-02',purpose:'紹介の実施を確認',outcomeConfirmed:true,newPersonForMonth:false,...patch});
const report={activityDate:'2026-10-01',values:{orientation:0,introductions:0,individual:1,first_individual:0,new_friends:0},goals:{orientation:2,introductions:10,individual:30,first_individual:15,new_friends:40}};
const data=records=>({goals:{},persons:[person],records});
test('月内の紹介人数は同じ人物を重複せず、紹介件数と月またぎを分ける',()=>{
 const s=M.summarize(data([record('record-fixture-0001'),record('record-fixture-0002'),record('record-fixture-0003',{date:'2026-09-30'}),record('record-fixture-0004',{status:'cancelled',outcomeConfirmed:false})]),report,'2026-10','2026-10-03');
 assert.equal(s.prospects,1);assert.equal(s.remaining,2);assert.equal(s.metrics.introductions.additional,2);assert.equal(M.summarize(data([record('record-fixture-0003',{date:'2026-09-30'})]),report,'2026-09','2026-10-03').prospects,1);
});
test('確定と実施は排他的で、取消と延期と自由な予定から実績を作らない',()=>{
 const r=record('record-fixture-0001',{status:'confirmed',outcomeConfirmed:false,date:'2026-10-05',dueDate:'2026-10-05'});let s=M.summarize(data([r]),report,'2026-10','2026-10-03');assert.equal(s.prospects,0);assert.equal(s.conditionalProspects,1);assert.equal(s.metrics.introductions.actual,0);assert.equal(s.metrics.introductions.secured,1);
 r.status='completed';r.outcomeConfirmed=true;s=M.summarize(data([r]),report,'2026-10','2026-10-05');assert.equal(s.prospects,1);assert.equal(s.metrics.introductions.actual,1);assert.equal(s.metrics.introductions.secured,0);
 for(const status of ['proposed','postponed','cancelled'])assert.equal(M.summarize(data([{...r,status,outcomeConfirmed:false}]),report,'2026-10','2026-10-05').metrics.introductions.actual,0);
});
test('活動実績更新が追加記録を吸収し、累計と二重加算しない',()=>{
 const d=data([record('record-fixture-0001',{kind:'individual',outcomeConfirmed:false})]);const before=M.summarize(d,report,'2026-10','2026-10-03');assert.equal(before.metrics.individual.actual,2);
 const after=M.summarize(d,{...report,activityDate:'2026-10-02',values:{...report.values,individual:2}},'2026-10','2026-10-03');assert.equal(after.metrics.individual.actual,2);assert.equal(after.metrics.individual.held,1);
});
test('未報告は0と異なり、人数指標は既存累計との重複確認なしに加算しない',()=>{
 const d=data([record('record-fixture-0001',{kind:'first_individual',outcomeConfirmed:false})]);let s=M.summarize(d,null,'2026-10','2026-10-31');assert.equal(s.metrics.individual.actual,null);assert.equal(s.metrics.individual.gap,null);assert.equal(s.remainingDays,1);
 s=M.summarize(d,report,'2026-10','2026-10-03');assert.equal(s.metrics.first_individual.actual,0);assert.equal(s.metrics.first_individual.held,1);d.records[0].newPersonForMonth=true;assert.equal(M.summarize(d,report,'2026-10','2026-10-03').metrics.first_individual.actual,1);assert.equal(s.metrics.individual.actual,1);
});
test('月別目標、期限後・不足0、不正な人物と紹介確認を検証する',()=>{
 const d=data([]);d.goals['2026-10']={prospects:4,metrics:{...report.goals,individual:1}};const s=M.summarize(d,report,'2026-10','2026-10-03');assert.equal(s.target,4);assert.equal(s.metrics.individual.gap,0);assert.equal(s.metrics.individual.weekly,0);assert.equal(M.summarize(d,report,'2026-10','2026-11-01').metrics.individual.weekly,null);assert.throws(()=>M.validate(data([record('record-fixture-0001',{status:'confirmed'})])));assert.throws(()=>M.validate(data([record('record-fixture-0001',{personId:'nonexistent-person'})])));
});
