const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { snapshotDigest } = require("../material_snapshot.js");

function gas() {
  const contactRows = [
    ["カテゴリー", "", "名前(あだ名)", ...Array(23).fill("")],
    ["A", "サシ", "テスト太郎", ...Array(23).fill("")]
  ];
  const eventRows = [
    [
      "evt_01JTEST00000000000000001", "公開", "2026-09-30", "19:00", "21:00",
      "交流会", "経営者", "新橋", "https://example.com/event",
      "https://docs.google.com/spreadsheets/d/test/edit", "2026-09-22T06:00:00+09:00", 1, ""
    ]
  ];
  const cache = new Map();
  const props = new Map([["API_TOKEN", "test-token"]]);
  const triggers = [];
  const calls = { waitLock: 0, releaseLock: 0, flush: 0 };
  const validationRules = new Map();
  function validationRule(column) {
    if (column === 2) return { getCriteriaType: () => "VALUE_IN_LIST", getCriteriaValues: () => [["公開", "終了"], false], getAllowInvalid: () => false };
    if (column === 3) return { getCriteriaType: () => "DATE_IS_VALID_DATE", getCriteriaValues: () => [], getAllowInvalid: () => false };
    const letter = column === 4 ? "D" : "E";
    return { getCriteriaType: () => "CUSTOM_FORMULA", getCriteriaValues: () => [`=OR(${letter}2="",AND(ISNUMBER(${letter}2),${letter}2>=0,${letter}2<1),REGEXMATCH(TO_TEXT(${letter}2),"^(?:[01]\\d|2[0-3]):[0-5]\\d$"))`], getAllowInvalid: () => false };
  }
  [2, 3, 4, 5].forEach(column => {
    for (let row = 2; row <= 100; row++) validationRules.set(`${row}:${column}`, validationRule(column));
  });
  let frozenRows = 1;
  let filter = { getRange: () => ({ getRow: () => 1, getColumn: () => 1, getNumRows: () => 100, getNumColumns: () => 13 }) };
  const timed = {
    getId: () => 'fixture-timed', getTitle: () => 'テスト会議', getLocation: () => 'テスト会場', getDescription: () => '確認する詳細',
    isAllDayEvent: () => false,
    getStartTime: () => new Date("2026-09-22T18:00:00+09:00"),
    getEndTime: () => new Date("2026-09-22T19:00:00+09:00")
  };
  const allDay = {
    getId: () => 'fixture-all-day', getTitle: () => 'テスト終日', getLocation: () => '', getDescription: () => '',
    isAllDayEvent: () => true,
    getStartTime: () => new Date("2026-09-23T00:00:00+09:00"),
    getEndTime: () => new Date("2026-09-24T00:00:00+09:00")
  };
  function bytes(value) {
    return Array.from(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8"));
  }
  function blob(value) {
    const b = Array.isArray(value) ? Buffer.from(value) : Buffer.from(String(value), "utf8");
    return { getBytes: () => Array.from(b), getDataAsString: () => b.toString("utf8") };
  }
  const sheets = {
    リスト: {
      getSheetId: () => 0,
      getLastRow: () => contactRows.length,
      getRange: (r, c, n, m) => ({
        getValues: () => contactRows.slice(r - 1, r - 1 + n).map(row => row.slice(c - 1, c - 1 + m))
      })
    },
    events: {
      getSheetId: () => 2140110738,
      getLastRow: () => eventRows.length,
      getRange: (r, c, n, m) => ({
        getValues: () => eventRows.slice(r - 1, r - 1 + n).map(row => row.slice(c - 1, c - 1 + m))
      })
    },
    イベント管理: {
      protections: [],
      hidden: false,
      getSheetId: () => 3000000001,
      getLastRow: () => eventRows.length + 1,
      getMaxRows: () => 100,
      getMaxColumns: () => 13,
      getRange: (r, c, n, m) => ({
        getValues: () => {
          const rows = [["イベントID", "状態", "開催日", "開始時刻", "終了時刻", "タイトル", "テーマ", "場所", "案内URL", "集計シートURL", "更新日時", "更新番号", "内部requestId（手動編集禁止）"]].concat(eventRows);
          return rows.slice(r - 1, r - 1 + n).map(row => row.slice(c - 1, c - 1 + m));
        },
        getRow: () => r,
        getColumn: () => c,
        getNumRows: () => n,
        getNumColumns: () => m,
        getSheet: () => sheets.イベント管理,
        getDataValidation: () => validationRules.get(`${r}:${c}`) || null,
        getDataValidations: () => Array.from({ length: n }, (_, rowIndex) => [validationRules.get(`${r + rowIndex}:${c}`) || null]),
        setDataValidation: () => {
          for (let row = r; row < r + n; row++) {
            for (let column = c; column < c + m; column++) validationRules.set(`${row}:${column}`, validationRule(column));
          }
        },
        createFilter: () => { filter = { getRange: () => ({ getRow: () => r, getColumn: () => c, getNumRows: () => n, getNumColumns: () => m }), remove: () => { filter = null; } }; return filter; },
        protect: () => {
          const state = { warningOnly: false };
          const protection = {
            getRange: () => ({
              getRow: () => r,
              getColumn: () => c,
              getNumRows: () => n,
              getNumColumns: () => m,
              getSheet: () => sheets.イベント管理,
            }),
            isWarningOnly: () => state.warningOnly,
            canDomainEdit: () => false,
            getEditors: () => [{ getEmail: () => "owner@example.com" }],
            addEditor: () => protection,
            removeEditors: () => protection,
            setDomainEdit: () => protection,
            setDescription: () => protection,
            setWarningOnly: value => {
              state.warningOnly = !!value;
              return protection;
            },
          };
          sheets.イベント管理.protections.push(protection);
          return protection;
        }
      }),
      hideColumns: () => { sheets.イベント管理.hidden = true; },
      isColumnHiddenByUser: () => sheets.イベント管理.hidden,
      getProtections: () => sheets.イベント管理.protections,
      setFrozenRows: value => { frozenRows = value; },
      getFrozenRows: () => frozenRows,
      getFilter: () => filter,
    }
  };
  sheets.イベント管理.hidden = true;
  sheets.イベント管理.protections.push({
    getRange: () => ({
      getRow: () => 1,
      getColumn: () => 13,
      getNumRows: () => 100,
      getNumColumns: () => 1,
      getSheet: () => sheets.イベント管理,
    }),
    isWarningOnly: () => false,
    canDomainEdit: () => false,
    getEditors: () => [{ getEmail: () => "owner@example.com" }],
  });
  sheets.イベント管理.protections.push({
    getRange: () => ({
      getRow: () => 1,
      getColumn: () => 11,
      getNumRows: () => 100,
      getNumColumns: () => 2,
      getSheet: () => sheets.イベント管理,
    }),
    isWarningOnly: () => false,
    canDomainEdit: () => false,
    getEditors: () => [{ getEmail: () => "owner@example.com" }],
  });
  const book = {
    getSheetByName: name => sheets[name],
    getSheets: () => [sheets.リスト, sheets.events, sheets.イベント管理]
  };
  const ctx = vm.createContext({
    Date,
    JSON,
    Math,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => props.get(key) || null,
        setProperties: values => Object.entries(values).forEach(([k, v]) => props.set(k, String(v)))
      })
    },
    SpreadsheetApp: { ProtectionType: { RANGE: "RANGE" }, openById: () => book, flush: () => { calls.flush += 1; } },
    CalendarApp: {
      getDefaultCalendar: () => ({ getEvents: () => [timed, allDay] })
    },
    CacheService: {
      getScriptCache: () => ({
        get: key => cache.get(key) || null,
        put: (key, value) => cache.set(key, value)
      })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (_alg, value) => bytes(crypto.createHash("sha256").update(value).digest()),
      newBlob: value => blob(value),
      gzip: value => blob(value.getBytes()),
      ungzip: value => blob(value.getBytes()),
      base64Encode: value => Buffer.from(value).toString("base64"),
      base64Decode: value => Array.from(Buffer.from(value, "base64")),
      formatDate: (date, _tz, pattern) => {
        if (pattern === "XXX") return "+09:00";
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
        }).formatToParts(date).reduce((o, p) => (o[p.type] = p.value, o), {});
        if (pattern === "yyyy-MM-dd'T'HH:mm:ss") {
          return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
        }
        return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
      }
    },
    Session: { getScriptTimeZone: () => "America/Los_Angeles", getEffectiveUser: () => ({ getEmail: () => "owner@example.com" }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: trigger => triggers.splice(triggers.indexOf(trigger), 1),
      newTrigger: handler => ({
        timeBased: () => ({
          everyHours: hours => ({
            create: () => triggers.push({ getHandlerFunction: () => handler, hours })
          })
        })
      })
    },
    LockService: { getScriptLock: () => ({ waitLock() { calls.waitLock += 1; }, releaseLock() { calls.releaseLock += 1; } }) },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: text => ({ setMimeType: () => JSON.parse(text) })
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../sheet-api.gs"), "utf8"), ctx);
  return { ctx, cache, props, triggers, calls };
}

