const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function gas() {
  const store = {};
  const props = {
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: (k) => { delete store[k]; },
    getProperties: () => ({ ...store }),
  };
  const ctx = {
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../sheet-api.gs"), "utf8"), ctx);
  return { ctx, store };
}

test("チェックを保存して別の端末から読める", () => {
  const { ctx } = gas();
  assert.equal(ctx.taskState_({ op: "set", date: "2026-09-26", id: "notion:p1", done: true }).ok, true);
  assert.deepEqual({ ...ctx.taskState_({ op: "get", date: "2026-09-26" }).done }, { "notion:p1": true });
});

test("チェックを外すと消える", () => {
  const { ctx } = gas();
  ctx.taskState_({ op: "set", date: "2026-09-26", id: "a", done: true });
  ctx.taskState_({ op: "set", date: "2026-09-26", id: "a", done: false });
  assert.deepEqual({ ...ctx.taskState_({ op: "get", date: "2026-09-26" }).done }, {});
});

test("14日より古い日付は保存のたびに消す", () => {
  const { ctx, store } = gas();
  store["TASK_STATE_2026-09-01"] = '{"x":true}';
  store["TASK_STATE_2026-09-20"] = '{"y":true}';
  store.API_TOKEN = "keep";
  ctx.taskState_({ op: "set", date: "2026-09-26", id: "a", done: true });
  assert.equal("TASK_STATE_2026-09-01" in store, false);
  assert.equal("TASK_STATE_2026-09-20" in store, true);
  assert.equal(store.API_TOKEN, "keep");
});

test("日付やIDが不正なら書かない", () => {
  const { ctx, store } = gas();
  assert.equal(ctx.taskState_({ op: "set", date: "9/26", id: "a", done: true }).ok, false);
  assert.equal(ctx.taskState_({ op: "set", date: "2026-09-26", id: "", done: true }).ok, false);
  assert.equal(ctx.taskState_({ op: "set", date: "2026-09-26", id: "x".repeat(201), done: true }).ok, false);
  assert.equal(ctx.taskState_({ op: "drop", date: "2026-09-26" }).ok, false);
  assert.deepEqual(Object.keys(store), []);
});
