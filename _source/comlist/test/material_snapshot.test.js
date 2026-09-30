const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  validateSnapshot,
  snapshotDigest
} = require("../material_snapshot.js");
const {
  buildMaterialBytes,
  collectMaterials,
  createSnapshotProof,
  invalidateMaterialManifest,
  main,
  writeMaterialBatch,
  writeSnapshotProof
} = require("../fetch_materials.js");
const { readMaterialFiles, verifySnapshotProof } = require("../build.js");

const VALID_EVENT = {
  id: "evt_01JTEST00000000000000001",
  status: "公開",
  date: "2026-10-03",
  startTime: "19:00",
  endTime: "21:00",
  title: "交流会",
  theme: "経営者",
  place: "新橋",
  url: "https://example.com/event",
  sheetUrl: "https://docs.google.com/spreadsheets/d/test/edit",
  updatedAt: "2026-09-22T06:00:00+09:00",
  version: 1
};

const LEGACY_EVENT_ROWS = [
  ["", "■交流会", ""],
  ["", "9/30 19:00-21:00@新橋", ""]
];

function validSnapshot(overrides = {}) {
  const base = {
    version: 2,
    generatedAt: "2026-09-22T06:00:00+09:00",
    contacts: [
      { _row: 2, "カテゴリー": "A", "名前(あだ名)": "テスト太郎" }
    ],
    events: [VALID_EVENT],
    calendar: [["2026-09-22T18:00", "2026-09-22T19:00"]],
    counts: { contacts: 1, events: 1, calendar: 1 }
  };
  const snapshot = { ...base, ...overrides };
  snapshot.digest = snapshotDigest(snapshot);
  return snapshot;
}

test("fresh snapshot with matching counts and digest is accepted", () => {
  const snapshot = validSnapshot();
  const result = validateSnapshot(snapshot, {
    now: new Date("2026-09-22T07:00:00+09:00"),
    maxAgeMs: 3 * 60 * 60 * 1000
  });
  assert.equal(result.ageMs, 60 * 60 * 1000);
  assert.deepEqual(result.contacts, snapshot.contacts);
  assert.deepEqual(result.events, snapshot.events);
  assert.deepEqual(result.calendar, snapshot.calendar);
  assert.deepEqual(result.counts, { contacts: 1, events: 1, calendar: 1 });
  assert.equal(result.events[0].id, VALID_EVENT.id);
});

test("stale snapshot is rejected", () => {
  const snapshot = validSnapshot();
  assert.throws(() => validateSnapshot(snapshot, {
    now: new Date("2026-09-22T10:00:01+09:00"),
    maxAgeMs: 3 * 60 * 60 * 1000
  }), /古すぎます/);
});

test("count mismatch and digest mismatch are rejected", () => {
  const options = { now: new Date("2026-09-22T07:00:00+09:00") };
  const wrongCount = validSnapshot({ counts: { contacts: 2, events: 1, calendar: 1 } });
  wrongCount.digest = snapshotDigest(wrongCount);
  assert.throws(() => validateSnapshot(wrongCount, options), /件数/);

  const tampered = validSnapshot();
  tampered.contacts[0]["名前(あだ名)"] = "改ざん";
  assert.throws(() => validateSnapshot(tampered, options), /ハッシュ/);
});

test("snapshot digest is stable and excludes the digest field", () => {
  const snapshot = validSnapshot();
  const copy = { ...snapshot, digest: "ignored" };
  assert.equal(snapshotDigest(copy), snapshot.digest);
  assert.equal(snapshot.digest.length, 64);
  assert.match(snapshot.digest, /^[0-9a-f]+$/);
  assert.equal(
    snapshot.digest,
    crypto.createHash("sha256").update(JSON.stringify({
      version: snapshot.version,
      generatedAt: snapshot.generatedAt,
      contacts: snapshot.contacts,
      events: snapshot.events,
      calendar: snapshot.calendar,
      counts: snapshot.counts
    })).digest("hex")
  );
});

test("material collection uses one snapshot request when it is valid", async () => {
  const snapshot = validSnapshot();
  const calls = [];
  const result = await collectMaterials({
    token: "secret",
    year: 2026,
    now: new Date("2026-09-22T07:00:00+09:00"),
    readApiFn: async (_token, what) => {
      calls.push(what);
      return { ok: true, snapshot };
    }
  });
  assert.deepEqual(calls, ["snapshot"]);
  assert.equal(result.source, "snapshot");
  assert.deepEqual(result.contacts, snapshot.contacts);
  assert.deepEqual(result.calendar, snapshot.calendar);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].id, VALID_EVENT.id);
  assert.equal(result.events[0].d, "10/3");
});

