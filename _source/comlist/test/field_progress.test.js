"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { validateFieldProgress } = require("../field_progress");

const latest = {
  month: "2026-10", activityDate: "2026-10-01", reportDate: "2026-10-02",
  url: "https://app.notion.com/3ed4057e224281f09e90c6283a435121", partial: true,
  values: { orientation: 0, introductions: 0, individual: 0, first_individual: 0, new_friends: 0 },
  goals: { orientation: 2, introductions: 10, individual: 30, first_individual: 15, new_friends: 40 }
};
const previous = {
  ...latest, month: "2026-09", activityDate: "2026-09-30", reportDate: "2026-10-01", partial: false,
  values: { ...latest.values, individual: 9, new_friends: 12 }
};
test('日別進捗は空欄とゼロを区別し、同じ活動日は最新報告を選ぶ',()=>{
 const first={activityDate:latest.activityDate,reportDate:latest.reportDate,url:latest.url,values:{...latest.values,orientation:null,individual:1}};
 const second={...first,reportDate:'2026-10-03',values:{...first.values,individual:2}};
 const out=validateFieldProgress({months:[latest],days:[second,first]});
 assert.equal(out.days.length,1);assert.equal(out.days[0].values.individual,2);assert.equal(out.days[0].values.orientation,null);assert.equal(out.days[0].values.introductions,0);
 assert.throws(()=>validateFieldProgress({months:[latest],days:[{...first,activityDate:'2026-02-30'}]}),/日付/);
 assert.throws(()=>validateFieldProgress({months:[latest],days:[{...first,values:{...first.values,individual:-1}}]}),/数値/);
});

test("月別現場数は活動月に属する記録を保持し、重複と不正値を止める", () => {
  const data = validateFieldProgress({ months: [latest, previous] });
  assert.deepEqual(data.months.map(m => m.month), ["2026-09", "2026-10"]);
  assert.equal(data.months[0].reportDate, "2026-10-01");
  assert.throws(() => validateFieldProgress({ months: [latest, latest] }), /重複/);
  assert.throws(() => validateFieldProgress({ months: [{ ...latest, values: { ...latest.values, individual: -1 } }] }), /不正/);
  assert.throws(() => validateFieldProgress({ months: [{ ...latest, activityDate: "2026-09-30" }] }), /日付/);
});

test("現場数タブは今月と過去月の5項目、出典、月別グラフを切り替えられる", t => {
  const html = require("../app_sources").readApp("_assets/list.html")
    .replace('<script src="data.js"></script>', '<script>let DATA=[];let DAILY_TASKS=[];</script>');
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost" });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.FIELD_PROGRESS = validateFieldProgress({ months: [latest, previous] });
  w.setView("field");
  assert.equal(w.document.body.className, "view-field");
  assert.equal(w.document.querySelectorAll(".field-goal-metrics").length, 0);
  assert.equal(w.document.querySelectorAll(".field-mission-gauges article").length, 5);
  assert.match(w.document.getElementById("fieldwrap").textContent, /活動日 10月1日時点/);
  assert.equal(w.document.querySelectorAll(".field-chart-row").length, 2);
  assert.deepEqual(Array.from(w.document.querySelectorAll(".field-chart-month"), e => e.textContent), ["2026/10※", "2026/09"]);
  assert.deepEqual(Array.from(w.FIELD_PROGRESS.months, m => m.month), ["2026-09", "2026-10"]);
  assert.match(w.document.querySelector(".field-source a").href, /3ed4057e224281f09e90c6283a435121/);
  const month = w.document.getElementById("field-month");
  month.value = "2026-09";
  month.dispatchEvent(new w.Event("change"));
  assert.match(w.document.getElementById("fieldwrap").textContent, /9 \/ 30件|9 \/ 30/);
  assert.match(w.document.getElementById("fieldwrap").textContent, /報告日 10月1日/);
  const metric = w.document.getElementById("field-metric");
  metric.value = "new_friends";
  metric.dispatchEvent(new w.Event("change"));
  assert.match(w.document.querySelector(".field-chart").getAttribute("aria-label"), /新友達/);
  assert.deepEqual(Array.from(w.document.querySelectorAll(".field-chart-month"), e => e.textContent), ["2026/10※", "2026/09"]);
});