test("GAS snapshot contains contacts, structured events and timed calendar events", () => {
  const { ctx, props } = gas();
  const snapshot = ctx.refreshMaterialSnapshotAt_(new Date("2026-09-22T06:00:00+09:00"));
  assert.equal(snapshot.contacts.length, 1);
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].id, "evt_01JTEST00000000000000001");
  assert.equal("eventRows" in snapshot, false);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.calendar)), [
    ["2026-09-22T18:00", "2026-09-22T19:00", {source:'primary',eventId:'fixture-timed',allDay:false,detailsAvailable:true,title:'テスト会議',location:'テスト会場',description:'確認する詳細'}],
    ["2026-09-23T00:00", "2026-09-24T00:00", {source:'primary',eventId:'fixture-all-day',allDay:true,detailsAvailable:true,title:'テスト終日',location:'',description:''}]
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.counts)), {
    contacts: 1, events: 1, calendar: 2
  });
  assert.equal(snapshot.digest, snapshotDigest(snapshot));
  assert.equal(props.get("MATERIAL_SNAPSHOT_COUNT_CONTACTS"), "1");
});

test("old eventRows cache is ignored after the snapshot contract version changes", () => {
  const { ctx, cache } = gas();
  const legacySnapshot = {
    version: 1,
    generatedAt: "2026-09-22T05:00:00+09:00",
    contacts: [["legacy"]],
    eventRows: [["", "■旧イベント", ""]],
    calendar: [],
    counts: { contacts: 1, eventRows: 1, calendar: 0 }
  };
  cache.set("garden-material-snapshot-v1", ctx.encodeSnapshot_(legacySnapshot));

  const fresh = ctx.readMaterialSnapshot_();
  assert.equal(fresh.version, 2);
  assert.equal("eventRows" in fresh, false);
  assert.equal(fresh.events.length, 1);
  assert.equal(fresh.events[0].title, "交流会");
});

