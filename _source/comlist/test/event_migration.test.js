"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { collectLegacyV1Migration } = require("../fetch_materials.js");
const { buildMigrationReportFromLegacyRows } = require("../migrate_events.js");

test("旧v1スナップショットは通常取得と分離した移行レポート経路へ渡す", async () => {
  const result = await collectLegacyV1Migration({
    year: 2026,
    token: "test-token",
    readApiFn: async () => ({
      ok: true,
      snapshot: {
        version: 1,
        generatedAt: "2026-09-22T06:00:00+09:00",
        contacts: [["A"]],
        eventRows: [
          ["", "■交流会", ""],
          ["", "9/22(火) 19:00-21:00", ""],
          ["", "■解釈不能", ""],
          ["", "9/22-23", ""],
        ],
        calendar: [],
        counts: { contacts: 1, eventRows: 4, calendar: 0 },
      },
    }),
  });

  assert.equal(result.sourceVersion, 1);
  assert.equal(result.report.sourceVersion, 1);
  assert.equal(result.report.recordCount, 1);
  assert.equal(result.report.skipped.length, 2);
  assert.equal(result.report.ready, false);
});

test("移行専用経路はv2スナップショットを旧v1として受け付けない", async () => {
  await assert.rejects(() => collectLegacyV1Migration({
    year: 2026,
    token: "test-token",
    readApiFn: async () => ({ ok: true, snapshot: { version: 2, eventRows: [] } }),
}), /旧v1/);
});

test("同じ旧イベントはレポートの並べ替えに依存しないmigrationKeyと元行を持つ", () => {
  const rows = [
    ["", "■A", ""],
    ["", "10/3 19:00-21:00 @新橋", ""],
  ];
  const first = buildMigrationReportFromLegacyRows(rows, 2026);
  const second = buildMigrationReportFromLegacyRows(rows, 2026);

  assert.equal(first.records[0].migrationKey, second.records[0].migrationKey);
  assert.equal(first.sourceCount, rows.length);
  assert.deepEqual(first.sourceRows, rows);
  assert.equal(first.ready, true);
});

test("pending見出しから単一行イベントへ遷移しても先行見出しをskippedへ残しready=falseにする", () => {
  const report = buildMigrationReportFromLegacyRows([
    ["", "■単一行には対応しない見出し", ""],
    ["", "10/3 19:00-21:00 独立イベント@新橋", ""],
  ], 2026);

  assert.equal(report.recordCount, 1);
  assert.equal(report.ready, false);
  assert.deepEqual(report.skipped, [{
    line: 1,
    text: "■単一行には対応しない見出し",
    reason: "見出しに対応する開催行がありません",
  }]);
});
