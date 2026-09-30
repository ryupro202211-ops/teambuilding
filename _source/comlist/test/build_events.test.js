"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { JSDOM } = require("jsdom");
const { buildMigrationReport } = require("../migrate_events.js");
const { writeAtomic: writeMigrationAtomic } = require("../migrate_events.js");
const { readMaterialFiles, writeAtomic: writeBuildAtomic } = require("../build.js");

const ROOT = path.join(__dirname, "..");
const ID = "evt_01JTEST00000000000000000";
const VALID_DISPLAY_EVENT = {
  id: ID,
  status: "公開",
  date: "2026-09-22",
  startTime: "19:00",
  endTime: "21:00",
  d: "9/22",
  dow: "火",
  t: "19:00-21:00",
  title: "交流会",
  place: "新橋",
  sheet: "https://docs.google.com/spreadsheets/d/test/edit",
  version: 1,
};

function verifiedSources() {
  return {
    calendar: { ok: true },
    notion: { ok: true },
    gmail: { ok: true, checkedThreads: 0, uniqueThreads: 0 },
  };
}

function runBuild(t, events, options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-build-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const files = {
    contacts: [{ _row: 2, "名前(あだ名)": "Synthetic fixture", "カテゴリー": "A" }],
    events,
    calendar: [],
    tasks: { date: "2026-09-22", sources: verifiedSources(), tasks: [] },
  };
  const args = [
    path.join(ROOT, "build.js"),
    "--today", "2026-09-22", "--now", "08:00",
    "--master", path.join(ROOT, "_assets", "list.html"),
    "--pass", "levelup",
  ];
  for (const [name, value] of Object.entries(files)) {
    const file = path.join(tempDir, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(value), "utf8");
    args.push(`--${name}`, file);
  }
  if (options.withProof !== false) {
    const manifest = {};
    for (const name of ["contacts", "events", "calendar"]) {
      const file = path.join(tempDir, `${name}.json`);
      const bytes = fs.readFileSync(file);
      manifest[name] = {
        path: path.basename(file),
        bytes: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex")
      };
    }
    fs.writeFileSync(path.join(tempDir, "snapshot_success.json"), JSON.stringify({
      version: 1, result: options.proofResult || "OK", source: "snapshot",
      generatedAt: options.generatedAt || new Date().toISOString(), files: manifest
    }), "utf8");
  }
  if (options.mutateContacts) fs.appendFileSync(path.join(tempDir, "contacts.json"), "\n");
  const out = path.join(tempDir, "comlist.html");
  args.push("--out", out);
  return { out, result: spawnSync(process.execPath, args, { encoding: "utf8" }) };
}

test("normal build refuses duplicate event ids before writing an artifact", t => {
  const { out, result } = runBuild(t, [VALID_DISPLAY_EVENT, { ...VALID_DISPLAY_EVENT }]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /イベントID.*重複/);
  assert.equal(fs.existsSync(out), false);
});

test("normal build refuses to write without a fresh snapshot proof", t => {
  const { out, result } = runBuild(t, [VALID_DISPLAY_EVENT], { withProof: false });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /スナップショット.*証跡/);
  assert.equal(fs.existsSync(out), false);
});

for (const [label, options, error] of [
  ["FALLBACK proof", { proofResult: "FALLBACK" }, /証跡がOKではありません/],
  ["stale proof", { generatedAt: "2026-09-20T00:00:00.000Z" }, /証跡が古すぎます/],
  ["changed material", { mutateContacts: true }, /証跡と素材の内容が一致しません/],
]) {
  test(`normal build refuses ${label} before writing an artifact`, t => {
    const { out, result } = runBuild(t, [VALID_DISPLAY_EVENT], options);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
    assert.equal(fs.existsSync(out), false);
  });
}

