const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const MASTER = require("../app_sources").readApp(path.join(__dirname, "../_assets/list.html"));
// 日付を直書きすると、その日を過ぎた時点で「過去のイベント」に回って検証が壊れる。実行日からの相対にする。
const daysFromToday = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
const EVENT_DATE = daysFromToday(7);
const LATEST_DATE = daysFromToday(15);
const EVENT = {
  id: "evt_01JTEST00000000000000000",
  status: "公開",
  date: EVENT_DATE,
  startTime: "19:00",
  endTime: "21:00",
  title: "交流会",
  theme: "経営者",
  place: "新橋",
  url: "https://example.com/event",
  sheetUrl: "https://docs.google.com/spreadsheets/d/test/edit",
  updatedAt: "2026-09-22T14:00:00+09:00",
  version: 3,
};

function appSource(events = [EVENT], fresh = true) {
  return MASTER
    .replace('let EVENTS_FRESH = false;', `let EVENTS_FRESH = ${fresh};`)
    .replace('<script src="data.js"></script>', '<script>let DATA=[];</script>')
    .replace(/const EVENTS = \[[\s\S]*?\];\r?\n\r?\n\/\* 🕒/, `const EVENTS = ${JSON.stringify(events)};\n\n/* 🕒`);
}

async function loadApp({ events, fetchImpl, token = "test-token", fresh = true } = {}) {
  const requests = [];
  const dom = new JSDOM(appSource(events, fresh), {
    runScripts: "dangerously",
    url: "http://localhost",
    beforeParse(window) {
      window.localStorage.setItem("comunitylisttolevel9", token);
      window.fetch = async (...args) => {
        requests.push(args);
        if (fetchImpl) return fetchImpl(...args);
        return { json: async () => ({ ok: true, events: events || [EVENT] }) };
      };
      window.confirm = () => true;
      window.alert = () => {};
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { dom, requests };
}

function setInput(dom, id, value) {
  dom.window.document.getElementById(id).value = value;
}

test("イベント追加ボタンは空の編集フォームを開く", async (t) => {
  const { dom } = await loadApp();
  t.after(() => dom.window.close());
  dom.window.document.getElementById("eventAdd").click();
  assert.equal(dom.window.document.getElementById("eventEditor").hidden, false);
  assert.equal(dom.window.document.getElementById("eventTitle").value, "");
  assert.equal(dom.window.document.getElementById("eventDate").value, "");
});

test("追加保存はeventCreateを送り、返却イベントで一覧を更新する", async (t) => {
  const created = { ...EVENT, id: "evt_01JCREATED0000000000000000", title: "新しい交流会", version: 1 };
  const { dom, requests } = await loadApp({
    events: [],
    fetchImpl: async (_url, options) => ({
      json: async () => options && JSON.parse(options.body).action === "eventCreate"
        ? { ok: true, event: created }
        : { ok: true, events: [] },
    }),
  });
  t.after(() => dom.window.close());
  dom.window.document.getElementById("eventAdd").click();
  setInput(dom, "eventDate", EVENT_DATE);
  setInput(dom, "eventStartTime", "19:00");
  setInput(dom, "eventEndTime", "21:00");
  setInput(dom, "eventTitle", "新しい交流会");
  await dom.window.saveEventEditor();
  const body = JSON.parse(requests.at(-1)[1].body);
  assert.equal(body.action, "eventCreate");
  assert.equal(Object.prototype.hasOwnProperty.call(body.event, "version"), false);
  assert.equal(dom.window.document.querySelector(".ev-title").textContent.includes("新しい交流会"), true);
});

test("追加保存の通信失敗後は同じrequestIdで再送する", async (t) => {
  const created = { ...EVENT, id: "evt_01JRETRY0000000000000000", title: "再送イベント", version: 1 };
  const requests = [];
  let calls = 0;
  const { dom } = await loadApp({
    events: [],
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      calls += 1;
      if (calls === 1) throw new Error("通信失敗");
      return { json: async () => ({ ok: true, event: created }) };
    },
  });
  t.after(() => dom.window.close());
  dom.window.document.getElementById("eventAdd").click();
  setInput(dom, "eventDate", EVENT_DATE);
  setInput(dom, "eventStartTime", "19:00");
  setInput(dom, "eventEndTime", "21:00");
  setInput(dom, "eventTitle", "再送イベント");
  await dom.window.saveEventEditor();
  await dom.window.saveEventEditor();
  assert.match(requests[0].requestId, /^[A-Za-z0-9_-]{16,80}$/);
  assert.equal(requests[1].requestId, requests[0].requestId);
});

test("追加フォームの成功・キャンセル後は新しいrequestIdを使う", async (t) => {
  let sequence = 0;
  const requests = [];
  const { dom } = await loadApp({
    events: [],
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      sequence += 1;
      return { json: async () => ({ ok: true, event: { ...EVENT, id: `evt_01JNEW${String(sequence).padStart(16, "0")}`, version: 1 } }) };
    },
  });
  t.after(() => dom.window.close());
  const fillAndSave = async () => {
    dom.window.document.getElementById("eventAdd").click();
    setInput(dom, "eventDate", EVENT_DATE);
    setInput(dom, "eventStartTime", "19:00");
    setInput(dom, "eventEndTime", "21:00");
    setInput(dom, "eventTitle", "新規イベント");
    await dom.window.saveEventEditor();
  };
  await fillAndSave();
  const firstId = requests[0].requestId;
  await fillAndSave();
  const secondId = requests[1].requestId;
  dom.window.document.getElementById("eventAdd").click();
  dom.window.document.getElementById("eventCancel").click();
  await fillAndSave();
  assert.notEqual(secondId, firstId);
  assert.notEqual(requests[2].requestId, secondId);
});

test("API失敗時は入力内容を残し、保存ボタンの連打を防ぐ", async (t) => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { dom } = await loadApp({
    fetchImpl: async () => {
      calls += 1;
      await pending;
      return { json: async () => ({ ok: false, error: "failed" }) };
    },
  });
  t.after(() => dom.window.close());
  dom.window.document.getElementById("eventEdit").click();
  setInput(dom, "eventTitle", "残すタイトル");
  const first = dom.window.saveEventEditor();
  const second = dom.window.saveEventEditor();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(dom.window.document.getElementById("eventTitle").value, "残すタイトル");
  assert.match(dom.window.document.getElementById("eventError").textContent, /保存できませんでした/);
});