test("material collection falls back to legacy endpoints when snapshot is unavailable", async () => {
  const calls = [];
  const result = await collectMaterials({
    token: "secret",
    year: 2026,
    now: new Date("2026-09-22T07:00:00+09:00"),
    readApiFn: async (_token, what) => {
      calls.push(what);
      if (what === "snapshot") throw new Error("unknown what");
      if (what === "contacts") return { records: validSnapshot().contacts };
      return { rows: LEGACY_EVENT_ROWS };
    }
  });
  assert.deepEqual(calls, ["snapshot", "contacts", "events"]);
  assert.equal(result.source, "legacy");
  assert.equal(result.calendar, null);
});

test("required snapshot never silently falls back", async () => {
  await assert.rejects(() => collectMaterials({
    token: "secret",
    year: 2026,
    requireSnapshot: true,
    readApiFn: async () => { throw new Error("snapshot unavailable"); }
}), /snapshot unavailable/);
});

test("snapshot素材の成功証跡は確定済みバイト列だけをハッシュし、固定パスを再読込しない", (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-proof-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const files = {
    contacts: path.join(tempDir, "contacts.json"),
    events: path.join(tempDir, "app_events.json"),
    calendar: path.join(tempDir, "calendar.json"),
  };
  const material = {
    source: "snapshot",
    generatedAt: new Date().toISOString(),
    contacts: validSnapshot().contacts,
    events: [{ id: VALID_EVENT.id, title: VALID_EVENT.title }],
    calendar: validSnapshot().calendar,
  };
  const bytes = buildMaterialBytes(material);
  fs.writeFileSync(files.contacts, "別実行の内容");
  fs.writeFileSync(files.events, "別実行の内容");
  fs.writeFileSync(files.calendar, "別実行の内容");
  const proof = createSnapshotProof(material, bytes, files);
  const proofPath = path.join(tempDir, "snapshot_success.json");
  writeSnapshotProof(proofPath, proof);
  const saved = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  assert.equal(saved.result, "OK");
  assert.equal(saved.source, "snapshot");
  assert.equal(saved.files.contacts.sha256.length, 64);
  assert.equal(saved.files.contacts.sha256, crypto.createHash("sha256").update(bytes.contacts).digest("hex"));
  assert.deepEqual(fs.readdirSync(tempDir).sort(), ["app_events.json", "calendar.json", "contacts.json", "snapshot_success.json"]);
});

test("snapshot素材3種と証跡は一意なtmp名から同じ生成物へ切り替える", (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-batch-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const files = {
    contacts: path.join(tempDir, "contacts.json"),
    events: path.join(tempDir, "app_events.json"),
    calendar: path.join(tempDir, "calendar.json"),
  };
  const proofFile = path.join(tempDir, "snapshot_success.json");
  const material = {
    source: "snapshot",
    generatedAt: "2026-09-23T06:00:00+09:00",
    contacts: [{ _row: 2, "カテゴリー": "A" }],
    events: [{ id: VALID_EVENT.id, title: "同一生成物" }],
    calendar: [["2026-09-23T18:00", "2026-09-23T19:00"]],
  };
  const writes = [];
  const renames = [];
  const fsApi = {
    mkdirSync: fs.mkdirSync.bind(fs),
    writeFileSync(file, data, encoding) {
      writes.push(String(file));
      return fs.writeFileSync(file, data, encoding);
    },
    renameSync(from, to) {
      renames.push([String(from), String(to)]);
      return fs.renameSync(from, to);
    },
    unlinkSync: fs.unlinkSync.bind(fs),
  };
  const result = writeMaterialBatch(material, files, proofFile, fsApi);
  const bytes = buildMaterialBytes(material);
  assert.deepEqual(result.bytes, bytes);
  const selected = readMaterialFiles(files);
  assert.equal(JSON.parse(selected.contacts.text)[0]["カテゴリー"], "A");
  assert.equal(JSON.parse(selected.events.text)[0].title, "同一生成物");
  const manifest = JSON.parse(fs.readFileSync(path.join(tempDir, "material_manifest.json"), "utf8"));
  const selectedProof = JSON.parse(fs.readFileSync(path.join(tempDir, manifest.files.proof), "utf8"));
  assert.deepEqual(selectedProof.files.contacts.bytes, bytes.contacts.length);
  assert.equal(writes.length, 6);
  assert.equal(renames.length, 5);
  assert.equal(writes.filter((file) => file.endsWith(".in-progress")).length, 1);
  const tempWrites = writes.filter((file) => file.includes(".tmp."));
  assert.equal(tempWrites.length, 5);
  assert.ok(tempWrites.every((file) => /\.tmp\.\d+\.\d+\.[0-9a-f]+$/i.test(file)));
});

