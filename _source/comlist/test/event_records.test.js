"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeEvent,
  eventToDisplay,
  legacyEventToRecords,
  validateEventList,
} = require("../event_records.js");

const ID = "evt_01JTEST00000000000000000";

test("normalizes a canonical event", () => {
  const event = normalizeEvent({
    id: ID,
    status: "公開",
    date: "2026-10-03",
    startTime: "19:00",
    endTime: "21:00",
    title: "  交流会  ",
    theme: "経営者",
    place: "新橋",
    url: "https://example.com/event",
    sheetUrl: "https://docs.google.com/spreadsheets/d/test/edit",
    updatedAt: "2026-09-22T14:00:00+09:00",
    version: 1,
  });

  assert.deepEqual(event, {
    id: ID,
    status: "公開",
    date: "2026-10-03",
    startTime: "19:00",
    endTime: "21:00",
    title: "交流会",
    theme: "経営者",
    place: "新橋",
    url: "https://example.com/event",
    sheetUrl: "https://docs.google.com/spreadsheets/d/test/edit",
    updatedAt: "2026-09-22T14:00:00+09:00",
    version: 1,
  });
});

test("rejects an end time without a start time", () => {
  assert.throws(() => normalizeEvent({
    id: ID,
    status: "公開",
    date: "2026-10-03",
    startTime: "",
    endTime: "21:00",
    title: "交流会",
    updatedAt: "2026-09-22T14:00:00+09:00",
    version: 1,
  }), /開始時刻/);
});

test("rejects invalid status, date, time, and URL values", () => {
  assert.throws(() => normalizeEvent({ id: ID, status: "下書き", date: "2026-10-03", title: "交流会" }), /状態/);
  assert.throws(() => normalizeEvent({ id: ID, status: "公開", date: "2026-02-30", title: "交流会" }), /開催日/);
  assert.throws(() => normalizeEvent({ id: ID, status: "公開", date: "2026-10-03", startTime: "9:00", title: "交流会" }), /開始時刻/);
  assert.throws(() => normalizeEvent({ id: ID, status: "公開", date: "2026-10-03", title: "交流会", url: "http://example.com" }), /案内URL/);
});

test("永続イベントは正の更新番号と厳密な終了時刻を要求する", () => {
  assert.throws(() => normalizeEvent({
    id: ID, status: "公開", date: "2026-10-03", title: "交流会", version: 0,
  }), /更新番号/);
  assert.throws(() => normalizeEvent({
    id: ID, status: "公開", date: "2026-10-03", startTime: "19:00", endTime: "19:00", title: "交流会", version: 1,
  }), /終了時刻/);
});

test("versionはnumberの正整数だけを受け付け、新規入力はversionを明示的に省略する", () => {
  for (const version of ["3", true, 0, 1.5]) {
    assert.throws(() => normalizeEvent({
      id: ID, status: "公開", date: "2026-10-03", title: "交流会", version,
    }), /更新番号/);
  }
  assert.doesNotThrow(() => normalizeEvent({
    date: "2026-10-03", title: "新規イベント",
  }, { allowMissingId: true, allowMissingVersion: true }));
  assert.throws(() => normalizeEvent({
    date: "2026-10-03", title: "新規イベント", version: 0,
  }, { allowMissingId: true, allowMissingVersion: true }), /更新番号/);
});

test("イベントの任意項目と集計シートURLにも共通の上限を適用する", () => {
  assert.throws(() => normalizeEvent({
    id: ID, status: "公開", date: "2026-10-03", title: "交流会", version: 1,
    theme: "x".repeat(121),
  }), /テーマ/);
  assert.throws(() => normalizeEvent({
    id: ID, status: "公開", date: "2026-10-03", title: "交流会", version: 1,
    sheetUrl: "https://docs.google.com/spreadsheets/",
  }), /集計シートURL/);
});

test("allows a new event without an ID when explicitly requested", () => {
  const event = normalizeEvent({ date: "2026-10-03", title: "交流会" }, { allowMissingId: true, allowMissingVersion: true });
  assert.equal(event.id, "");
  assert.equal(event.status, "公開");
  assert.equal(event.version, 0);
});

test("converts a canonical event to the legacy display shape", () => {
  const display = eventToDisplay(normalizeEvent({
    id: ID,
    status: "公開",
    date: "2026-10-03",
    startTime: "19:00",
    endTime: "21:00",
    title: "交流会",
    theme: "経営者",
    place: "新橋",
    url: "https://example.com/event",
    sheetUrl: "https://docs.google.com/spreadsheets/d/test/edit",
    updatedAt: "2026-09-22T14:00:00+09:00",
    version: 1,
  }));

  assert.deepEqual(display, {
    d: "10/3",
    dow: "土",
    t: "19:00-21:00",
    title: "交流会",
    theme: "経営者",
    place: "新橋",
    url: "https://example.com/event",
    sheet: "https://docs.google.com/spreadsheets/d/test/edit",
    id: ID,
    status: "公開",
    date: "2026-10-03",
    startTime: "19:00",
    endTime: "21:00",
    updatedAt: "2026-09-22T14:00:00+09:00",
    version: 1,
  });
});