test("イベント保存は長時間かかるApps Scriptの完了を待つ", async (t) => {
  const { dom } = await loadApp({
    fetchImpl: async () => ({ json: async () => ({ ok: true, event: { ...EVENT, version: 4 } }) }),
  });
  t.after(() => dom.window.close());
  let timeoutMs = 0;
  dom.window.AbortSignal.timeout = (ms) => {
    timeoutMs = ms;
    return new dom.window.AbortController().signal;
  };
  dom.window.document.getElementById("eventEdit").click();
  await dom.window.saveEventEditor();
  assert.ok(timeoutMs >= 360000, `保存待機が短すぎます: ${timeoutMs}ms`);
});

test("保存処理中は保存ボタンに保存中と表示し、失敗後に元へ戻す", async (t) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { dom } = await loadApp({
    fetchImpl: async () => {
      await pending;
      return { json: async () => ({ ok: false, error: "failed" }) };
    },
  });
  t.after(() => dom.window.close());
  dom.window.document.getElementById("eventEdit").click();
  const saving = dom.window.saveEventEditor();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dom.window.document.getElementById("eventSave").textContent, "保存中…");
  release();
  await saving;
  assert.equal(dom.window.document.getElementById("eventSave").textContent, "保存");
});

test("保存状態は応答前と成功後を区別し、公開データの警告も示す", async (t) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { dom } = await loadApp({
    fetchImpl: async () => {
      await pending;
      return { json: async () => ({ ok: true, event: { ...EVENT, version: 4 }, warning: "公開データの更新に失敗しました。" }) };
    },
  });
  t.after(() => dom.window.close());
  dom.window.document.getElementById("eventEdit").click();
  const saving = dom.window.saveEventEditor();
  assert.match(dom.window.document.getElementById("eventSyncStatus").textContent, /保存中/);
  assert.doesNotMatch(dom.window.document.getElementById("eventSyncStatus").textContent, /シートに保存済み/);
  release();
  await saving;
  assert.match(dom.window.document.getElementById("eventSyncStatus").textContent, /シートに保存済み/);
  assert.match(dom.window.document.getElementById("eventSyncStatus").textContent, /公開データの更新に失敗/);
});