test("cached snapshot is returned through the authenticated API", () => {
  const { ctx } = gas();
  const made = ctx.refreshMaterialSnapshotAt_(new Date("2026-09-22T06:00:00+09:00"));
  const read = ctx.readMaterialSnapshot_();
  assert.equal(read.digest, made.digest);
  const response = ctx.doPost({ postData: { contents: JSON.stringify({
    token: "test-token", action: "read", what: "snapshot"
  }) } });
  assert.equal(response.ok, true);
  assert.equal(response.snapshot.digest, made.digest);
});

test("trigger installation is idempotent and creates an hourly refresh", () => {
  const { ctx, triggers } = gas();
  ctx.installMaterialSnapshotTrigger();
  ctx.installMaterialSnapshotTrigger();
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].getHandlerFunction(), "refreshMaterialSnapshot");
  assert.equal(triggers[0].hours, 1);
});

test("素材スナップショットは共通ロック内で生成し、東京時刻へ固定してflush後に解放する", () => {
  const { ctx, calls } = gas();
  const snapshot = ctx.refreshMaterialSnapshotAt_(new Date("2026-09-22T15:00:00Z"));

  assert.equal(snapshot.generatedAt, "2026-09-23T00:00:00+09:00");
  assert.equal(calls.waitLock, 1);
  assert.equal(calls.flush, 1);
  assert.equal(calls.releaseLock, 1);
});
