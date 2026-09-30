#!/usr/bin/env node
"use strict";
/**
 * 素材（連絡先・イベント）を Apps Script から取得して _work に置く。
 *
 *   node fetch_materials.js --year 2026
 *   node fetch_materials.js --suffix .api     … 移行検証用に別名で出す
 *
 * トークンは作業フォルダの2階層上にある .garden_token から読むだけで、
 * 画面にもログにも出さない。URLにも乗せない（POSTのボディで渡す）。
 * カレンダーは対象外（従来どおり Calendar MCP で取る）。
 * 出力先は常に _work 固定（平文の個人情報を _work の外に出さないため）。
 */

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { parseEvents } = require("./parse_events.js");
const { validateSnapshot } = require("./material_snapshot.js");
const { validateEventList, eventToDisplay } = require("./event_records.js");
const { buildMigrationReportFromLegacyRows } = require("./migrate_events.js");

const API_URL = "https://script.google.com/macros/s/AKfycbzPbYrccXmQcGZX9LmSwGUpn5nhqslJvhstwjVjvL8RR7LjnI94C_4udh7fxV9LfRFI/exec";
function resolveTokenFile(projectDir) {
  // 引数ありは従来の相対位置（テスト用）。通常は garden.config.json の gardenToken を使う
  if (projectDir) return path.resolve(projectDir, "..", "..", ".garden_token");
  return require("./garden_paths.js").loadGardenPaths().gardenToken;
}
const TOKEN_FILE = resolveTokenFile();
const RETRY_WAIT_MS = [5000, 15000, 30000];

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const key = t.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { a[key] = true; }
    else { a[key] = next; i++; }
  }
  return a;
}
const OUT_DIR = "_work";

function materialJsonBytes(value) {
  return Buffer.from(JSON.stringify(value, null, 2), "utf8");
}

function buildMaterialBytes(material) {
  if (!material || material.source !== "snapshot") throw new Error("スナップショット素材を確定できません");
  return {
    contacts: materialJsonBytes(material.contacts),
    events: materialJsonBytes(material.events),
    calendar: materialJsonBytes(material.calendar),
  };
}

function createSnapshotProof(material, bytesByName, files = {}) {
  if (!material || material.source !== "snapshot") throw new Error("スナップショット成功証跡を作成できません");
  const names = ["contacts", "events", "calendar"];
  const manifest = {};
  names.forEach((name) => {
    const bytes = bytesByName && bytesByName[name];
    if (!bytes || (typeof bytes === "string" || typeof bytes === "number") || typeof bytes.length !== "number") {
      throw new Error("確定済み素材バイト列が見つかりません: " + name);
    }
    const filePath = files[name];
    manifest[name] = {
      path: filePath ? path.basename(filePath) : `${name}.json`,
      bytes: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex")
    };
  });
  return {
    version: 1,
    result: "OK",
    source: "snapshot",
    generatedAt: material.generatedAt,
    files: manifest
  };
}

function uniqueMaterialTempPath(filePath) {
  return `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(12).toString("hex")}`;
}

function materialManifestPath(files) {
  const contactsName = path.basename(files.contacts);
  const match = contactsName.match(/^contacts(.*)\.json$/);
  const suffix = match ? match[1] : "";
  return path.join(path.dirname(files.contacts), `material_manifest${suffix}.json`);
}

function writeMaterialManifest(manifestPath, manifest, fsApi) {
  const temporary = uniqueMaterialTempPath(manifestPath);
  try {
    fsApi.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    fsApi.renameSync(temporary, manifestPath);
  } catch (error) {
    try { if (fsApi.unlinkSync) fsApi.unlinkSync(temporary); } catch (ignore) { /* preserve the original error */ }
    throw error;
  }
}

function withMaterialManifestLock(baseDir, fsApi, action) {
  if (!fsApi.mkdirSync || (!fsApi.rmdirSync && !fsApi.rmSync)) return action();
  const lockPath = path.join(baseDir, ".material-manifest.lock");
  try {
    fsApi.mkdirSync(lockPath);
  } catch (error) {
    throw new Error("素材manifestが別実行で更新中のため停止しました");
  }
  try {
    return action();
  } finally {
    try {
      if (fsApi.rmdirSync) fsApi.rmdirSync(lockPath);
      else fsApi.rmSync(lockPath, { recursive: true, force: true });
    } catch (ignore) { /* preserve the operation result; cleanup script will keep the lock visible */ }
  }
}