test("現場数が未搭載の旧データでも画面を開ける", t => {
  const html = require("../app_sources").readApp("_assets/list.html")
    .replace('<script src="data.js"></script>', '<script>let DATA=[];let DAILY_TASKS=[];</script>');
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost" });
  t.after(() => dom.window.close());
  dom.window.setView("field");
  assert.match(dom.window.document.getElementById("fieldwrap").textContent, /未報告/);
});
test('週合計は選択月内の日付範囲と記録日数を表示し、月外の実績を除く',t=>{
 const html=require('../app_sources').readApp('_assets/list.html').replace('<script src="data.js"></script>','<script>let DATA=[];let DAILY_TASKS=[];</script>');
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost'});t.after(()=>dom.window.close());const w=dom.window;
 const days=w.FieldCalendarModel.cells('2026-10-01','week');
 w.FIELD_PROGRESS={days:days.map(day=>({activityDate:day,reportDate:day,values:{individual:day.slice(0,7)==='2026-09'?10:1}}))};
 const box=w.document.createElement('div');box.innerHTML=w.fieldWeekTotalHTML({persons:[],records:[]},days,'2026-10-04',true,'2026-10');
 assert.match(box.textContent,/10\/01〜10\/04/);assert.match(box.textContent,/個別実 4 \/ 予/);
 assert.equal(box.querySelector('[title]').title,'実績の記録：0/4日');
 assert.equal(box.querySelectorAll('[title]')[2].title,'実績の記録：4/4日');
 assert.doesNotMatch(box.textContent,/実 4※/);
 box.innerHTML=w.fieldWeekTotalHTML({persons:[],records:[]},days,'2026-10-04',true,'2026-11');
 assert.match(box.textContent,/対象月の日付なし/);
});
test('Notion確認日時と活動日を区別し、確認日時のない旧データは未確認にする',t=>{
 const html=require('../app_sources').readApp('_assets/list.html').replace('<script src="data.js"></script>','<script>let DATA=[];let DAILY_TASKS=[];</script>');
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost'});t.after(()=>dom.window.close());const w=dom.window;
 w.FIELD_PROGRESS={months:[latest],checkedAt:'2026-10-07T00:45:00.000Z'};w.setView('field');
 assert.match(w.document.querySelector('.field-check').textContent,/Notion確認：2026\/10\/07 09:45/);
 assert.match(w.document.querySelector('.field-asof').textContent,/活動日 10月1日/);
 delete w.FIELD_PROGRESS.checkedAt;w.renderFieldProgress();assert.match(w.document.querySelector('.field-check').textContent,/確認日時は未記録/);
});
test('日別画面はNotionの進捗を実績として表示する',t=>{
 const html=require('../app_sources').readApp('_assets/list.html').replace('<script src="data.js"></script>','<script>let DATA=[];let DAILY_TASKS=[];</script>');
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost'});t.after(()=>dom.window.close());const w=dom.window;
 const day=w.fieldGoalsToday(),month=day.slice(0,7);
 w.FIELD_PROGRESS={months:[{...latest,month,activityDate:day,reportDate:day}],days:[{activityDate:day,reportDate:day,url:latest.url,values:{...latest.values,individual:7,orientation:null}}]};
 w.fieldMonthSelection=month;w.setView('field');
 const card=w.document.querySelector('[data-fc-day="'+day+'"]').closest('article');
 assert.match(card.textContent,/個別実 7 \/ 予/);assert.match(card.textContent,/オリエン実 — \/ 予/);
 assert.equal(w.document.querySelectorAll('.field-calendar-week-total').length,6);
 const week=card.parentElement.querySelectorAll('.field-calendar-week-total');
 assert.ok(Array.from(week).some(e=>/個別実 7※ \/ 予/.test(e.textContent)));
 w.fieldCalendarMode='week';w.renderFieldProgress();assert.equal(w.document.querySelectorAll('.field-calendar-week-total').length,1);
});