test("書き込み成功後に画面を更新中と表示してから完了に進む", async (t) => {
  const { dom } = await loadApp({
    fetchImpl: async () => ({ json: async () => ({ ok: true, event: { ...EVENT, version: 4 } }) }),
  });
  t.after(() => dom.window.close());
  let finishPaint;
  const originalTimeout = dom.window.setTimeout;
  dom.window.setTimeout = (callback, delay, ...args) => {
    if(delay === 0 && !finishPaint){ finishPaint = () => callback(...args); return 1; }
    return originalTimeout(callback, delay, ...args);
  };
  dom.window.document.getElementById("eventEdit").click();
  const saving = dom.window.saveEventEditor();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finishPaint, "function");
  assert.match(dom.window.document.getElementById("eventSyncStatus").textContent, /シートに保存済み.*画面を更新中/);
  finishPaint();
  await saving;
  assert.match(dom.window.document.getElementById("eventSyncStatus").textContent, /画面更新完了/);
});

test("保存中のタブ切替と再描画でも入力値とdisabled状態を保持する", async (t) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { dom } = await loadApp({
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.action === "eventUpdate") {
        await pending;
        return { json: async () => ({ ok: false, error: "failed" }) };
      }
      return { json: async () => ({ ok: true, events: [EVENT] }) };
    },
  });
  t.after(() => dom.window.close());
  dom.window.document.getElementById("eventEdit").click();
  setInput(dom, "eventTitle", "タブ切替中も残す入力");
  const save = dom.window.saveEventEditor();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dom.window.document.getElementById("eventSave").disabled, true);

  dom.window.setView("today");
  dom.window.setView("events");
  assert.equal(dom.window.document.getElementById("eventEditor").hidden, false);
  assert.equal(dom.window.document.getElementById("eventTitle").value, "タブ切替中も残す入力");
  assert.equal(dom.window.document.getElementById("eventSave").disabled, true);

  release();
  await save;
  assert.equal(dom.window.document.getElementById("eventTitle").value, "タブ切替中も残す入力");
});

test("保存中の状態変更入口は共通排他で追加リクエストを送らない", async (t) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const requests = [];
  const { dom } = await loadApp({
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (body.action === "eventUpdate") {
        await pending;
        return { json: async () => ({ ok: false, error: "failed" }) };
      }
      return { json: async () => ({ ok: true, events: [EVENT] }) };
    },
  });
  t.after(() => dom.window.close());
  dom.window.document.getElementById("eventEdit").click();
  setInput(dom, "eventTitle", "状態変更を抑止する入力");
  const save = dom.window.saveEventEditor();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await dom.window.setEventStatus(EVENT.id, "終了");
  assert.equal(requests.filter((request) => request.action === "eventUpdate").length, 1);
  assert.equal(requests.filter((request) => request.action === "eventStatus").length, 0);
  release();
  await save;
  assert.equal(dom.window.document.getElementById("eventTitle").value, "状態変更を抑止する入力");
});

test("保存中の再描画でも既存イベントの編集フォーム見出しを維持する", async (t) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { dom } = await loadApp({
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.action === "eventUpdate") {
        await pending;
        return { json: async () => ({ ok: false, error: "failed" }) };
      }
      return { json: async () => ({ ok: true, events: [EVENT] }) };
    },
  });
  t.after(() => dom.window.close());
  dom.window.document.getElementById("eventEdit").click();
  setInput(dom, "eventTitle", "見出しを維持する入力");
  const save = dom.window.saveEventEditor();
  await new Promise((resolve) => setTimeout(resolve, 0));
  dom.window.renderEvents();
  assert.equal(dom.window.document.getElementById("eventEditorTitle").textContent, "イベントを編集");
  assert.equal(dom.window.document.getElementById("eventSave").disabled, true);
  release();
  await save;
  assert.equal(dom.window.document.getElementById("eventEditorTitle").textContent, "イベントを編集");
});

