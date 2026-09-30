"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { parseEvents } = require("../parse_events.js");

// 年を固定して曜日計算を決定的にする
const OPT = { year: 2026 };

test("ブロック形式: タイトル・テーマ・日付・時刻・場所を取る", () => {
  const rows = [
    ["", "■VELTイベント（交流飲み会）", ""],
    ["", "8/15(土) 19:00-21:00 @浜松町", ""]
  ];
  assert.deepStrictEqual(parseEvents(rows, OPT), [
    { d: "8/15", dow: "土", t: "19:00-21:00", place: "浜松町",
      title: "VELTイベント", theme: "交流飲み会" }
  ]);
});

test("テーマ： の接頭辞は落とす", () => {
  const rows = [
    ["", "■ライフデザイン講演会（テーマ：100年時代を生き抜くために）", ""],
    ["", "9/20(日) 15:20-17:30", ""]
  ];
  const got = parseEvents(rows, OPT);
  assert.strictEqual(got[0].theme, "100年時代を生き抜くために");
  assert.strictEqual(got[0].place, "");
});

test("曜日はシートの記載を優先する（実際の曜日とズレていても直さない）", () => {
  // 2026-08-27 は実際には木曜だが、シートに(水)とあるので水を採用する
  const rows = [
    ["", "■モルック", ""],
    ["", "8/27(水) 20:00-22:00 @日比谷公園", ""]
  ];
  assert.strictEqual(parseEvents(rows, OPT)[0].dow, "水");
});

test("曜日の記載が無ければ日付から計算する", () => {
  const rows = [
    ["", "■テスト会", ""],
    ["", "9/5 19:00-21:00 @東陽町", ""]
  ];
  assert.strictEqual(parseEvents(rows, OPT)[0].dow, "土");
});

test("単一行形式", () => {
  const rows = [["", "10/31 11:00-18:00 イタリア街ハロウィン", ""]];
  assert.deepStrictEqual(parseEvents(rows, OPT), [
    { d: "10/31", dow: "土", t: "11:00-18:00", place: "", title: "イタリア街ハロウィン" }
  ]);
});

test("集計シート行は直前イベントの sheet になる", () => {
  const rows = [
    ["", "■モルック", ""],
    ["", "8/27(水) 20:00-22:00 @日比谷公園", ""],
    ["", "集計シート", "https://docs.google.com/spreadsheets/d/AAA/edit"]
  ];
  const got = parseEvents(rows, OPT);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].sheet, "https://docs.google.com/spreadsheets/d/AAA/edit");
});

test("単独URL行は直前イベントの url になる", () => {
  const rows = [
    ["", "■Beat One（音楽イベント）", ""],
    ["", "9/18(金) 20:00-23:00", ""],
    ["", "https://allcraftjapan.com/events/beat-one/", ""]
  ];
  assert.strictEqual(parseEvents(rows, OPT)[0].url,
    "https://allcraftjapan.com/events/beat-one/");
});

test("時刻が範囲でないものもそのまま通す", () => {
  const rows = [
    ["", "■農業イベント", ""],
    ["", "9/22(火) 日中(22・23)", ""]
  ];
  assert.strictEqual(parseEvents(rows, OPT)[0].t, "日中(22・23)");
});

test("複数日（読点区切り）: 開始日以外の日付情報は t に畳み込む", () => {
  const rows = [
    ["", "■農業イベント", ""],
    ["", "9/22、23 日中", ""]
  ];
  assert.deepStrictEqual(parseEvents(rows, OPT), [
    { d: "9/22", dow: "火", t: "日中(22・23)", place: "", title: "農業イベント" }
  ]);
});

test("複数日（中点区切り）: 開始日以外の日付情報は t に畳み込む", () => {
  const rows = [
    ["", "■農業イベント", ""],
    ["", "9/22・23 日中", ""]
  ];
  assert.deepStrictEqual(parseEvents(rows, OPT), [
    { d: "9/22", dow: "火", t: "日中(22・23)", place: "", title: "農業イベント" }
  ]);
});

test("日付昇順に並べる", () => {
  const rows = [
    ["", "11/3 15:00-20:00 リプキャン", ""],
    ["", "9/9 20:20-22:30 ライフデザイン講演会", ""]
  ];
  assert.deepStrictEqual(parseEvents(rows, OPT).map(e => e.d), ["9/9", "11/3"]);
});

test("空行と解釈できない行は落とすが、件数を壊さない", () => {
  const rows = [
    ["", "", ""],
    ["", "見出しのような何か", ""],
    ["", "9/9 20:20-22:30 ライフデザイン講演会", ""]
  ];
  assert.strictEqual(parseEvents(rows, OPT).length, 1);
});

test("解釈できなかった行は skipped に行番号と本文を積む", () => {
  const rows = [
    ["", "", ""],
    ["", "見出しのような何か", ""],
    ["", "9/9 20:20-22:30 ライフデザイン講演会", ""]
  ];
  const skipped = [];
  parseEvents(rows, { year: 2026, skipped });
  assert.deepStrictEqual(skipped, [{ line: 2, text: "見出しのような何か" }]);
});

test("連続した見出しを上書きせず、未成立の先頭見出しをskippedに残す", () => {
  const skipped = [];
  const events = parseEvents([
    ["", "■失われる先頭", ""],
    ["", "■有効イベント", ""],
    ["", "10/3 19:00-21:00 @新橋", ""],
  ], { year: 2026, skipped });

  assert.deepStrictEqual(events.map((event) => event.title), ["有効イベント"]);
  assert.deepStrictEqual(skipped, [{
    line: 1,
    text: "■失われる先頭",
    reason: "見出しに対応する開催行がありません",
  }]);
});

test("末尾に残った見出しをskippedに残す", () => {
  const skipped = [];
  const events = parseEvents([["", "■失われる末尾", ""]], { year: 2026, skipped });

  assert.deepStrictEqual(events, []);
  assert.deepStrictEqual(skipped, [{
    line: 1,
    text: "■失われる末尾",
    reason: "見出しに対応する開催行がありません",
  }]);
});

test("pending見出しの後に単一行イベントが来ても先行見出しをskippedに残す", () => {
  const skipped = [];
  const events = parseEvents([
    ["", "■単一行には対応しない見出し", ""],
    ["", "10/3 19:00-21:00 独立イベント@新橋", ""],
  ], { year: 2026, skipped });

  assert.deepStrictEqual(events.map((event) => event.title), ["独立イベント"]);
  assert.deepStrictEqual(skipped, [{
    line: 1,
    text: "■単一行には対応しない見出し",
    reason: "見出しに対応する開催行がありません",
  }]);
});

// 実データのスナップショット。現行の公開物と一致することを固定する。
test("実データのスナップショット: 現行の EVENTS と一致する", () => {
  const rows = require("./fixtures/event_rows.json");
  const expected = require("./fixtures/expected_events.json");
  assert.deepStrictEqual(parseEvents(rows, OPT), expected);
});