function invalidateMaterialManifest(manifestPath, expectedRaw, options = {}) {
  const fsApi = options.fsApi || fs;
  return withMaterialManifestLock(path.dirname(manifestPath), fsApi, () => {
    if (!fsApi.existsSync || !fsApi.existsSync(manifestPath)) return false;
    const currentRaw = fsApi.readFileSync(manifestPath, "utf8");
    if (typeof expectedRaw !== "string" || currentRaw !== expectedRaw) return false;
    let manifest;
    try {
      manifest = JSON.parse(currentRaw);
    } catch (error) {
      throw new Error("素材manifestを無効化できません");
    }
    if (!manifest || manifest.version !== 1 || !manifest.files) {
      throw new Error("素材manifestの形式が不正なため無効化できません");
    }
    writeMaterialManifest(manifestPath, {
      ...manifest,
      status: "invalidated",
      invalidatedAt: new Date().toISOString(),
      invalidationPhase: options.phase || "fallback",
    }, fsApi);
    return true;
  });
}

function writeMaterialBatch(material, files, proofFile, fsApi = fs) {
  if (!files || !proofFile) throw new Error("素材出力先が指定されていません");
  const baseDir = path.dirname(files.contacts);
  for (const target of [files.events, files.calendar, proofFile]) {
    if (path.dirname(target) !== baseDir) throw new Error("素材出力先は同じディレクトリに揃えてください");
  }
  return withMaterialManifestLock(baseDir, fsApi, () => {
    const bytes = buildMaterialBytes(material);
    const proof = createSnapshotProof(material, bytes, files);
    const runId = `${process.pid}-${Date.now()}-${crypto.randomBytes(12).toString("hex")}`;
    const generationRelative = path.join(".material-generations", runId);
    const generationDir = path.join(baseDir, generationRelative);
    const generationMarker = path.join(generationDir, ".in-progress");
    const generationFiles = {
      contacts: path.join(generationDir, path.basename(files.contacts)),
      events: path.join(generationDir, path.basename(files.events)),
      calendar: path.join(generationDir, path.basename(files.calendar)),
    };
    const generationProof = path.join(generationDir, path.basename(proofFile));
    const entries = [
      [generationFiles.contacts, bytes.contacts],
      [generationFiles.events, bytes.events],
      [generationFiles.calendar, bytes.calendar],
      [generationProof, Buffer.from(JSON.stringify(proof, null, 2), "utf8")],
    ];
    const temporaryPaths = [];
    let manifestSwitched = false;
    let markerWritten = false;
    try {
      if (fsApi.mkdirSync) fsApi.mkdirSync(generationDir, { recursive: true });
      fsApi.writeFileSync(generationMarker, JSON.stringify({ version: 1, runId }) + "\n", "utf8");
      markerWritten = true;
      entries.forEach(([target, content]) => {
        const directory = path.dirname(target);
        if (fsApi.mkdirSync) fsApi.mkdirSync(directory, { recursive: true });
        const temporary = uniqueMaterialTempPath(target);
        temporaryPaths.push(temporary);
        fsApi.writeFileSync(temporary, content);
      });
      entries.forEach(([target], index) => fsApi.renameSync(temporaryPaths[index], target));
      const manifest = {
        version: 1,
        status: "active",
        generatedAt: proof.generatedAt,
        generation: generationRelative.split(path.sep).join("/"),
        files: {
          contacts: path.relative(baseDir, generationFiles.contacts).split(path.sep).join("/"),
          events: path.relative(baseDir, generationFiles.events).split(path.sep).join("/"),
          calendar: path.relative(baseDir, generationFiles.calendar).split(path.sep).join("/"),
          proof: path.relative(baseDir, generationProof).split(path.sep).join("/"),
        },
      };
      writeMaterialManifest(materialManifestPath(files), manifest, fsApi);
      manifestSwitched = true;
      if (!fsApi.unlinkSync) throw new Error("素材世代の処理中印を解除できません");
      fsApi.unlinkSync(generationMarker);
      markerWritten = false;
      return { bytes, proof, manifest };
    } catch (error) {
      temporaryPaths.forEach((temporary) => {
        try { if (fsApi.unlinkSync) fsApi.unlinkSync(temporary); } catch (ignore) { /* preserve the original error */ }
      });
      if (manifestSwitched) {
        if (markerWritten && fsApi.unlinkSync) {
          try { fsApi.unlinkSync(generationMarker); } catch (ignore) { /* preserve the original error */ }
        }
      } else if (fsApi.rmSync) {
        try { fsApi.rmSync(generationDir, { recursive: true, force: true }); } catch (ignore) { /* preserve the original error */ }
      }
      throw error;
    }
  });
}