test("終了操作は確認後にsoft deleteし、終了済み一覧へ残す", async (t) => {
  const { dom, requests } = await loadApp({
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      return { json: async () => ({ ok: true, event: { ...EVENT, status: body.status || "終了", version: EVENT.version + 1 } }) };
    },
  });
  t.after(() => dom.window.close());
  await dom.window.setEventStatus(EVENT.id, "終了");
  const body = JSON.parse(requests.at(-1)[1].body);
  assert.equal(body.action, "eventStatus");
  assert.equal(body.status, "終了");
  assert.match(dom.window.document.getElementById("endedEvents").textContent, /交流会/);
});

test("終了処理中は押したボタンに終了処理中と表示する", async (t) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { dom } = await loadApp({
    fetchImpl: async () => {
      await pending;
      return { json: async () => ({ ok: true, event: { ...EVENT, status: "終了", version: 4 } }) };
    },
  });
  t.after(() => dom.window.close());
  const statusButton = dom.window.document.querySelector(`[data-event-status="${EVENT.id}"]`);
  const ending = dom.window.setEventStatus(EVENT.id, "終了");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(statusButton.textContent, "終了処理中…");
  release();
  await ending;
});

test("削除ボタンは確認後にeventDeleteを送り、削除中表示の後で一覧から除く", async (t) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { dom, requests } = await loadApp({
    fetchImpl: async () => {
      await pending;
      return { json: async () => ({ ok: true, deletedId: EVENT.id }) };
    },
  });
  t.after(() => dom.window.close());
  const deleteButton = dom.window.document.querySelector(`[data-event-delete="${EVENT.id}"]`);
  assert.ok(deleteButton);
  const deleting = dom.window.deleteEvent(EVENT.id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(deleteButton.textContent, "削除中…");
  release();
  await deleting;
  const body = JSON.parse(requests.at(-1)[1].body);
  assert.equal(body.action, "eventDelete");
  assert.equal(body.id, EVENT.id);
  assert.equal(body.version, EVENT.version);
  assert.equal(Array.from(dom.window.document.querySelectorAll(".ev-title")).some((el) => el.textContent.includes("交流会")), false);
});

test("終了済みイベントは再表示できる", async (t) => {
  const ended = { ...EVENT, status: "終了" };
  const { dom } = await loadApp({ events: [ended], fetchImpl: async () => ({ json: async () => ({ ok: true, event: { ...EVENT, status: "公開", version: 4 } }) }) });
  t.after(() => dom.window.close());
  await dom.window.setEventStatus(EVENT.id, "公開");
  assert.equal(dom.window.document.getElementById("endedEvents").textContent.includes("交流会"), false);
  assert.equal(dom.window.document.querySelector(".ev-title").textContent.includes("交流会"), true);
});

test("競合エラーは再送せず、入力と競合メッセージを残す", async (t) => {
  let calls = 0;
  const { dom } = await loadApp({
    fetchImpl: async () => {
      calls += 1;
      return { json: async () => ({ ok: false, error: "conflict" }) };
    },
  });
  t.after(() => dom.window.close());
  dom.window.document.getElementById("eventEdit").click();
  setInput(dom, "eventTitle", "競合した変更");
  await dom.window.saveEventEditor();
  assert.equal(calls, 1);
  assert.equal(dom.window.document.getElementById("eventTitle").value, "競合した変更");
  assert.match(dom.window.document.getElementById("eventError").textContent, /別の画面で更新されています/);
});

test("カードからの終了操作が競合した場合も編集画面にメッセージを表示する", async (t) => {
  const { dom } = await loadApp({
    fetchImpl: async () => ({ json: async () => ({ ok: false, error: "conflict" }) }),
  });
  t.after(() => dom.window.close());
  await dom.window.setEventStatus(EVENT.id, "終了");
  assert.equal(dom.window.document.getElementById("eventEditor").hidden, false);
  assert.match(dom.window.document.getElementById("eventError").textContent, /別の画面で更新されています/);
});

