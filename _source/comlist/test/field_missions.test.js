'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),M=require('../_assets/js/field-model');
const persons=[1,2,3].map(n=>({id:'person-fixture-000'+n,name:'Fixture '+n,row:n+1}));
const record=(n,patch={})=>({id:'record-fixture-000'+n,personId:persons[0].id,kind:'introductions',status:'completed',date:'2026-10-03',dueDate:'2026-10-03',purpose:'紹介につながった確認',outcomeConfirmed:true,newPersonForMonth:false,...patch});
const report={activityDate:'2026-10-02',values:{orientation:0,introductions:0,individual:1,first_individual:0,new_friends:0},goals:{orientation:2,introductions:10,individual:30,first_individual:15,new_friends:40}};
const data=records=>({goals:{},persons,records});
test('週ミッションは月残りを区切り開始時に固定し、月またぎと日曜を扱う',()=>{
 const d=M.createMission(data([]),report,'2026-10','2026-10-03'),w=d.missions[0];assert.equal(w.weekStart,'2026-09-28');assert.equal(M.weekEnd(w.weekStart),'2026-10-04');assert.equal(w.targets.prospects,1);assert.equal(w.targets.individual,2);assert.throws(()=>M.createMission(d,report,'2026-10','2026-10-04'),/設定済み/);
 const next=M.createMission(d,report,'2026-10','2026-10-05');assert.equal(next.missions.length,2);assert.equal(d.missions[0].targets.individual,2);
});
test('開始前の実績・予定・累計増加から週達成を作らず、明示した実施記録だけを数える',()=>{
 const d=M.createMission(data([record(1,{date:'2026-10-02'})]),report,'2026-10','2026-10-03'),w=d.missions[0];assert.equal(M.missionSummary(d,w,'2026-10-03').actual.prospects,0);
 d.records.push(record(2,{status:'confirmed',outcomeConfirmed:false,personId:persons[1].id}));assert.equal(M.missionSummary(d,w,'2026-10-03').achieved,false);assert.equal(M.missionSummary(d,w,'2026-10-03').actual.introductions,0);
 d.records[1].status='completed';d.records[1].outcomeConfirmed=true;assert.equal(M.missionSummary(d,w,'2026-10-03').actual.prospects,1);d.records[1].status='cancelled';d.records[1].outcomeConfirmed=false;assert.equal(M.missionSummary(d,w,'2026-10-03').actual.prospects,0);
 assert.equal(M.missionSummary(d,w,'2026-10-09').actual.prospects,0);assert.equal(d.missions.length,1);
});
test('週スタンプは設定した正の目標を全て満たした場合だけ、未報告と休みは記録を消さない',()=>{
 const d=M.createMission(data([]),null,'2026-10','2026-10-03'),w=d.missions[0];assert.equal(w.targets.individual,null);assert.equal(M.missionSummary(d,w,'2026-10-03').achieved,false);
 d.records.push(record(1));assert.equal(M.missionSummary(d,w,'2026-10-03').achieved,true);assert.equal(M.missionSummary(d,w,'2026-10-10').achieved,true);assert.equal(d.records.length,1);
 d.records.push(record(2));assert.equal(M.missionSummary(d,w,'2026-10-03').actual.prospects,1);assert.equal(M.missionSummary(d,w,'2026-10-03').actual.introductions,2);
});
test('個別と初個別は合算せず、月内の人数重複未確認は週の達成に足さない',()=>{
 const d=M.createMission(data([]),report,'2026-10','2026-10-03'),w=d.missions[0];d.records.push(record(1,{kind:'first_individual',outcomeConfirmed:false}));assert.equal(M.missionSummary(d,w,'2026-10-03').actual.first_individual,0);d.records[0].newPersonForMonth=true;assert.equal(M.missionSummary(d,w,'2026-10-03').actual.first_individual,1);assert.equal(M.missionSummary(d,w,'2026-10-03').actual.individual,0);
});