test("素材世代はmanifestを一度だけ切り替え、後続世代の失敗で選択中の4素材を混在させない", (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-generation-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const files = {
    contacts: path.join(tempDir, "contacts.json"),
    events: path.join(tempDir, "app_events.json"),
    calendar: path.join(tempDir, "calendar.json"),
  };
  const proofFile = path.join(tempDir, "snapshot_success.json");
  const firstGeneratedAt = new Date().toISOString();
  const secondGeneratedAt = new Date(Date.now() + 1000).toISOString();
  const first = {
    source: "snapshot",
    generatedAt: firstGeneratedAt,
    contacts: [{ _row: 2, "カテゴリー": "A", "名前(あだ名)": "世代A" }],
    events: [{ id: VALID_EVENT.id, title: "世代A" }],
    calendar: [["2026-09-23T18:00", "2026-09-23T19:00"]],
  };
  const second = {
    ...first,
    generatedAt: secondGeneratedAt,
    contacts: [{ _row: 2, "カテゴリー": "A", "名前(あだ名)": "世代B" }],
    events: [{ id: VALID_EVENT.id, title: "世代B" }],
    calendar: [["2026-09-23T20:00", "2026-09-23T21:00"]],
  };

  writeMaterialBatch(first, files, proofFile);
  const manifestPath = path.join(tempDir, "material_manifest.json");
  assert.equal(fs.existsSync(manifestPath), true);
  const selectedBefore = readMaterialFiles(files);
  assert.equal(selectedBefore.contacts.text.includes("世代A"), true);
  assert.equal(verifySnapshotProof(files.contacts, files.events, files.calendar, proofFile).result, "OK");

  const failingFs = {
    mkdirSync: fs.mkdirSync.bind(fs),
    writeFileSync: fs.writeFileSync.bind(fs),
    unlinkSync: fs.unlinkSync.bind(fs),
    renameSync(from, to) {
      if (String(to).endsWith("material_manifest.json")) throw new Error("manifest切替失敗");
      return fs.renameSync(from, to);
    },
  };
  const generationRoot = path.join(tempDir, ".material-generations");
  const generationsBeforeFailure = new Set(fs.readdirSync(generationRoot));
  assert.throws(() => writeMaterialBatch(second, files, proofFile, failingFs), /manifest切替失敗/);
  const failedGeneration = fs.readdirSync(generationRoot).find((name) => !generationsBeforeFailure.has(name));
  assert.ok(failedGeneration);
  assert.equal(fs.existsSync(path.join(generationRoot, failedGeneration, ".in-progress")), true);
  const selectedAfter = readMaterialFiles(files);
  assert.equal(selectedAfter.contacts.text.includes("世代A"), true);
  assert.equal(selectedAfter.events.text.includes("世代A"), true);
  assert.equal(selectedAfter.calendar.text.includes("18:00"), true);
  assert.equal(JSON.parse(fs.readFileSync(manifestPath, "utf8")).generatedAt, first.generatedAt);
});

test("素材writerはmanifest lockを世代作成より先に取得し、cleanup中にactive世代を始めない", (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-writer-lock-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const files = {
    contacts: path.join(tempDir, "contacts.json"),
    events: path.join(tempDir, "app_events.json"),
    calendar: path.join(tempDir, "calendar.json"),
  };
  const proofFile = path.join(tempDir, "snapshot_success.json");
  const material = {
    source: "snapshot",
    generatedAt: "2026-09-23T06:00:00+09:00",
    contacts: [{ _row: 2, "カテゴリー": "A" }],
    events: [{ id: VALID_EVENT.id, title: "lock中" }],
    calendar: [["2026-09-23T18:00", "2026-09-23T19:00"]],
  };
  const lockPath = path.join(tempDir, ".material-manifest.lock");
  fs.mkdirSync(lockPath);
  const mkdirs = [];
  const fsApi = {
    mkdirSync(target, ...args) {
      mkdirs.push(String(target));
      return fs.mkdirSync(target, ...args);
    },
    writeFileSync: fs.writeFileSync.bind(fs),
    renameSync: fs.renameSync.bind(fs),
    unlinkSync: fs.unlinkSync.bind(fs),
    rmSync: fs.rmSync.bind(fs),
    rmdirSync: fs.rmdirSync.bind(fs),
    existsSync: fs.existsSync.bind(fs),
    readFileSync: fs.readFileSync.bind(fs),
  };
  assert.throws(() => writeMaterialBatch(material, files, proofFile, fsApi), /別実行で更新中/);
  assert.equal(mkdirs[0], lockPath);
  assert.equal(mkdirs.some((target) => target.includes(".material-generations")), false);
  assert.deepEqual(fs.readdirSync(tempDir), [".material-manifest.lock"]);
});

