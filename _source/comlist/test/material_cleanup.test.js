const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CLEANUP_SCRIPT = path.join(__dirname, "../tools/cleanup_work.ps1");

function runCleanup(appRoot) {
  return spawnSync("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    CLEANUP_SCRIPT,
    "-GardenRootOverride",
    appRoot,
  ], { encoding: "utf8", windowsHide: true });
}

test("_work後片付けは安全な一時マイベストライフ配下で再帰削除し、処理中世代は競合回避で残す", (t) => {
  const script = fs.readFileSync(CLEANUP_SCRIPT, "utf8");
  // 未対応版へ実行すると本番固定パスを触るため、期待する安全な入口がなければここで赤にする。
  assert.match(script, /GardenRootOverride/);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "garden-cleanup-"));
  const appRoot = path.join(tempRoot, "マイベストライフ");
  const workRoot = path.join(appRoot, "_work");
  const generations = path.join(workRoot, ".material-generations");
  const active = path.join(generations, "run-active");
  const completed = path.join(generations, "run-completed");
  const outside = path.join(appRoot, "sentinel.json");
  fs.mkdirSync(path.join(active, "contacts", "deep"), { recursive: true });
  fs.mkdirSync(path.join(completed, "events", "deep"), { recursive: true });
  fs.mkdirSync(path.join(completed, "calendar"), { recursive: true });
  fs.mkdirSync(path.join(completed, "proof"), { recursive: true });
  fs.writeFileSync(path.join(active, ".in-progress"), "active", "utf8");
  fs.writeFileSync(path.join(active, "contacts", "deep", "active.json"), "{}", "utf8");
  for (const file of [
    path.join(completed, "contacts", "contacts.json"),
    path.join(completed, "events", "deep", "events.json"),
    path.join(completed, "calendar", "calendar.json"),
    path.join(completed, "proof", "snapshot_success.json"),
    path.join(workRoot, "nested", "material.json"),
  ]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{}", "utf8");
  }
  fs.writeFileSync(outside, "keep", "utf8");
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const activeResult = runCleanup(appRoot);
  assert.notEqual(activeResult.status, 0, activeResult.stdout + activeResult.stderr);
  assert.equal(fs.existsSync(path.join(active, "contacts", "deep", "active.json")), true);
  assert.equal(fs.existsSync(path.join(completed, "events", "deep", "events.json")), true);
  assert.match(activeResult.stdout, /PLAINTEXT_SWEEP: (FOUND|PENDING)/);
  assert.equal(fs.readFileSync(outside, "utf8"), "keep");

  fs.rmSync(active, { recursive: true, force: true });
  const manifestLock = path.join(workRoot, ".material-manifest.lock");
  fs.mkdirSync(manifestLock, { recursive: true });
  const lockedResult = runCleanup(appRoot);
  assert.notEqual(lockedResult.status, 0, lockedResult.stdout + lockedResult.stderr);
  assert.equal(fs.existsSync(manifestLock), true);
  assert.equal(fs.existsSync(path.join(completed, "events", "deep", "events.json")), true);
  assert.match(lockedResult.stdout, /SKIPPED_MANIFEST_LOCK|PLAINTEXT_SWEEP: FOUND/);

  fs.rmSync(manifestLock, { recursive: true, force: true });
  const cleanResult = runCleanup(appRoot);
  assert.equal(cleanResult.status, 0, cleanResult.stdout + cleanResult.stderr);
  assert.equal(fs.existsSync(workRoot) ? fs.readdirSync(workRoot).length : 0, 0);
  assert.match(cleanResult.stdout, /PLAINTEXT_SWEEP: OK/);
  assert.equal(fs.readFileSync(outside, "utf8"), "keep");
});
