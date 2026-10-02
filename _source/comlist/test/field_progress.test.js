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
  assert.equal(w.document.querySelectorAll(".field-card").length, 5);
  assert.match(w.document.getElementById("fieldwrap").textContent, /活動日 10月1日時点/);
  assert.equal(w.document.querySelectorAll(".field-chart-row").length, 2);
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
});

test("現場数が未搭載の旧データでも画面を開ける", t => {
  const html = require("../app_sources").readApp("_assets/list.html")
    .replace('<script src="data.js"></script>', '<script>let DATA=[];let DAILY_TASKS=[];</script>');
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost" });
  t.after(() => dom.window.close());
  dom.window.setView("field");
  assert.match(dom.window.document.getElementById("fieldwrap").textContent, /まだありません/);
});