test("復号後の最新取得が成功したらイベント一覧を置き換える", async (t) => {
  const latest = { ...EVENT, title: "最新の交流会", version: 4 };
  const { dom, requests } = await loadApp({ fetchImpl: async () => ({ json: async () => ({ ok: true, events: [latest] }) }) });
  t.after(() => dom.window.close());
  await dom.window.refreshEventsFromApi();
  assert.equal(JSON.parse(requests.at(-1)[1].body).what, "structuredEvents");
  assert.equal(dom.window.document.querySelector(".ev-title").textContent.includes("最新の交流会"), true);
});

test("イベント一覧から再取得でき、取得時刻と通信状態を表示する", async (t) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { dom, requests } = await loadApp({
    fetchImpl: async () => {
      await pending;
      return { json: async () => ({ ok: true, events: [EVENT] }) };
    },
  });
  t.after(() => dom.window.close());
  const button = dom.window.document.getElementById("eventRefresh");
  assert.ok(button);
  button.click();
  assert.equal(button.disabled, true);
  assert.match(dom.window.document.getElementById("eventSyncStatus").textContent, /取得中/);
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(JSON.parse(requests.at(-1)[1].body).what, "structuredEvents");
  assert.equal(dom.window.document.getElementById("eventRefresh").disabled, false);
  assert.match(dom.window.document.getElementById("eventSyncStatus").textContent, /最終取得.*\d{1,2}:\d{2}/);
});

test("古い公開イベントの編集は進行中の最新取得を待ってから開く", async (t) => {
  let releaseRead;
  const pendingRead = new Promise((resolve) => { releaseRead = resolve; });
  const old = { ...EVENT, date: "2026-09-06", version: 1 };
  const latest = { ...EVENT, date: LATEST_DATE, version: 2 };
  const { dom, requests } = await loadApp({
    events: [old], fresh: false,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.action === "read") {
        await pendingRead;
        return { json: async () => ({ ok: true, events: [latest] }) };
      }
      return { json: async () => ({ ok: true, event: { ...latest, version: 3 } }) };
    },
  });
  t.after(() => dom.window.close());
  const refreshing = dom.window.refreshEventsFromApi();
  dom.window.document.querySelector('[data-event-edit="' + EVENT.id + '"]').click();
  assert.equal(dom.window.document.getElementById("eventEditor").hidden, true);
  releaseRead();
  await refreshing;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dom.window.document.getElementById("eventDate").value, LATEST_DATE);
  await dom.window.saveEventEditor();
  assert.equal(JSON.parse(requests.at(-1)[1].body).event.version, 2);
});

test("古い公開イベントの終了操作も最新の更新番号を使う", async (t) => {
  const old = { ...EVENT, version: 1 };
  const latest = { ...EVENT, version: 2 };
  const { dom, requests } = await loadApp({
    events: [old], fresh: false,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      return { json: async () => body.action === "read"
        ? { ok: true, events: [latest] }
        : { ok: true, event: { ...latest, status: "終了", version: 3 } } };
    },
  });
  t.after(() => dom.window.close());
  await dom.window.setEventStatus(EVENT.id, "終了");
  const mutation = requests.map((request) => JSON.parse(request[1].body)).find((body) => body.action === "eventStatus");
  assert.equal(mutation.version, 2);
});

test("保存成功後は編集状態を解除し、同じ画面で最新取得できる", async (t) => {
  const latest = { ...EVENT, title: "保存後の最新イベント", version: 4 };
  const { dom } = await loadApp({
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      return { json: async () => body.action === "eventUpdate"
        ? { ok: true, event: latest }
        : { ok: true, events: [latest] } };
    },
  });
  t.after(() => dom.window.close());
  dom.window.document.getElementById("eventEdit").click();
  setInput(dom, "eventTitle", "保存するタイトル");
  await dom.window.saveEventEditor();
  assert.equal(dom.window.document.getElementById("eventEditor").hidden, true);
  await dom.window.refreshEventsFromApi();
  assert.match(dom.window.document.querySelector(".ev-title").textContent, /保存後の最新イベント/);
  assert.doesNotMatch(dom.window.document.getElementById("eventSyncStatus").textContent, /編集中/);
});