function writeSnapshotProof(file, proof) {
  writeAtomic(file, proof);
}

function readToken() {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error("トークンファイルが見つかりません: " + TOKEN_FILE);
  }
  const t = fs.readFileSync(TOKEN_FILE, "utf8").trim();
  if (!t) throw new Error("トークンファイルが空です: " + TOKEN_FILE);
  return t;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 失敗しても本文やトークンを出さない。何が起きたかだけ伝える。
async function readApi(token, what) {
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRY_WAIT_MS.length; attempt++) {
    if (attempt > 0) {
      console.log("  再試行 " + attempt + "（" + (RETRY_WAIT_MS[attempt - 1] / 1000) + "秒待機）");
      await sleep(RETRY_WAIT_MS[attempt - 1]);
    }
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token, action: "read", what: what })
      });
      if (!res.ok) { lastErr = new Error("HTTP " + res.status); continue; }
      const j = await res.json();
      if (!j || j.ok !== true) {
        const e = (j && j.error) || "unknown";
        // unauthorized も再試行する。Apps Script は正しいトークンでも一時的にこれを返すこと
        // があり（実際に観測済み）、即座に諦めると毎朝の自動実行がその一回で落ちるため。
        lastErr = new Error(e === "unauthorized"
          ? "トークンが拒否されました（値は表示しません）"
          : "APIエラー: " + e);
        continue;
      }
      return j;
    } catch (err) {
      lastErr = err;
    }
  }
  const hint = /拒否されました/.test(lastErr.message)
    ? "。トークンが違うか、Apps Script 側が一時的に拒否しています"
    : "";
  throw new Error(what + " の取得に失敗しました: " + lastErr.message + hint);
}

// 一時ファイルに書き切ってから移動する。中途半端な素材を残さない。
function writeAtomic(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

async function collectMaterials(options) {
  const token = options.token;
  const year = options.year;
  const readApiFn = options.readApiFn || readApi;
  const now = options.now || new Date();
  let snapshotError = null;
  try {
    const response = await readApiFn(token, "snapshot");
    const material = validateSnapshot(response && response.snapshot, { now });
    const skipped = [];
    return {
      source: "snapshot",
      generatedAt: material.generatedAt,
      contacts: material.contacts,
      events: validateEventList(material.events).map(eventToDisplay),
      calendar: material.calendar,
      skipped: skipped
    };
  } catch (err) {
    snapshotError = err;
  }
  if (options.requireSnapshot) throw snapshotError;

  const cj = await readApiFn(token, "contacts");
  if (!Array.isArray(cj.records)) throw new Error("連絡先の応答形式が想定と違います");
  const contacts = cj.records;
  if (contacts.length === 0) throw new Error("連絡先が0件です。素材が取れていません");
  const ej = await readApiFn(token, "events");
  if (!Array.isArray(ej.rows)) throw new Error("イベントの応答形式が想定と違います");
  const rows = ej.rows;
  const skipped = [];
  return {
    source: "legacy",
    snapshotError: snapshotError,
    contacts: contacts,
    rows: rows,
    events: parseEvents(rows, { year: year, skipped: skipped }),
    calendar: null,
    skipped: skipped
  };
}

async function collectLegacyV1Migration(options) {
  const year = options.year;
  if (!Number.isInteger(year)) throw new Error("旧v1移行には --year が必要です");
  const readApiFn = options.readApiFn || readApi;
  const response = await readApiFn(options.token, "snapshot");
  const snapshot = response && response.snapshot;
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.eventRows)) {
    throw new Error("旧v1スナップショットではありません。通常取得とは別の移行経路を指定してください");
  }
  const report = buildMigrationReportFromLegacyRows(snapshot.eventRows, year);
  return {
    sourceVersion: 1,
    generatedAt: snapshot.generatedAt || "",
    report,
    eventRows: snapshot.eventRows,
  };
}

