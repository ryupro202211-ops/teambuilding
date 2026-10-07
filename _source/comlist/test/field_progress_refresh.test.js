'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {composeFieldProgress,verifyFresh}=require('../compose_field_progress');
const labels=['オリエン','紹介','個別','初個別','新友達'];
function row(activity,report,patch={}){return Object.assign({url:'https://app.notion.com/fixture','date:活動日:start':activity,'date:報告日:start':report,'原文目標月':activity.slice(0,7),'記録状況':'記録あり'},Object.fromEntries(labels.flatMap(l=>[[l+' 月累計',0],[l+' 月目標',10],[l+' 進捗',null]])),patch);}
test('全取得の行から月最新と日別を選び、確認日時を記録する',()=>{
 const input={complete:true,rows:[row('2026-09-30','2026-10-01',{'個別 月累計':9}),row('2026-10-04','2026-10-05',{'個別 月累計':2,'個別 進捗':1}),row('2026-10-04','2026-10-06',{'個別 月累計':3,'個別 進捗':2}),row('2026-10-05','2026-10-06',{'原文目標月':'2026-09','個別 月累計':99}),row('2026-10-06','2026-10-07',{'記録状況':'数値未記載'})]};
 const out=composeFieldProgress(input,'2026-10-07T00:00:00Z');
 assert.equal(out.months.length,2);assert.equal(out.months[1].activityDate,'2026-10-04');assert.equal(out.months[1].values.individual,3);assert.equal(out.months[0].partial,false);
 assert.equal(out.days.find(d=>d.activityDate==='2026-10-04').values.individual,2);assert.equal(out.days[0].values.orientation,null);
 assert.equal(out.checkedAt,'2026-10-07T00:00:00.000Z');verifyFresh(out,'2026-10-07');
 assert.throws(()=>verifyFresh(out,'2026-10-08'),/fresh/);assert.throws(()=>composeFieldProgress({...input,complete:false},out.checkedAt),/complete/);
});
test('取得時刻は日本時間の日付で確認し、欠落・不正時刻を拒否する',()=>{
 const out=composeFieldProgress({complete:true,rows:[row('2026-10-04','2026-10-05')]},'2026-10-06T15:00:00Z');verifyFresh(out,'2026-10-07');
 assert.throws(()=>verifyFresh({...out,checkedAt:undefined},'2026-10-07'),/fresh/);
 assert.throws(()=>composeFieldProgress({complete:true,rows:[]},'invalid'),/time/);
});
test('過去の原文月表記を正規化し、進捗がすべて空欄の日も欠落させない',()=>{
 const out=composeFieldProgress({complete:true,rows:[row('2025-10-31','2025-11-01',{'原文目標月':'◎2025年10月度実績'})]},'2026-10-07T00:00:00Z');
 assert.equal(out.months[0].month,'2025-10');assert.equal(out.days.length,1);assert.equal(out.days[0].values.individual,null);
});