test("FALLBACKは選択中manifestをCAS付きで無効化し、旧OK proofをbuildへ渡さない", (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-fallback-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const files = {
    contacts: path.join(tempDir, "contacts.json"),
    events: path.join(tempDir, "app_events.json"),
    calendar: path.join(tempDir, "calendar.json"),
  };
  const proofFile = path.join(tempDir, "snapshot_success.json");
  const material = {
    source: "snapshot",
    generatedAt: new Date().toISOString(),
    contacts: [{ _row: 2, "カテゴリー": "A" }],
    events: [{ id: VALID_EVENT.id, title: "旧成功世代" }],
    calendar: [["2026-09-23T18:00", "2026-09-23T19:00"]],
  };
  writeMaterialBatch(material, files, proofFile);
  const manifestPath = path.join(tempDir, "material_manifest.json");
  const selectedManifest = fs.readFileSync(manifestPath, "utf8");

  fs.writeFileSync(files.contacts, "fallback contacts", "utf8");
  fs.writeFileSync(files.events, "fallback events", "utf8");
  fs.writeFileSync(files.calendar, "fallback calendar", "utf8");
  fs.rmSync(proofFile, { force: true });

  assert.equal(invalidateMaterialManifest(manifestPath, selectedManifest), true);
  assert.throws(() => readMaterialFiles(files), /無効/);
  assert.throws(() => verifySnapshotProof(files.contacts, files.events, files.calendar, proofFile), /無効|証跡/);
});

test("FALLBACKの古いmanifest無効化は並行する新成功世代を削除しない", (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-fallback-cas-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const files = {
    contacts: path.join(tempDir, "contacts.json"),
    events: path.join(tempDir, "app_events.json"),
    calendar: path.join(tempDir, "calendar.json"),
  };
  const proofFile = path.join(tempDir, "snapshot_success.json");
  const first = {
    source: "snapshot",
    generatedAt: new Date().toISOString(),
    contacts: [{ _row: 2, "名前(あだ名)": "世代A" }],
    events: [{ id: VALID_EVENT.id, title: "世代A" }],
    calendar: [["2026-09-23T18:00", "2026-09-23T19:00"]],
  };
  const second = {
    ...first,
    generatedAt: new Date(Date.now() + 1000).toISOString(),
    contacts: [{ _row: 2, "名前(あだ名)": "世代B" }],
    events: [{ id: VALID_EVENT.id, title: "世代B" }],
  };
  writeMaterialBatch(first, files, proofFile);
  const manifestPath = path.join(tempDir, "material_manifest.json");
  const oldManifest = fs.readFileSync(manifestPath, "utf8");
  writeMaterialBatch(second, files, proofFile);

  assert.equal(invalidateMaterialManifest(manifestPath, oldManifest), false);
  const selected = readMaterialFiles(files);
  assert.equal(selected.contacts.text.includes("世代B"), true);
  assert.equal(verifySnapshotProof(files.contacts, files.events, files.calendar, proofFile).result, "OK");
});

test("実mainのFALLBACKは最初に無効化したmanifestだけを比較し、新成功Bをinvalidatedにしない", async (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-fallback-main-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const files = {
    contacts: path.join(tempDir, "contacts.json"),
    events: path.join(tempDir, "app_events.json"),
    calendar: path.join(tempDir, "calendar.json"),
  };
  const proofFile = path.join(tempDir, "snapshot_success.json");
  const first = {
    source: "snapshot",
    generatedAt: "2026-09-23T05:00:00+09:00",
    contacts: [{ _row: 2, "名前(あだ名)": "世代A" }],
    events: [{ id: VALID_EVENT.id, title: "世代A" }],
    calendar: [["2026-09-23T18:00", "2026-09-23T19:00"]],
  };
  const second = {
    ...first,
    generatedAt: "2026-09-23T06:00:00+09:00",
    contacts: [{ _row: 2, "名前(あだ名)": "世代B" }],
    events: [{ id: VALID_EVENT.id, title: "世代B" }],
    calendar: [["2026-09-23T20:00", "2026-09-23T21:00"]],
  };
  writeMaterialBatch(first, files, proofFile);
  const manifestPath = path.join(tempDir, "material_manifest.json");
  let invalidationCount = 0;
  const result = await main({
    args: { year: 2026 },
    token: "test-token",
    outDir: tempDir,
    readApiFn: async (_token, what) => {
      if (what === "snapshot") throw new Error("snapshot unavailable");
      if (what === "contacts") return { records: first.contacts };
      return { rows: LEGACY_EVENT_ROWS };
    },
    invalidateMaterialManifestFn: (manifest, expectedRaw, options) => {
      const invalidated = invalidateMaterialManifest(manifest, expectedRaw, options);
      if (invalidated && invalidationCount++ === 0) writeMaterialBatch(second, files, proofFile);
      return invalidated;
    },
  });
  assert.equal(result, undefined);
  assert.equal(invalidationCount, 1);
  const selected = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(selected.status, "active");
  assert.equal(selected.generatedAt, second.generatedAt);
  assert.equal(readMaterialFiles(files).contacts.text.includes("世代B"), true);
});