test("splits a legacy multi-day event into separate records", () => {
  const rows = legacyEventToRecords({ d: "9/22、23", t: "日中", title: "農業イベント" }, 2026);
  assert.deepEqual(rows.map((row) => row.date), ["2026-09-22", "2026-09-23"]);
  assert.equal(rows[0].startTime, "");
  assert.equal(rows[0].endTime, "");
  assert.match(rows[0].migrationWarning, /日中/);
});

test("requires an explicit year when converting a legacy event", () => {
  assert.throws(() => legacyEventToRecords({ d: "9/22", t: "19:00-21:00", title: "交流会" }), /年/);
});

test("calculates the weekday from the date instead of trusting legacy dow", () => {
  const [row] = legacyEventToRecords({
    d: "9/22",
    dow: "日",
    t: "19:00-21:00",
    title: "交流会",
  }, 2026);

  assert.equal(eventToDisplay(row).dow, "火");
});

test("converts a legacy time range and keeps the sheet URL", () => {
  const [row] = legacyEventToRecords({
    d: "10/3",
    t: "19:00-21:00",
    title: "交流会",
    theme: "経営者",
    place: "新橋",
    url: "https://example.com/event",
    sheet: "https://docs.google.com/spreadsheets/d/test/edit",
  }, 2026);

  assert.equal(row.startTime, "19:00");
  assert.equal(row.endTime, "21:00");
  assert.equal(row.sheetUrl, "https://docs.google.com/spreadsheets/d/test/edit");
  assert.equal(row.migrationWarning, undefined);
});

test("assigns a distinct ID to every record when splitting an event with an existing ID", () => {
  const rows = legacyEventToRecords({
    id: ID,
    d: "9/22、23",
    t: "19:00-21:00",
    title: "交流会",
  }, 2026);

  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
  assert.doesNotThrow(() => validateEventList(rows));
});

test("keeps derived IDs within the 80-character limit for a maximum-length source ID", () => {
  const maxLengthId = `evt_${"a".repeat(76)}`;
  const rows = legacyEventToRecords({
    id: maxLengthId,
    d: "9/22、23",
    t: "19:00-21:00",
    title: "交流会",
  }, 2026);

  assert.equal(maxLengthId.length, 80);
  assert.ok(rows.every((row) => row.id.length <= 80));
  assert.notEqual(rows[0].id, rows[1].id);
  assert.doesNotThrow(() => validateEventList(rows));
});

test("keeps long source IDs distinct for the same migrated date", () => {
  const sharedPrefix = "a".repeat(72);
  const sourceA = `evt_${sharedPrefix}1111`;
  const sourceB = `evt_${sharedPrefix}2222`;
  const rowsA = legacyEventToRecords({ id: sourceA, d: "9/22、23", t: "19:00-21:00", title: "交流会" }, 2026);
  const rowsB = legacyEventToRecords({ id: sourceB, d: "9/22、23", t: "19:00-21:00", title: "交流会" }, 2026);

  assert.equal(rowsA[1].date, rowsB[1].date);
  assert.notEqual(rowsA[1].id, rowsB[1].id);
  assert.equal(rowsA[1].id, legacyEventToRecords({ id: sourceA, d: "9/22、23", t: "19:00-21:00", title: "交流会" }, 2026)[1].id);
  assert.ok(rowsA.concat(rowsB).every((row) => row.id.length <= 80));
});

test("rejects a sheet URL containing an embedded newline", () => {
  assert.throws(() => normalizeEvent({
    id: ID,
    status: "公開",
    date: "2026-10-03",
    title: "交流会",
    sheetUrl: "https://docs.google.com/spreadsheets/d/test/edit\nnot-a-url",
  }), /集計シートURL/);
});

test("recognizes legacy multi-day suffixes in the time field", () => {
  const rows = legacyEventToRecords({ d: "9/22", t: "日中(22・23)", title: "農業イベント" }, 2026);
  assert.deepEqual(rows.map((row) => row.date), ["2026-09-22", "2026-09-23"]);
});

test("legacy date parsing rejects unconsumed ranges instead of silently changing the month", () => {
  assert.throws(() => legacyEventToRecords({
    d: "9/22-23", t: "19:00-21:00", title: "交流会",
  }, 2026), /開催日/);
});

test("validates event lists and rejects duplicate IDs", () => {
  const event = {
    id: ID,
    status: "公開",
    date: "2026-10-03",
    title: "交流会",
    version: 1,
  };
  assert.equal(validateEventList([event])[0].id, ID);
  assert.throws(() => validateEventList([event, event]), /イベントID.*重複/);
});