async function main(runtime = {}) {
  const args = runtime.args || parseArgs(process.argv);
  const year = Number(args.year) || new Date().getFullYear();
  const suffix = typeof args.suffix === "string" ? args.suffix : "";
  const token = runtime.token || readToken();
  const fsApi = runtime.fsApi || fs;
  const outDir = runtime.outDir || OUT_DIR;
  const readApiFn = runtime.readApiFn || readApi;
  const invalidateMaterialManifestFn = runtime.invalidateMaterialManifestFn || invalidateMaterialManifest;
  const writeAtomicFn = runtime.writeAtomicFn || writeAtomic;
  const writeMaterialBatchFn = runtime.writeMaterialBatchFn || writeMaterialBatch;
  fsApi.mkdirSync(outDir, { recursive: true });

  if (args["migration-report"] !== undefined) {
    if (args["legacy-v1"] !== true) {
      throw new Error("--migration-report は --legacy-v1 と組み合わせてください");
    }
    console.log("旧v1素材を移行レポートへ変換中...");
    const migration = await collectLegacyV1Migration({ token, year });
    const reportFile = path.resolve(String(args["migration-report"]));
    writeAtomicFn(reportFile, migration.report);
    console.log(JSON.stringify({
      sourceVersion: migration.sourceVersion,
      reportId: migration.report.reportId,
      sourceCount: migration.report.sourceCount,
      recordCount: migration.report.recordCount,
      skippedCount: migration.report.skipped.length,
      ready: migration.report.ready,
    }) + "\n");
    return migration.report;
  }

  console.log("GAS同期スナップショットを取得中...");
  const material = await collectMaterials({
    token: token,
    year: year,
    requireSnapshot: args["require-snapshot"] === true,
    readApiFn: readApiFn
  });
  const contacts = material.contacts;
  const rows = material.rows || [];
  const events = material.events;

  const cFile = path.join(outDir, "contacts" + suffix + ".json");
  const eFile = path.join(outDir, "app_events" + suffix + ".json");
  let calFile = null;
  if (material.calendar) {
    calFile = path.join(outDir, "calendar" + suffix + ".json");
  }

  const proofFile = path.join(outDir, "snapshot_success" + suffix + ".json");
  if (material.source === "snapshot" && calFile) {
    writeMaterialBatchFn(material, {
      contacts: cFile,
      events: eFile,
      calendar: calFile
    }, proofFile);
  } else {
    const manifestPath = materialManifestPath({ contacts: cFile });
    if (fsApi.existsSync(manifestPath)) {
      const selectedManifestRaw = fsApi.readFileSync(manifestPath, "utf8");
      if (!invalidateMaterialManifestFn(manifestPath, selectedManifestRaw, { phase: "before-fallback" })) {
        throw new Error("素材manifestが並行更新されたためFALLBACKを中止しました");
      }
    }
    writeAtomicFn(cFile, contacts);
    writeAtomicFn(eFile, events);
    if (fsApi.existsSync(proofFile)) fsApi.unlinkSync(proofFile);
  }

  const cats = {};
  contacts.forEach((o) => { const k = o["カテゴリー"] || "?"; cats[k] = (cats[k] || 0) + 1; });
  console.log("OK");
  console.log("  取得元: " + (material.source === "snapshot"
    ? "GAS同期スナップショット (" + material.generatedAt + ")"
    : "従来API（GASスナップショット未使用）"));
  console.log("  連絡先: " + contacts.length + "件 (" +
    Object.keys(cats).sort().map((k) => k + ":" + cats[k]).join(" ") + ") → " + cFile);
  const eventDetail = material.source === "legacy"
    ? "（本文のある行 " + rows.filter((r) => String(r[1] || "").trim()).length + "）"
    : "（構造化イベント）";
  console.log("  イベント: " + events.length + "件" + eventDetail + " → " + eFile);
  if (calFile) {
    console.log("  カレンダー: " + material.calendar.length + "件 → " + calFile);
    console.log("SNAPSHOT_RESULT: OK");
    console.log("SNAPSHOT_PROOF: " + proofFile);
  } else {
    console.log("SNAPSHOT_RESULT: FALLBACK（calendar.json は従来どおりCalendar MCPで作成）");
  }
  // 解釈できなかった行は黙って捨てない。人が気づけるように必ず出す。
  if (material.skipped.length) {
    console.log("  解釈できなかった行: " + material.skipped.length + "件");
    material.skipped.forEach((s) => console.log("    " + s.line + "行目: " + s.text));
  }
}

if (require.main === module) main().catch((err) => {
  console.error("ERROR: " + err.message);
  process.exit(1);
});

module.exports = {
  buildMaterialBytes,
  collectLegacyV1Migration,
  collectMaterials,
  createSnapshotProof,
  main,
  parseArgs,
  resolveTokenFile,
  writeMaterialBatch,
  invalidateMaterialManifest,
  materialManifestPath,
  writeSnapshotProof,
};