test("取得開始後に状態変更が完了した場合、古い取得応答を画面へ戻さない", async (t) => {
  let releaseRead;
  const pendingRead = new Promise((resolve) => { releaseRead = resolve; });
  const latest = { ...EVENT, status: "終了", title: "終了済みの最新イベント", version: 4 };
  const { dom } = await loadApp({
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.what === "structuredEvents") {
        await pendingRead;
        return { json: async () => ({ ok: true, events: [EVENT] }) };
      }
      return { json: async () => ({ ok: true, event: latest }) };
    },
  });
  t.after(() => dom.window.close());
  const refresh = dom.window.refreshEventsFromApi();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await dom.window.setEventStatus(EVENT.id, "終了");
  releaseRead();
  await refresh;
  assert.match(dom.window.document.getElementById("endedEvents").textContent, /終了済みの最新イベント/);
  assert.doesNotMatch(dom.window.document.querySelector(".events-title").parentElement.textContent, /今後のイベント.*交流会/);
});

test("IDのない旧形式イベントを選ぶと、それぞれのイベントが招待文に入る", async (t) => {
  const future = new Date();future.setDate(future.getDate()+1);
  const firstDate=(future.getMonth()+1)+'/'+future.getDate();future.setDate(future.getDate()+1);
  const secondDate=(future.getMonth()+1)+'/'+future.getDate();
  const legacyEvents = [
    { d: firstDate, t: "19:00-20:00", title: "一つ目の旧形式イベント" },
    { d: secondDate, t: "19:00-20:00", title: "二つ目の旧形式イベント" },
  ];
  const { dom } = await loadApp({ events: legacyEvents, token: "" });
  t.after(() => dom.window.close());
  const text = dom.window.document.getElementById("evText").value;
  assert.match(text, /■一つ目の旧形式イベント/);
  assert.match(text, /■二つ目の旧形式イベント/);
  assert.equal((text.match(/■一つ目の旧形式イベント/g) || []).length, 1);
});

test("お誘い用の全イベントでテーマを明示し、テーマなしには付けない", async (t) => {
  const events = [
    { ...EVENT, title: "ライフデザイン講演会", theme: "100年時代を生き抜くために" },
    { ...EVENT, id: "evt_01JTHEME000000000000000", title: "楽SAKEイベント", theme: "秋の味覚のBBQ" },
    { ...EVENT, id: "evt_01JNOTHEME0000000000000", title: "経営者交流会", theme: "" },
  ];
  const { dom } = await loadApp({ events });
  t.after(() => dom.window.close());
  const text = dom.window.document.getElementById("evText").value;
  assert.match(text, /■ライフデザイン講演会（テーマ：100年時代を生き抜くために）/);
  assert.match(text, /■楽SAKEイベント（テーマ：秋の味覚のBBQ）/);
  assert.match(text, /■経営者交流会\n/);
});

test("お誘い文のプレビューは選択中だけを読みやすく示す", async (t) => {
  const events = [EVENT, { ...EVENT, id: "evt_01JSECOND0000000000000", title: "二つ目", theme: "" }];
  const { dom } = await loadApp({ events });
  t.after(() => dom.window.close());
  const preview = dom.window.document.getElementById("invitePreview");
  assert.ok(preview);
  assert.equal(preview.querySelectorAll(".invite-preview-item").length, 2);
  assert.match(preview.textContent, /交流会.*経営者.*新橋/);
  assert.match(preview.textContent, /example.com\/event/);
  const second = dom.window.document.querySelectorAll(".evchk")[1];
  second.checked = false;
  second.dispatchEvent(new dom.window.Event("change"));
  assert.equal(preview.querySelectorAll(".invite-preview-item").length, 1);
  assert.doesNotMatch(dom.window.document.getElementById("evText").value, /二つ目/);
});

test("不正な最新取得レスポンスではビルド時のイベントを残す", async (t) => {
  const { dom } = await loadApp({
    fetchImpl: async () => ({ json: async () => ({ ok: true, events: [null] }) }),
  });
  t.after(() => dom.window.close());
  await dom.window.refreshEventsFromApi();
  assert.match(dom.window.document.querySelector(".ev-title").textContent, /交流会/);
  assert.match(dom.window.document.getElementById("eventSyncStatus").textContent, /最新データを取得できませんでした/);
});