test("normal build writes a validated display event", t => {
  const { out, result } = runBuild(t, [VALID_DISPLAY_EVENT]);

  assert.equal(result.status, 0, result.stderr);
  const html = require("../app_sources").readApp(out);
  assert.match(html, /const EVENTS = \[\{[\s\S]*?"id":"evt_01JTEST00000000000000000"/);
  assert.match(html, /"d":"9\/22"/);
  assert.ok(html.includes('"sheet":"https://docs.google.com/spreadsheets/d/test/edit"'));
});

test("イベント文字列をインラインscriptへ安全に差し込み、script終端を実行しない", t => {
  const event = {
    ...VALID_DISPLAY_EVENT,
    title: "</script><script>globalThis.__reviewXss=1</script>",
    theme: "テーマ <script>globalThis.__reviewTheme=1</script>",
    place: "場所 </script><script>globalThis.__reviewPlace=1</script>",
    url: "https://example.com/?q=%3Cscript%3E",
  };
  const { out, result } = runBuild(t, [event]);

  assert.equal(result.status, 0, result.stderr);
  const dom = new JSDOM(require("../app_sources").readApp(out), {
    runScripts: "dangerously",
    url: "http://localhost",
  });
  t.after(() => dom.window.close());
  assert.equal(dom.window.__reviewXss, undefined);
  assert.equal(dom.window.__reviewTheme, undefined);
  assert.equal(dom.window.__reviewPlace, undefined);
  assert.match(require("../app_sources").readApp(out), /\\u003c\/script\\u003e/);
});

test("replaceArrayの置換文字列を展開せず、$&をイベント文字列として保持する", t => {
  const event = { ...VALID_DISPLAY_EVENT, title: "Fee $& test" };
  const { out, result } = runBuild(t, [event]);

  assert.equal(result.status, 0, result.stderr);
  const html = require("../app_sources").readApp(out);
  const match = html.match(/const EVENTS = (\[[\s\S]*?\]);/);
  assert.ok(match);
  assert.equal(JSON.parse(match[1])[0].title, "Fee $& test");
});

test("normal build accepts the legacy display-event fixture", t => {
  const { out, result } = runBuild(t, require("./fixtures/expected_events.json"));

  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(out));
});

for (const [label, event, message] of [
  ["an invalid date", { ...VALID_DISPLAY_EVENT, date: "2026-02-30" }, /開催日/],
  ["an invalid status", { ...VALID_DISPLAY_EVENT, status: "下書き" }, /状態/],
  ["an invalid URL", { ...VALID_DISPLAY_EVENT, url: "http://example.com" }, /案内URL/],
  ["an invalid display time", { ...VALID_DISPLAY_EVENT, t: "99:00-21:00" }, /表示時刻/],
  ["an invalid display sheet URL", { ...VALID_DISPLAY_EVENT, sheet: "http://example.com/sheet" }, /集計シートURL/],
  ["an invalid display sheet alias beside a canonical URL", { ...VALID_DISPLAY_EVENT, sheetUrl: VALID_DISPLAY_EVENT.sheet, sheet: "http://example.com/sheet" }, /集計シートURL/],
]) {
  test(`normal build refuses ${label} before writing an artifact`, t => {
    const { out, result } = runBuild(t, [event]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.equal(fs.existsSync(out), false);
  });
}

test("migration keeps a non-range time warning in the report", () => {
  const report = buildMigrationReport([
    { d: "9/22", t: "日中", title: "農業イベント" },
  ], 2026);

  assert.equal(report.recordCount, 1);
  assert.match(report.warnings[0].message, /日中/);
  assert.match(report.records[0].migrationWarning, /日中/);
});

test("移行は日付文字列全体を解析し、未対応の残りと欠落行をskippedへ残す", () => {
  const report = buildMigrationReport([
    { d: "9/22、10/3", t: "19:00-21:00", title: "複数日イベント" },
    { d: "9/22-23", t: "19:00-21:00", title: "解釈不能イベント" },
  ], 2026);

  assert.deepEqual(report.records.map(record => record.date), ["2026-09-22", "2026-10-03"]);
  assert.equal(report.sourceCount, 2);
  assert.equal(report.skipped.length, 1);
  assert.equal(report.ready, false);
  assert.match(report.skipped[0].reason, /開催日/);
});

test("ビルド素材は同じバイト列を一度だけ読み、証跡検証へ渡せる", () => {
  const contents = new Map([
    ["contacts.json", Buffer.from("[]", "utf8")],
    ["events.json", Buffer.from("[]", "utf8")],
    ["calendar.json", Buffer.from("[]", "utf8")],
  ]);
  const calls = [];
  const fakeFs = {
    readFileSync(file) {
      const name = path.basename(file);
      calls.push(name);
      return contents.get(name);
    },
  };

  const loaded = readMaterialFiles({
    contacts: "contacts.json",
    events: "events.json",
    calendar: "calendar.json",
  }, fakeFs);

  assert.deepEqual(calls, ["contacts.json", "events.json", "calendar.json"]);
  assert.equal(loaded.events.bytes.toString("utf8"), "[]");
  assert.ok(loaded.contacts.sha256);
});

test("migration CLI prints counts without event plaintext", t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-migration-cli-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const input = path.join(tempDir, "events.json");
  const reportPath = path.join(tempDir, "report.json");
  const title = "平文に出してはいけない農業イベント";
  const url = "https://example.com/private-event";
  fs.writeFileSync(input, JSON.stringify([{ d: "9/22", t: "日中", title, url }]), "utf8");

  const result = spawnSync(process.execPath, [
    path.join(ROOT, "migrate_events.js"),
    "--year", "2026", "--input", input, "--report", reportPath,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { sourceCount: 1, recordCount: 1, warningCount: 1 });
  assert.doesNotMatch(result.stdout, new RegExp(title));
  assert.doesNotMatch(result.stdout, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(result.stdout, /日中/);
  assert.match(fs.readFileSync(reportPath, "utf8"), new RegExp(title));
});

for (const [label, writer] of [
  ["build artifact", writeBuildAtomic],
  ["migration report", writeMigrationAtomic],
]) {
  test(`${label} write keeps the old file and removes its temporary file on rename failure`, t => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-atomic-"));
    t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
    const target = path.join(tempDir, `${label.replace(/ /g, "-")}.json`);
    fs.writeFileSync(target, "previous\n", "utf8");
    let temporaryPath = null;
    const failingFs = Object.create(fs);
    failingFs.renameSync = (from, to) => {
      temporaryPath = from;
      throw new Error("rename failed");
    };

    assert.throws(() => writer(target, "replacement\n", failingFs), /rename failed/);
    assert.equal(fs.readFileSync(target, "utf8"), "previous\n");
    assert.ok(temporaryPath);
    assert.equal(path.dirname(temporaryPath), path.dirname(target));
    assert.equal(fs.existsSync(temporaryPath), false);
    assert.deepEqual(fs.readdirSync(tempDir), [path.basename(target)]);
  });
}