test("空白だけのタイトルを含む最新取得レスポンスは表示を置き換えない", async (t) => {
  const { dom } = await loadApp({
    fetchImpl: async () => ({ json: async () => ({ ok: true, events: [{ ...EVENT, title: "   " }] }) }),
  });
  t.after(() => dom.window.close());
  await dom.window.refreshEventsFromApi();
  assert.match(dom.window.document.querySelector(".ev-title").textContent, /交流会/);
  assert.match(dom.window.document.getElementById("eventSyncStatus").textContent, /最新データを取得できませんでした/);
});

test("不完全な集計シートURLを含む最新取得レスポンスは表示を置き換えない", async (t) => {
  const { dom } = await loadApp({
    fetchImpl: async () => ({ json: async () => ({ ok: true, events: [{ ...EVENT, sheetUrl: "https://docs.google.com/spreadsheets/" }] }) }),
  });
  t.after(() => dom.window.close());
  await dom.window.refreshEventsFromApi();
  assert.match(dom.window.document.querySelector(".ev-title").textContent, /交流会/);
  assert.match(dom.window.document.getElementById("eventSyncStatus").textContent, /最新データを取得できませんでした/);
});

test("不正な集計シートURLを含むレスポンスでは編集中の入力も保持する", async (t) => {
  const { dom } = await loadApp({
    fetchImpl: async () => ({ json: async () => ({ ok: true, events: [{ ...EVENT, sheetUrl: "https://docs.google.com/spreadsheets/d/test/edit\n" }] }) }),
  });
  t.after(() => dom.window.close());
  dom.window.document.getElementById("eventEdit").click();
  setInput(dom, "eventTitle", "編集中の入力を保持");
  await dom.window.refreshEventsFromApi();
  assert.equal(dom.window.document.getElementById("eventTitle").value, "編集中の入力を保持");
  assert.match(dom.window.document.getElementById("eventSyncStatus").textContent, /最新データを取得できませんでした/);
});

test("正当な空配列は最新データとして扱わず、表示と失敗メッセージを残す", async (t) => {
  const { dom } = await loadApp({
    fetchImpl: async () => ({ json: async () => ({ ok: true, events: [] }) }),
  });
  t.after(() => dom.window.close());
  await dom.window.refreshEventsFromApi();
  assert.match(dom.window.document.querySelector(".ev-title").textContent, /交流会/);
  assert.match(dom.window.document.getElementById("eventSyncStatus").textContent, /最新データを取得できませんでした/);
});

test("過去の公開イベントは終了済みと分けて編集・終了できる", async (t) => {
  const past = { ...EVENT, date: "2026-09-22", title: "過去の公開イベント" };
  const { dom } = await loadApp({ events: [past], token: "" });
  t.after(() => dom.window.close());
  assert.match(dom.window.document.getElementById("pastEvents").textContent, /過去の公開イベント/);
  assert.equal(dom.window.document.querySelectorAll("#pastEvents [data-event-edit]").length, 1);
  assert.match(dom.window.document.getElementById("endedEvents").textContent, /終了済み/);
});

test("イベント一覧は開催日の昇順で、保存成功時の警告を表示する", async (t) => {
  const later = { ...EVENT, date: daysFromToday(20), title: "後の日付", theme: "" };
  const earlier = { ...EVENT, id: "evt_01JEARLIER00000000000000", date: daysFromToday(5), title: "先の日付", theme: "" };
  const { dom } = await loadApp({
    events: [later, earlier],
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      return { json: async () => body.action === "eventUpdate"
        ? { ok: true, event: { ...earlier, title: "警告つき保存", version: 4 }, warningCode: "snapshot_refresh_failed", warning: "保存済みですが同期に失敗しました。" }
        : { ok: true, events: [later, earlier] } };
    },
  });
  t.after(() => dom.window.close());
  const titles = [...dom.window.document.querySelectorAll("#events .ev-title")].map((node) => node.textContent);
  assert.deepEqual(titles.slice(0, 2), ["先の日付", "後の日付"]);
  dom.window.document.querySelector("[data-event-edit]").click();
  await dom.window.saveEventEditor();
  assert.match(dom.window.document.getElementById("eventSyncStatus").textContent, /保存済みですが同期に失敗しました/);
});

test("最新取得レスポンスのテーマと場所の上限違反を表示へ反映しない", async (t) => {
  const { dom } = await loadApp({
    fetchImpl: async () => ({ json: async () => ({ ok: true, events: [{
      ...EVENT, theme: "x".repeat(121), place: "y".repeat(201), version: 4,
    }] }) }),
  });
  t.after(() => dom.window.close());
  await dom.window.refreshEventsFromApi();
  assert.match(dom.window.document.querySelector(".ev-title").textContent, /交流会/);
  assert.match(dom.window.document.getElementById("eventSyncStatus").textContent, /最新データを取得できませんでした/);
});

test("versionは明示された正の整数以外を受け入れず表示と入力を保持する", async (t) => {
  const invalidVersions = [
    ["null", null],
    ["空文字", ""],
    ["false", false],
    ["0", 0],
    ["負数", -1],
    ["非整数", 1.5],
    ["数値文字列", "4"],
    ["空白付き数値文字列", " 4 "],
    ["未指定", undefined],
  ];
  for (const [label, version] of invalidVersions) {
    await t.test(label, async (st) => {
      const { dom } = await loadApp({
        fetchImpl: async () => ({ json: async () => ({ ok: true, events: [{ ...EVENT, version }] }) }),
      });
      st.after(() => dom.window.close());
      dom.window.document.getElementById("eventEdit").click();
      setInput(dom, "eventTitle", "version不正でも保持する入力");
      await dom.window.refreshEventsFromApi();
      assert.equal(dom.window.document.querySelector(".ev-title").textContent.includes("交流会"), true);
      assert.equal(dom.window.document.getElementById("eventTitle").value, "version不正でも保持する入力");
      assert.match(dom.window.document.getElementById("eventSyncStatus").textContent, /最新データを取得できませんでした/);
    });
  }
});

test("最新取得が編集中に完了しても入力内容を置き換えない", async (t) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const latest = { ...EVENT, title: "サーバー側の最新タイトル", version: 4 };
  const { dom } = await loadApp({
    fetchImpl: async () => {
      await pending;
      return { json: async () => ({ ok: true, events: [latest] }) };
    },
  });
  t.after(() => dom.window.close());
  dom.window.document.getElementById("eventEdit").click();
  setInput(dom, "eventTitle", "編集中に残すタイトル");
  const refresh = dom.window.refreshEventsFromApi();
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  await refresh;
  assert.equal(dom.window.document.getElementById("eventEditor").hidden, false);
  assert.equal(dom.window.document.getElementById("eventTitle").value, "編集中に残すタイトル");
  assert.match(dom.window.document.getElementById("eventSyncStatus").textContent, /編集中/);
});

test("イベント選択チェックボックスにイベント名を含むアクセシブルな名前がある", async (t) => {
  const { dom } = await loadApp();
  t.after(() => dom.window.close());
  const checkbox = dom.window.document.querySelector(".evchk");
  assert.ok(checkbox);
  assert.match(checkbox.getAttribute("aria-label"), /交流会/);
  const parts = EVENT_DATE.split("-");
  assert.ok(checkbox.getAttribute("aria-label").includes(Number(parts[1]) + "/" + Number(parts[2])));
});


test("終了時刻は時刻選択と24:00に対応し、再描画でも保持する", async (t) => {
  const { dom } = await loadApp({ events: [{ ...EVENT, endTime: "24:00" }] });
  t.after(() => dom.window.close());
  await dom.window.openEventEditor(EVENT.id);
  const doc = dom.window.document;
  assert.equal(doc.getElementById("eventEndTime").type, "time");
  assert.equal(doc.getElementById("eventEndDay").value, "24:00");
  assert.equal(dom.window.readEventForm().endTime, "24:00");
  dom.window.renderEvents();
  assert.equal(dom.window.readEventForm().endTime, "24:00");
  setInput(dom, "eventEndDay", "");
  setInput(dom, "eventEndTime", "22:15");
  dom.window.renderEvents();
  assert.equal(dom.window.readEventForm().endTime, "22:15");
});
