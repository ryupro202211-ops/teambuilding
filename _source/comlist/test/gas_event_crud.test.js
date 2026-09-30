const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const EVENT_ID = "evt_01JTEST00000000000000000";
const REQUEST_ID = "req_01JTEST00000000000000000";
const EXISTING_EVENT = {
  id: EVENT_ID,
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
  version: 3,
};
const VALID_NEW_EVENT = {
  date: "2026-10-10",
  startTime: "18:00",
  endTime: "20:00",
  title: "新しい交流会",
  theme: "仕事",
  place: "渋谷",
  url: "https://example.com/new-event",
  sheetUrl: "https://docs.google.com/spreadsheets/d/test/edit",
};

function gas(options = {}) {
  const eventRows = [["イベントID", "状態", "開催日", "開始時刻", "終了時刻", "タイトル", "テーマ", "場所", "案内URL", "集計シートURL", "更新日時", "更新番号", options.blankRequestHeader ? "" : "内部requestId（手動編集禁止）"]];
  if (!options.migrationEmpty) {
    eventRows.push([
      EXISTING_EVENT.id,
      EXISTING_EVENT.status,
      EXISTING_EVENT.date,
      EXISTING_EVENT.startTime,
      EXISTING_EVENT.endTime,
      EXISTING_EVENT.title,
      EXISTING_EVENT.theme,
      EXISTING_EVENT.place,
      EXISTING_EVENT.url,
      EXISTING_EVENT.sheetUrl,
      EXISTING_EVENT.updatedAt,
      EXISTING_EVENT.version,
      "",
    ]);
  }
  const backupRows = options.backupRows || [["", "10/3 19:00-21:00 @新橋", ""]];
  const contactRows = [
    ["カテゴリー", "", "名前(あだ名)", ...Array(23).fill("")],
    ["A", "サシ", "テスト太郎", ...Array(23).fill("")],
  ];
  const props = new Map([["API_TOKEN", "test-token"]]);
  const cache = new Map();
  const validationRules = new Map();
  const calls = { append: 0, write: 0, delete: 0, waitLock: 0, releaseLock: 0, flush: 0, hide: 0, protect: 0, warningOnly: 0, addEditor: 0, removeEditors: 0, domainEdit: 0, snapshotRefresh: 0, freeze: 0, filter: 0, filterRemove: 0, validation: 0, propertyTooLarge: 0, issuedSave: 0 };

  function makeValidationRule(criteriaType, criteriaValues, allowInvalid = false) {
    return {
      getCriteriaType: () => criteriaType,
      getCriteriaValues: () => criteriaValues,
      getAllowInvalid: () => allowInvalid,
    };
  }

  function expectedValidationRule(column) {
    if (column === 2) return makeValidationRule("VALUE_IN_LIST", [["公開", "終了"], false]);
    if (column === 3) return makeValidationRule("DATE_IS_VALID_DATE", []);
    const letter = column === 4 ? "D" : "E";
    return makeValidationRule("CUSTOM_FORMULA", [`=OR(${letter}2="",AND(ISNUMBER(${letter}2),${letter}2>=0,${letter}2<1),REGEXMATCH(TO_TEXT(${letter}2),"^(?:[01]\\d|2[0-3]):[0-5]\\d$"))`]);
  }

  function protectionFor(row, column, numRows, numColumns, warningOnly, sheetId = 987654321, behavior = {}) {
    const state = {
      warningOnly: !!warningOnly,
      domainEdit: !!behavior.domainEdit,
      editors: [...(behavior.editors || ["owner@example.com"])],
    };
    const protection = {
      getRange: () => ({
        getRow: () => row,
        getColumn: () => column,
        getNumRows: () => numRows,
        getNumColumns: () => numColumns,
        getSheet: () => ({ getSheetId: () => sheetId }),
      }),
      isWarningOnly: () => state.warningOnly,
      canDomainEdit: () => state.domainEdit,
      getEditors: () => state.editors.map(email => ({ getEmail: () => email })),
      addEditor: (user) => {
        calls.addEditor += 1;
        const email = typeof user === "string" ? user : user.getEmail();
        if (!state.editors.includes(email)) state.editors.push(email);
        return protection;
      },
      removeEditors: (users) => {
        calls.removeEditors += 1;
        const emails = users.map(user => typeof user === "string" ? user : user.getEmail());
        state.editors = state.editors.filter(email => !emails.includes(email) || email === "owner@example.com");
        return protection;
      },
      setDomainEdit: (value) => {
        calls.domainEdit += 1;
        if (!behavior.setDomainEditNoop) state.domainEdit = !!value;
        return protection;
      },
      setDescription: () => protection,
      setWarningOnly: (value) => {
        calls.warningOnly += 1;
        if (!behavior.setWarningOnlyNoop) state.warningOnly = !!value;
        return protection;
      },
    };
    if (behavior.noSetWarningOnly) delete protection.setWarningOnly;
    return protection;
  }

  function rangeFor(rows, row, column, numRows, numColumns) {
    return {
      getRow: () => row,
      getColumn: () => column,
      getNumRows: () => numRows,
      getNumColumns: () => numColumns,
      getValues: () => rows.slice(row - 1, row - 1 + numRows).map((values) => values.slice(column - 1, column - 1 + numColumns)),
      getValue: () => rows[row - 1][column - 1],
      setValues: (values) => {
        calls.write += 1;
        values.forEach((next, rowIndex) => {
          rows[row - 1 + rowIndex].splice(column - 1, next.length, ...next);
        });
      },
      setValue: (value) => {
        calls.write += 1;
        rows[row - 1][column - 1] = value;
      },
      getDataValidation: () => validationRules.get(`${row}:${column}`) || null,
      getDataValidations: () => Array.from({ length: numRows }, (_, rowIndex) => [
        validationRules.get(`${row + rowIndex}:${column}`) || null,
      ]),
      clearDataValidations: () => {
        for (let r = row; r < row + numRows; r++) {
          for (let c = column; c < column + numColumns; c++) validationRules.delete(`${r}:${c}`);
        }
      },
      setDataValidation: (rule) => {
        calls.validation += 1;
        for (let r = row; r < row + numRows; r++) {
          for (let c = column; c < column + numColumns; c++) {
            let storedRule = rule;
            if (options.relativeValidationFormulas && rule.getCriteriaType() === "CUSTOM_FORMULA") {
              const [formula] = rule.getCriteriaValues();
              storedRule = makeValidationRule("CUSTOM_FORMULA", [formula.replace(/([DE])2/g, `$1${r}`)], rule.getAllowInvalid());
            }
            validationRules.set(`${r}:${c}`, storedRule);
          }
        }
      },
      createFilter: () => {
        calls.filter += 1;
        const range = {
          getRow: () => row,
          getColumn: () => column,
          getNumRows: () => numRows,
          getNumColumns: () => numColumns,
        };
        const created = {
          getRange: () => range,
          remove: () => {
            calls.filterRemove += 1;
            if (sheets.イベント管理.filter === created) sheets.イベント管理.filter = null;
          },
        };
        sheets.イベント管理.filter = created;
        return created;
      },
      protect: () => {
        calls.protect += 1;
        const newProtection = options.newProtection || {};
        const protection = protectionFor(row, column, numRows, numColumns, !!newProtection.initialWarningOnly, 987654321, newProtection);
        sheets.イベント管理.protections.push(protection);
        return protection;
      },
    };
  }

  const sheets = {
    リスト: {
      getSheetId: () => 0,
      getLastRow: () => contactRows.length,
      getRange: (row, column, numRows, numColumns) => rangeFor(contactRows, row, column, numRows, numColumns),
    },
    イベント管理: {
      protections: [],
      hiddenColumns: new Set(),
      frozenRows: 0,
      filter: null,
      getSheetId: () => 987654321,
      getLastRow: () => eventRows.length,
      getMaxRows: () => 100,
      getMaxColumns: () => 13,
      getRange: (row, column, numRows, numColumns) => rangeFor(eventRows, row, column, numRows, numColumns),
      hideColumns: (column, count) => {
        calls.hide += 1;
        for (let i = column; i < column + count; i++) sheets.イベント管理.hiddenColumns.add(i);
      },
      setFrozenRows: (rows) => { calls.freeze += 1; sheets.イベント管理.frozenRows = rows; },
      getFrozenRows: () => sheets.イベント管理.frozenRows,
      getFilter: () => sheets.イベント管理.filter,
      isColumnHiddenByUser: (column) => sheets.イベント管理.hiddenColumns.has(column),
      getProtections: () => sheets.イベント管理.protections,
      appendRow: (values) => {
        calls.append += 1;
        if (options.failAppendAt && calls.append === options.failAppendAt) throw new Error("append failed");
        eventRows.push(values.slice());
      },
      deleteRow: (row) => {
        calls.delete += 1;
        eventRows.splice(row - 1, 1);
      },
    },
    "イベント_旧形式_backup_20260922_0600": {
      getName: () => "イベント_旧形式_backup_20260922_0600",
      getLastRow: () => backupRows.length,
      getRange: (row, column, numRows, numColumns) => rangeFor(backupRows, row, column, numRows, numColumns),
    },
  };
  if (options.existingWarningOnly) {
    sheets.イベント管理.protections.push(protectionFor(1, 13, 100, 1, true));
  }
  if (options.existingFilter) {
    sheets.イベント管理.filter = {
      getRange: () => ({ getRow: () => 2, getColumn: () => 2, getNumRows: () => 2, getNumColumns: () => 2 }),
      remove: () => { calls.filterRemove += 1; sheets.イベント管理.filter = null; },
    };
  }
  (options.existingProtections || []).forEach((item) => {
    sheets.イベント管理.protections.push(protectionFor(
      item.row,
      item.column,
      item.numRows,
      item.numColumns,
      item.warningOnly,
      item.sheetId,
      item.behavior || {},
    ));
  });
  const readyByDefault = options.ready !== false
    && !options.blankRequestHeader
    && !options.migrationEmpty
    && !options.existingWarningOnly
    && !options.existingFilter
    && !options.invalidValidation
    && !options.newProtection
    && !(options.existingProtections && options.existingProtections.length);
  if (readyByDefault) {
    sheets.イベント管理.hiddenColumns.add(13);
    sheets.イベント管理.frozenRows = 1;
    sheets.イベント管理.filter = {
      getRange: () => ({ getRow: () => 1, getColumn: () => 1, getNumRows: () => 100, getNumColumns: () => 13 }),
      remove: () => { calls.filterRemove += 1; sheets.イベント管理.filter = null; },
    };
    [2, 3, 4, 5].forEach((column) => rangeFor(eventRows, 2, column, 99, 1).setDataValidation(expectedValidationRule(column)));
    sheets.イベント管理.protections.push(protectionFor(1, 13, 100, 1, false));
    sheets.イベント管理.protections.push(protectionFor(1, 11, 100, 2, false));
  }
  if (options.invalidValidation) {
    [2, 3, 4, 5].forEach((column) => {
      for (let row = 2; row <= 100; row++) validationRules.set(`${row}:${column}`, makeValidationRule("UNSUPPORTED", ["wrong"], true));
    });
  }
  const book = {
    getSheetByName: (name) => sheets[name] || null,
    getSheets: () => Object.values(sheets),
    getOwner: () => ({ getEmail: () => "owner@example.com" }),
  };
  let uuidCounter = 0;
  const ctx = vm.createContext({
    Date,
    JSON,
    Math,
    String,
    Number,
    Array,
    Object,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => props.get(key) || null,
      setProperty: (key, value) => {
        const text = String(value);
        if (key.startsWith("EVENT_MIGRATION_ISSUED_")) {
          calls.issuedSave += 1;
          if (options.failIssuedSaveAt && calls.issuedSave === options.failIssuedSaveAt) {
            throw new Error("migration issued save failed");
          }
        }
        if (options.failMigrationResultSave && key.startsWith("EVENT_MIGRATION_") && key !== "EVENT_MIGRATION_STATE" && !key.startsWith("EVENT_MIGRATION_ISSUED_") && !key.startsWith("EVENT_MIGRATION_PENDING_")) {
          throw new Error("migration result save failed");
        }
        if (options.propertyLimitBytes && Buffer.byteLength(text, "utf8") > options.propertyLimitBytes) {
          calls.propertyTooLarge += 1;
          throw new Error("property value too large");
        }
        props.set(key, text);
      },
        deleteProperty: (key) => props.delete(key),
        getProperties: () => Object.fromEntries(props.entries()),
        setProperties: (values) => Object.entries(values).forEach(([key, value]) => props.set(key, String(value))),
      }),
    },
    SpreadsheetApp: {
      openById: () => book,
      ProtectionType: { RANGE: "RANGE" },
      newDataValidation: () => {
        const builder = {
          criteriaType: "",
          criteriaValues: [],
          allowInvalid: true,
          requireValueInList: (values, showDropdown) => { builder.criteriaType = "VALUE_IN_LIST"; builder.criteriaValues = [values, showDropdown]; return builder; },
          requireDate: () => { builder.criteriaType = "DATE_IS_VALID_DATE"; builder.criteriaValues = []; return builder; },
          requireFormulaSatisfied: (formula) => { builder.criteriaType = "CUSTOM_FORMULA"; builder.criteriaValues = [formula]; return builder; },
          setAllowInvalid: (value) => { builder.allowInvalid = value; return builder; },
          build: () => makeValidationRule(builder.criteriaType, builder.criteriaValues, builder.allowInvalid),
        };
        return builder;
      },
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (_algorithm, value) => Array.from(crypto.createHash("sha256").update(String(value), "utf8").digest()),
      newBlob: (value) => ({ getBytes: () => Array.from(Buffer.from(String(value), "utf8")) }),
      flush: () => { calls.flush += 1; },
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => cache.get(key) || null,
        put: (key, value) => {
          if (options.failIdempotencySave && key.startsWith("event-request-")) throw new Error("cache unavailable");
          cache.set(key, String(value));
        },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { calls.waitLock += 1; },
        releaseLock: () => { calls.releaseLock += 1; },
      }),
    },
    Utilities: {
      getUuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`,
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (_algorithm, value) => Array.from(crypto.createHash("sha256").update(String(value), "utf8").digest()),
      newBlob: (value) => ({ getBytes: () => Array.from(Buffer.from(String(value), "utf8")) }),
      formatDate: (date, _timezone, pattern) => {
        if (pattern === "XXX") return "+09:00";
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Tokyo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }).formatToParts(date).reduce((result, part) => {
          result[part.type] = part.value;
          return result;
        }, {});
        if (pattern === "yyyy-MM-dd") return `${parts.year}-${parts.month}-${parts.day}`;
        if (pattern === "HH:mm") return `${parts.hour}:${parts.minute}`;
        return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
      },
    },
    Session: { getScriptTimeZone: () => "America/Los_Angeles", getEffectiveUser: () => ({ getEmail: () => "owner@example.com" }) },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (value) => ({ setMimeType: () => JSON.parse(value) }),
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../sheet-api.gs"), "utf8"), ctx);
  ctx.refreshMaterialSnapshotAtLocked_ = () => {
    calls.snapshotRefresh += 1;
    if (options.requireFlushBeforeSnapshot && calls.flush === 0) throw new Error("sheet writes are not flushed");
    if (options.failSnapshotRefresh) throw new Error("snapshot unavailable");
    const snapshot = {
      version: 2,
      generatedAt: "2026-09-23T00:00:00+09:00",
      contacts: ctx.readContacts_(),
      events: ctx.readStructuredEvents_(true),
      calendar: [],
    };
    snapshot.counts = {
      contacts: snapshot.contacts.length,
      events: snapshot.events.length,
      calendar: 0,
    };
    snapshot.digest = ctx.snapshotDigest_(snapshot);
    return snapshot;
  };
  return {
    ctx,
    eventRows,
    props,
    cache,
    calls,
    sheet: sheets.イベント管理,
    validationRules,
    setFailAppendAt: (value) => { options.failAppendAt = value; },
    setFailIssuedSaveAt: (value) => { options.failIssuedSaveAt = value; },
    setFailMigrationResultSave: (value) => { options.failMigrationResultSave = value; },
  };
}

function runPost(ctx, body) {
  return ctx.doPost({ postData: { contents: JSON.stringify(body) } });
}

function migrationSourceRows(count) {
  return Array.from({ length: count }, (_, index) => ["", `10/${index + 3} 19:00-21:00 @会場${index + 1}`, ""]);
}

function makeMigrationReport(count, options = {}) {
  const sourceRows = options.sourceRows || migrationSourceRows(count);
  const records = options.records || Array.from({ length: count }, (_, index) => ({
    ...VALID_NEW_EVENT,
    id: "",
    date: `2026-10-${String(index + 3).padStart(2, "0")}`,
    title: `移行イベント${index + 1}${options.titleSuffix || ""}`,
    place: `会場${index + 1}`,
    version: 1,
    migrationKey: `migsrc_${String(index).padStart(32, "0")}`,
  }));
  return {
    reportId: options.reportId || `mig_01JROUND${String(count).padStart(2, "0")}00000000000000`,
    sourceVersion: 1,
    ready: true,
    backupSheetName: "イベント_旧形式_backup_20260922_0600",
    backupVerified: true,
    sourceCount: sourceRows.length,
    sourceRows,
    recordCount: records.length,
    warnings: [],
    skipped: [],
    records,
  };
}

test("event API rejects unauthenticated requests", () => {
  const { ctx, calls } = gas();
  const result = runPost(ctx, { action: "read", what: "structuredEvents", token: "wrong-token" });
  assert.deepEqual(result, { ok: false, error: "unauthorized" });
  assert.equal(calls.waitLock, 0);
});

test("イベント管理シートのM列スキーマを冪等に設定し、警告のみ保護を是正し、既存データを上書きしない", () => {
  const { ctx, eventRows, calls } = gas({ blankRequestHeader: true });
  const before = eventRows[1].slice();
  const first = ctx.setupStructuredEventSheet();
  const second = ctx.setupStructuredEventSheet();

  assert.equal(first.columnCount, 13);
  assert.equal(first.requestIdHeader, "内部requestId（手動編集禁止）");
  assert.equal(first.requestIdColumnHidden, true);
  assert.equal(first.requestIdProtected, true);
  assert.equal(first.frozenRows, 1);
  assert.equal(first.filterConfigured, true);
  assert.equal(first.inputRulesConfigured, true);
  assert.equal(first.systemColumnsProtected, true);
  assert.deepEqual(second, first);
  assert.deepEqual(eventRows[1], before);
  assert.equal(eventRows[0][12], "内部requestId（手動編集禁止）");
  assert.equal(calls.hide, 1);
  assert.equal(calls.protect, 2);
  assert.equal(calls.freeze, 1);
  assert.equal(calls.filter, 1);
  assert.equal(calls.validation, 4);
  assert.equal(ctx.inspectStructuredEventSheet().requestIdProtected, true);

  const warningOnlyCase = gas({ existingWarningOnly: true });
  assert.equal(warningOnlyCase.ctx.inspectStructuredEventSheet().requestIdProtected, false);
  const fixed = warningOnlyCase.ctx.setupStructuredEventSheet();
  assert.equal(fixed.requestIdProtected, true);
  assert.equal(warningOnlyCase.ctx.inspectStructuredEventSheet().requestIdProtected, true);
  assert.equal(warningOnlyCase.calls.protect, 1);
  assert.equal(warningOnlyCase.calls.warningOnly, 1);

  const mixedProtections = gas({
    existingProtections: [
      { row: 1, column: 13, numRows: 1, numColumns: 1, warningOnly: false },
      { row: 1, column: 12, numRows: 100, numColumns: 1, warningOnly: false },
      { row: 1, column: 13, numRows: 1, numColumns: 1, warningOnly: true },
      { row: 1, column: 13, numRows: 100, numColumns: 1, warningOnly: false, sheetId: 12345 },
    ],
  });
  assert.equal(mixedProtections.ctx.inspectStructuredEventSheet().requestIdProtected, false);
  const mixedFixed = mixedProtections.ctx.setupStructuredEventSheet();
  assert.equal(mixedFixed.requestIdProtected, true);
  assert.equal(mixedProtections.calls.protect, 2);

  for (const newProtection of [{ noSetWarningOnly: true }, { setWarningOnlyNoop: true, initialWarningOnly: true }]) {
    const unverifiable = gas({ newProtection });
    assert.throws(
      () => unverifiable.ctx.setupStructuredEventSheet(),
      /M列の保護状態を検査できないため停止しました|M列を手動編集禁止にできないため停止しました/,
    );
  }
});

test("setupはRange.createFilterを使い、既存フィルタと入力規則の内容・全対象範囲を是正する", () => {
  const first = gas({ ready: false });
  const inspected = first.ctx.setupStructuredEventSheet();

  assert.deepEqual(JSON.parse(JSON.stringify(inspected.filterRange)), { row: 1, column: 1, numRows: 100, numColumns: 13 });
  assert.deepEqual(JSON.parse(JSON.stringify(inspected.inputRuleRanges)), [
    { column: 2, row: 2, numRows: 99, criteriaType: "VALUE_IN_LIST", criteriaValues: [["公開", "終了"], false], allowInvalid: false },
    { column: 3, row: 2, numRows: 99, criteriaType: "DATE_IS_VALID_DATE", criteriaValues: [], allowInvalid: false },
    { column: 4, row: 2, numRows: 99, criteriaType: "CUSTOM_FORMULA", criteriaValues: ['=OR(D2="",AND(ISNUMBER(D2),D2>=0,D2<1),REGEXMATCH(TO_TEXT(D2),"^(?:[01]\\d|2[0-3]):[0-5]\\d$"))'], allowInvalid: false },
    { column: 5, row: 2, numRows: 99, criteriaType: "CUSTOM_FORMULA", criteriaValues: ['=OR(E2="",AND(ISNUMBER(E2),E2>=0,E2<1),REGEXMATCH(TO_TEXT(E2),"^(?:[01]\\d|2[0-3]):[0-5]\\d$"))'], allowInvalid: false },
  ]);
  assert.equal(first.sheet.filter.getRange().getNumRows(), 100);
  assert.equal(first.calls.filter, 1);

  const repaired = gas({ existingFilter: true, invalidValidation: true });
  const repairedInfo = repaired.ctx.setupStructuredEventSheet();
  assert.deepEqual(JSON.parse(JSON.stringify(repairedInfo.filterRange)), JSON.parse(JSON.stringify(inspected.filterRange)));
  assert.deepEqual(JSON.parse(JSON.stringify(repairedInfo.inputRuleRanges)), JSON.parse(JSON.stringify(inspected.inputRuleRanges)));
  assert.equal(repaired.calls.filterRemove, 1);
  assert.equal(repaired.calls.filter, 1);
});

test("setupはApps Scriptが行ごとに相対参照を展開した時刻入力規則を同一規則として検査する", () => {
  const relativeRules = gas({ ready: false, relativeValidationFormulas: true });
  const inspected = relativeRules.ctx.setupStructuredEventSheet();

  assert.equal(inspected.inputRulesConfigured, true);
  assert.equal(inspected.inputRuleRanges[2].criteriaValues[0].includes("D2"), true);
  assert.equal(inspected.inputRuleRanges[3].criteriaValues[0].includes("E2"), true);
});

test("時刻入力規則はSheetsの時刻数値とHH:mm文字列の両方を許可する", () => {
  const fixture = gas({ ready: false });
  const inspected = fixture.ctx.setupStructuredEventSheet();

  for (const detail of inspected.inputRuleRanges.slice(2)) {
    const formula = detail.criteriaValues[0];
    assert.match(formula, /ISNUMBER/);
    assert.match(formula, /TO_TEXT/);
    assert.match(formula, /REGEXMATCH/);
  }
});

test("M列保護は編集者とドメイン権限を明示的に絞り、実効保護を検査する", () => {
  const unsafe = gas({ existingProtections: [{
    row: 1,
    column: 13,
    numRows: 100,
    numColumns: 1,
    warningOnly: false,
    behavior: { domainEdit: true, editors: ["owner@example.com", "editor@example.com"] },
  }] });
  assert.equal(unsafe.ctx.inspectStructuredEventSheet().requestIdProtected, false);

  const fixed = unsafe.ctx.setupStructuredEventSheet();
  assert.equal(fixed.requestIdProtected, true);
  assert.equal(unsafe.calls.domainEdit, 1);
  assert.equal(unsafe.calls.removeEditors, 1);
  const protection = unsafe.ctx.requestIdColumnProtection_(unsafe.ctx.getEventsManagedSheet_());
  assert.deepEqual(protection.getEditors().map(user => user.getEmail()), ["owner@example.com"]);
});

test("通常readは未初期化シートを黙って変更せず、移行セットアップを要求する", () => {
  const { ctx, calls } = gas({ ready: false });
  const result = runPost(ctx, { action: "read", what: "structuredEvents", token: "test-token" });
  assert.equal(result.ok, false);
  assert.match(result.error, /初期化|保護|設定/);
  assert.equal(calls.hide, 0);
  assert.equal(calls.protect, 0);
});

test("structuredEvents returns canonical records including ended events", () => {
  const { ctx } = gas();
  const result = runPost(ctx, { action: "read", what: "structuredEvents", token: "test-token" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.events, [EXISTING_EVENT]);
});

test("structuredEvents rejects a row that violates the canonical contract", () => {
  const { ctx, eventRows } = gas();
  eventRows[1][2] = "2026-02-30";
  const result = runPost(ctx, { action: "read", what: "structuredEvents", token: "test-token" });
  assert.equal(result.ok, false);
  assert.match(result.error, /開催日/);
});

test("structuredEvents rejects a non-empty row without an event ID", () => {
  const { ctx, eventRows } = gas();
  eventRows[1][0] = "";
  eventRows[1][5] = "IDなしのイベント";
  const result = runPost(ctx, { action: "read", what: "structuredEvents", token: "test-token" });
  assert.equal(result.ok, false);
  assert.match(result.error, /イベントID/);
});

test("GASのイベント契約は正のversion、厳密な時刻、URLと長さの上限を守る", () => {
  const cases = [
    { ...VALID_NEW_EVENT, version: 0 },
    { ...VALID_NEW_EVENT, startTime: "19:00", endTime: "19:00" },
    { ...VALID_NEW_EVENT, theme: "x".repeat(121) },
    { ...VALID_NEW_EVENT, place: "x".repeat(201) },
    { ...VALID_NEW_EVENT, sheetUrl: "https://docs.google.com/spreadsheets/" },
  ];
  for (const event of cases) {
    const { ctx } = gas();
    const result = runPost(ctx, {
      action: "eventCreate", token: "test-token", requestId: REQUEST_ID, event,
    });
    assert.equal(result.ok, false, JSON.stringify(event));
    assert.equal(result.error, "invalid input");
  }
});

test("eventCreate issues an ID, version one, and appends one safe row", () => {
  const { ctx, eventRows, calls } = gas();
  const result = runPost(ctx, {
    action: "eventCreate",
    token: "test-token",
    requestId: REQUEST_ID,
    event: { ...VALID_NEW_EVENT, title: "=HYPERLINK(\"https://evil.example\")" },
  });
  assert.equal(result.ok, true);
  assert.match(result.event.id, /^evt_[A-Za-z0-9_-]{16,76}$/);
  assert.equal(result.event.version, 1);
  assert.equal(result.event.title, "=HYPERLINK(\"https://evil.example\")");
  assert.equal(calls.append, 1);
  assert.equal(eventRows.length, 3);
  assert.equal(eventRows[2][5], "'=HYPERLINK(\"https://evil.example\")");
});

test("イベントの作成・更新・状態変更が成功した後に素材スナップショットを更新する", () => {
  const { ctx, calls } = gas();
  const created = runPost(ctx, { action: "eventCreate", token: "test-token", requestId: REQUEST_ID, event: VALID_NEW_EVENT });
  assert.equal(created.ok, true);
  const updated = runPost(ctx, {
    action: "eventUpdate",
    token: "test-token",
    event: { ...EXISTING_EVENT, title: "更新後", version: 3 },
  });
  assert.equal(updated.ok, true);
  const status = runPost(ctx, {
    action: "eventStatus",
    token: "test-token",
    id: EXISTING_EVENT.id,
    version: 4,
    status: "終了",
  });
  assert.equal(status.ok, true);
  assert.equal(calls.snapshotRefresh, 3);
});

test("イベント更新はキャッシュ内の該当イベントだけを差し替え、連絡先とカレンダーを読み直さない", () => {
  const { ctx, cache, calls } = gas();
  const snapshot = {
    version: 2,
    generatedAt: new Date().toISOString(),
    contacts: [{ name: "cached contact" }],
    events: [{ ...EXISTING_EVENT }],
    calendar: [["cached calendar"]],
    counts: { contacts: 1, events: 1, calendar: 1 },
  };
  snapshot.digest = ctx.snapshotDigest_(snapshot);
  ctx.encodeSnapshot_ = JSON.stringify;
  ctx.decodeSnapshot_ = JSON.parse;
  cache.set(ctx.MATERIAL_SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot));
  ctx.readContacts_ = () => { throw new Error("contacts must not be reread"); };
  ctx.calendarSnapshot_ = () => { throw new Error("calendar must not be reread"); };

  const result = runPost(ctx, {
    action: "eventUpdate", token: "test-token",
    event: { ...EXISTING_EVENT, title: "変更後", version: 3 },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.warningCode, undefined);
  assert.equal(calls.snapshotRefresh, 0);
  const updated = JSON.parse(cache.get(ctx.MATERIAL_SNAPSHOT_CACHE_KEY));
  assert.equal(updated.events[0].title, "変更後");
  assert.equal(updated.events[0].version, 4);
  assert.equal(updated.generatedAt, snapshot.generatedAt);
  assert.deepEqual(updated.contacts, snapshot.contacts);
  assert.deepEqual(updated.calendar, snapshot.calendar);
  assert.equal(updated.digest, ctx.snapshotDigest_(updated));
});

test("追加・終了・削除もキャッシュのイベント部分だけを更新する", () => {
  for (const action of ["eventCreate", "eventStatus", "eventDelete"]) {
    const { ctx, cache, calls } = gas();
    const snapshot = {
      version: 2, generatedAt: new Date().toISOString(),
      contacts: [{ name: "cached contact" }],
      events: [{ ...EXISTING_EVENT }],
      calendar: [["cached calendar"]],
      counts: { contacts: 1, events: 1, calendar: 1 },
    };
    snapshot.digest = ctx.snapshotDigest_(snapshot);
    ctx.encodeSnapshot_ = JSON.stringify;
    ctx.decodeSnapshot_ = JSON.parse;
    cache.set(ctx.MATERIAL_SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot));
    ctx.readContacts_ = () => { throw new Error("contacts must not be reread"); };
    ctx.calendarSnapshot_ = () => { throw new Error("calendar must not be reread"); };
    const body = action === "eventCreate"
      ? { action, token: "test-token", requestId: REQUEST_ID, event: VALID_NEW_EVENT }
      : { action, token: "test-token", id: EVENT_ID, version: 3, status: "終了" };
    const result = runPost(ctx, body);
    assert.equal(result.ok, true, `${action}: ${JSON.stringify(result)}`);
    assert.equal(calls.snapshotRefresh, 0, action);
    const updated = JSON.parse(cache.get(ctx.MATERIAL_SNAPSHOT_CACHE_KEY));
    assert.equal(updated.counts.events, action === "eventCreate" ? 2 : action === "eventDelete" ? 0 : 1);
    assert.equal(updated.digest, ctx.snapshotDigest_(updated));
    assert.deepEqual(updated.contacts, snapshot.contacts);
    assert.deepEqual(updated.calendar, snapshot.calendar);
    if (action === "eventCreate") assert.equal(updated.events[1].id, result.event.id);
    if (action === "eventStatus") assert.equal(updated.events[0].status, "終了");
  }
});

test("イベント更新はシート書き込みをflushしてからスナップショットを再生成する", () => {
  const { ctx, calls } = gas({ requireFlushBeforeSnapshot: true });
  const result = runPost(ctx, {
    action: "eventUpdate",
    token: "test-token",
    event: { ...EXISTING_EVENT, title: "flush確認", version: 3 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.warningCode, undefined);
  assert.equal(result.event.version, 4);
  assert.equal(calls.flush >= 1, true);
});

test("スナップショット更新に失敗してもイベント書き込み成功と明示警告を返す", () => {
  const { ctx, calls } = gas({ failSnapshotRefresh: true });
  const result = runPost(ctx, {
    action: "eventUpdate",
    token: "test-token",
    event: { ...EXISTING_EVENT, title: "書き込み済み", version: 3 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.warningCode, "snapshot_refresh_failed");
  assert.match(result.warning, /保存されました/);
  assert.equal(calls.snapshotRefresh, 1);
});

test("retrying eventCreate with the same requestId appends once", () => {
  const { ctx, calls } = gas();
  const first = runPost(ctx, { action: "eventCreate", token: "test-token", requestId: REQUEST_ID, event: VALID_NEW_EVENT });
  const second = runPost(ctx, { action: "eventCreate", token: "test-token", requestId: REQUEST_ID, event: VALID_NEW_EVENT });
  assert.equal(calls.append, 1);
  assert.equal(second.event.id, first.event.id);
  assert.deepEqual(second, first);
});

test("retrying eventCreate recovers from an idempotency save failure without appending twice", () => {
  const { ctx, calls } = gas({ failIdempotencySave: true });
  const first = runPost(ctx, {
    action: "eventCreate",
    token: "test-token",
    requestId: REQUEST_ID,
    event: VALID_NEW_EVENT,
  });
  assert.equal(first.ok, true, JSON.stringify(first));

  const second = runPost(ctx, {
    action: "eventCreate",
    token: "test-token",
    requestId: REQUEST_ID,
    event: VALID_NEW_EVENT,
  });
  assert.equal(second.ok, true);
  assert.equal(calls.append, 1);
  assert.match(second.event.id, /^evt_[A-Za-z0-9_-]{16,76}$/);
});

test("イベント要求の永続冪等性記録は上限を超えて増えない", () => {
  const { ctx, props } = gas();
  for (let i = 0; i < ctx.EVENT_REQUEST_PROPERTY_MAX + 12; i++) {
    const requestId = `req_${String(i).padStart(16, "0")}`;
    ctx.saveEventRequestResult_(requestId, { ok: true, index: i });
  }
  const keys = [...props.keys()].filter((key) => key.startsWith("EVENT_REQUEST_"));
  assert.equal(keys.length, ctx.EVENT_REQUEST_PROPERTY_MAX);
  assert.deepEqual(ctx.getEventRequestResult_("req_0000000000000211"), { ok: true, index: 211 });
});

test("properties上限超過時は実在する最古キーだけを削除して200件以下にする", () => {
  const { ctx, props } = gas();
  const retainedFirst = "req_0000000000000000";
  props.set(`EVENT_REQUEST_${retainedFirst}`, JSON.stringify({ savedAt: 999999, result: { index: 0 } }));
  for (let i = 1; i <= 204; i++) {
    const requestId = `req_${String(i).padStart(16, "0")}`;
    props.set(`EVENT_REQUEST_${requestId}`, JSON.stringify({ savedAt: i, result: { index: i } }));
  }
  ctx.saveEventRequestResult_("req_9999999999999999", { ok: true });
  const keys = [...props.keys()].filter((key) => key.startsWith("EVENT_REQUEST_"));
  assert.equal(keys.length, ctx.EVENT_REQUEST_PROPERTY_MAX);
  assert.equal(keys.includes(`EVENT_REQUEST_${retainedFirst}`), true);
});

test("versionはGASでも数値の正の整数だけを受け付ける", () => {
  for (const version of ["1", true, false, 0, 1.5]) {
    const { ctx } = gas();
    const result = runPost(ctx, {
      action: "eventCreate",
      token: "test-token",
      requestId: REQUEST_ID,
      event: { ...VALID_NEW_EVENT, version },
    });
    assert.equal(result.ok, false, `version=${String(version)}`);
    assert.equal(result.error, "invalid input");
  }
});

test("eventUpdate rejects a stale version without writing", () => {
  const { ctx, calls } = gas();
  const result = runPost(ctx, {
    action: "eventUpdate",
    token: "test-token",
    event: { ...EXISTING_EVENT, version: 2, title: "古い画面の変更" },
  });
  assert.deepEqual(result, { ok: false, error: "conflict", message: "別の画面で更新されています。" });
  assert.equal(calls.write, 0);
});

test("eventUpdate writes the canonical fields and increments the version", () => {
  const { ctx, eventRows, calls } = gas();
  const result = runPost(ctx, {
    action: "eventUpdate",
    token: "test-token",
    event: { ...EXISTING_EVENT, title: "更新後の交流会", version: 3 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.event.title, "更新後の交流会");
  assert.equal(result.event.version, 4);
  assert.equal(eventRows[1][5], "更新後の交流会");
  assert.equal(eventRows[1][11], 4);
  assert.equal(calls.write, 1);
});

test("eventStatus changes only the state and never deletes a row", () => {
  const { ctx, eventRows, calls } = gas();
  const ended = runPost(ctx, {
    action: "eventStatus",
    token: "test-token",
    id: EXISTING_EVENT.id,
    version: 3,
    status: "終了",
  });
  assert.equal(ended.ok, true);
  assert.equal(ended.event.status, "終了");
  assert.equal(ended.event.version, 4);
  assert.equal(eventRows.length, 2);
  assert.equal(eventRows[1][1], "終了");
  assert.equal(calls.delete, 0);

  const reopened = runPost(ctx, {
    action: "eventStatus",
    token: "test-token",
    id: EXISTING_EVENT.id,
    version: 4,
    status: "公開",
  });
  assert.equal(reopened.event.status, "公開");
  assert.equal(reopened.event.version, 5);
  assert.equal(calls.delete, 0);
});

test("eventStatus requires an explicit update version", () => {
  for (const version of [null, "3", true, 0, 1.5]) {
    const { ctx } = gas();
    const result = runPost(ctx, {
      action: "eventStatus",
      token: "test-token",
      id: EXISTING_EVENT.id,
      version,
      status: "終了",
    });
    assert.deepEqual(result, { ok: false, error: "invalid input" });
  }
});

test("eventDelete removes exactly the matching row and refreshes the snapshot", () => {
  const { ctx, eventRows, calls } = gas();
  const result = runPost(ctx, {
    action: "eventDelete",
    token: "test-token",
    id: EXISTING_EVENT.id,
    version: EXISTING_EVENT.version,
  });
  assert.deepEqual(result, { ok: true, deletedId: EXISTING_EVENT.id });
  assert.equal(eventRows.length, 1);
  assert.equal(calls.delete, 1);
  assert.equal(calls.flush >= 1, true);
  assert.equal(calls.snapshotRefresh, 1);
});

test("eventDelete rejects a stale or invalid version without deleting", () => {
  for (const version of [2, null, "3", true, 0, 1.5]) {
    const { ctx, eventRows, calls } = gas();
    const result = runPost(ctx, {
      action: "eventDelete",
      token: "test-token",
      id: EXISTING_EVENT.id,
      version,
    });
    if (version === 2) assert.equal(result.error, "conflict");
    else assert.equal(result.error, "invalid input");
    assert.equal(eventRows.length, 2);
    assert.equal(calls.delete, 0);
  }
});

test("duplicate event IDs are rejected before a write", () => {
  const { ctx, eventRows, calls } = gas();
  eventRows.push(eventRows[1].slice());
  const result = runPost(ctx, {
    action: "eventStatus",
    token: "test-token",
    id: EVENT_ID,
    version: 3,
    status: "終了",
  });
  assert.match(result.error, /重複/);
  assert.equal(calls.write, 0);
});

test("移行レポートはバックアップ確認後だけ投入でき、同じreportIdの再実行は冪等になる", () => {
  const { ctx, eventRows, calls } = gas({ migrationEmpty: true });
  const report = {
    reportId: "mig_01JREPORT0000000000000000",
    sourceVersion: 1,
    ready: true,
    backupSheetName: "イベント_旧形式_backup_20260922_0600",
    backupVerified: true,
    sourceCount: 1,
    recordCount: 1,
    warnings: [],
    skipped: [],
    records: [{
      id: "",
      status: "公開",
      date: "2026-10-03",
      startTime: "19:00",
      endTime: "21:00",
      title: "移行イベント",
      theme: "経営者",
      place: "新橋",
      url: "https://example.com/event",
      sheetUrl: "https://docs.google.com/spreadsheets/d/test/edit",
      updatedAt: "",
      version: 1,
      migrationKey: "migsrc_01JLEGACY00000000000000000",
    }],
    sourceRows: [["", "10/3 19:00-21:00 @新橋", ""]],
  };
  const first = ctx.migrateStructuredEvents(report);
  const second = ctx.migrateStructuredEvents(report);

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.recordCount, 1);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
  assert.equal(eventRows.length, 2);
  assert.match(eventRows[1][0], /^evt_/);
  assert.equal(eventRows[1][11], 1);
  assert.equal(calls.append, 1);
});

test("移行はstaging中の通常readとsnapshotを公開せず、失敗後も行を削除しない", () => {
  const sourceRows = [
    ["", "10/3 19:00-21:00 @新橋", ""],
    ["", "10/4 19:00-21:00 @渋谷", ""],
  ];
  const { ctx, eventRows, calls } = gas({ migrationEmpty: true, backupRows: sourceRows, failAppendAt: 2 });
  const report = {
    reportId: "mig_01JSTAGING000000000000000",
    sourceVersion: 1,
    ready: true,
    backupSheetName: "イベント_旧形式_backup_20260922_0600",
    backupVerified: true,
    sourceCount: sourceRows.length,
    sourceRows,
    recordCount: 2,
    warnings: [],
    skipped: [],
    records: [
      { ...VALID_NEW_EVENT, id: "", date: "2026-10-03", title: "移行一件目", version: 1, migrationKey: "migsrc_01JLEGACY00000000000000001" },
      { ...VALID_NEW_EVENT, id: "", date: "2026-10-04", title: "移行二件目", version: 1, migrationKey: "migsrc_01JLEGACY00000000000000002" },
    ],
  };

  const result = ctx.migrateStructuredEvents(report);
  assert.equal(result.ok, false);
  assert.equal(eventRows.length, 2, "失敗前に書かれた行は物理削除しない");
  assert.equal(calls.delete, 0);

  const read = runPost(ctx, { action: "read", what: "structuredEvents", token: "test-token" });
  assert.equal(read.ok, false);
  assert.match(read.error, /移行/);
  assert.throws(() => ctx.refreshMaterialSnapshotAtUnlocked_(new Date("2026-09-23T00:00:00+09:00")), /移行/);
});

test("移行requestIdはreportIdや並べ替えに依存せず、同じreportIdの不一致を停止する", () => {
  const sourceRows = [
    ["", "10/3 19:00-21:00 @新橋", ""],
    ["", "10/4 19:00-21:00 @渋谷", ""],
  ];
  const baseRecords = [
    { ...VALID_NEW_EVENT, id: "", date: "2026-10-03", title: "移行一件目", version: 1, migrationKey: "migsrc_01JLEGACY00000000000000001" },
    { ...VALID_NEW_EVENT, id: "", date: "2026-10-04", title: "移行二件目", version: 1, migrationKey: "migsrc_01JLEGACY00000000000000002" },
  ];
  const makeReport = (reportId, records) => ({
    reportId,
    sourceVersion: 1,
    ready: true,
    backupSheetName: "イベント_旧形式_backup_20260922_0600",
    backupVerified: true,
    sourceCount: sourceRows.length,
    sourceRows,
    recordCount: records.length,
    warnings: [],
    skipped: [],
    records,
  });
  const { ctx, eventRows, calls } = gas({ migrationEmpty: true, backupRows: sourceRows });

  const first = ctx.migrateStructuredEvents(makeReport("mig_01JREPORTAAAA00000000000", baseRecords));
  const reordered = ctx.migrateStructuredEvents(makeReport("mig_01JREPORTBBBB00000000000", baseRecords.slice().reverse()));
  assert.equal(first.ok, true);
  assert.equal(reordered.ok, true);
  assert.equal(eventRows.length, 3, "reportId変更と並べ替えで重複投入しない");
  assert.equal(calls.append, 2);

  const changed = baseRecords.map((record) => ({ ...record }));
  changed[0].title = "不一致の再送";
  const mismatch = ctx.migrateStructuredEvents(makeReport("mig_01JREPORTAAAA00000000000", changed));
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.error, /不一致|照合|異なる元データ/);
  assert.equal(eventRows.length, 3);
  assert.equal(calls.append, 2);
});

test("移行レポートの警告またはバックアップ未確認時はシートへ書き込まない", () => {
  for (const changes of [
    { backupVerified: false },
    { backupVerified: "true" },
    { backupSheetName: "missing_backup" },
    { warnings: [{ index: 0, message: "時刻が未解釈" }] },
    { skipped: [{ index: 0, reason: "開催日が不正" }] },
    { warnings: undefined },
    { skipped: undefined },
  ]) {
    const { ctx, eventRows, calls } = gas({ migrationEmpty: true });
    const report = {
      reportId: "mig_01JREPORT0000000000000000",
      sourceVersion: 1,
      backupSheetName: "イベント_旧形式_backup_20260922_0600",
      backupVerified: true,
      sourceCount: 1,
      recordCount: 1,
      warnings: [],
      skipped: [],
      records: [{ date: "2026-10-03", title: "移行イベント", version: 0 }],
      ...changes,
    };
    const result = ctx.migrateStructuredEvents(report);
    assert.equal(result.ok, false);
    assert.equal(eventRows.length, 1);
    assert.equal(calls.append, 0);
  }
});

test("移行レポートのsourceCountと元行がバックアップと一致しなければ投入しない", () => {
  const sourceRows = [["", "10/3 19:00-21:00 @新橋", ""]];
  const base = {
    reportId: "mig_01JSOURCECHECK000000000000",
    sourceVersion: 1,
    ready: true,
    backupSheetName: "イベント_旧形式_backup_20260922_0600",
    backupVerified: true,
    sourceCount: 1,
    sourceRows,
    recordCount: 1,
    warnings: [],
    skipped: [],
    records: [{ ...VALID_NEW_EVENT, id: "", version: 1, migrationKey: "migsrc_01JSOURCECHECK000000000" }],
  };
  for (const change of [
    { sourceCount: 2 },
    { sourceRows: [["", "別の元行", ""]] },
  ]) {
    const { ctx, eventRows, calls } = gas({ migrationEmpty: true, backupRows: sourceRows });
    const result = ctx.migrateStructuredEvents({ ...base, ...change });
    assert.equal(result.ok, false);
    assert.equal(eventRows.length, 1);
    assert.equal(calls.append, 0);
  }
});

test("正常な移行レポート土台からwarnings/skipped/backup検査条件を一つずつ変えると投入前に停止する", () => {
  const sourceRows = migrationSourceRows(1);
  const base = makeMigrationReport(1, { sourceRows });
  const changes = [
    { warnings: [{ line: 1, message: "警告" }] },
    { skipped: [{ line: 1, reason: "未解釈" }] },
    { backupVerified: false },
    { backupVerified: "true" },
    { sourceCount: 2 },
    { sourceRows: [["", "別の元行", ""]] },
  ];

  for (const change of changes) {
    const fixture = gas({ migrationEmpty: true, backupRows: sourceRows });
    const result = fixture.ctx.migrateStructuredEvents({ ...base, ...change });
    assert.equal(result.ok, false, JSON.stringify(change));
    assert.equal(fixture.eventRows.length, 1, JSON.stringify(change));
    assert.equal(fixture.calls.append, 0, JSON.stringify(change));
  }
});

test("移行状態と結果は固定長署名と9KB以下のメタデータで8/12/20件を保存する", () => {
  for (const count of [8, 12, 20]) {
    const sourceRows = migrationSourceRows(count);
    const fixture = gas({ migrationEmpty: true, backupRows: sourceRows, propertyLimitBytes: 9 * 1024 });
    const result = fixture.ctx.migrateStructuredEvents(makeMigrationReport(count, { sourceRows }));
    assert.equal(result.ok, true, `count=${count}: ${JSON.stringify(result)}`);

    const migrationEntries = [...fixture.props.entries()].filter(([key]) => key.startsWith("EVENT_MIGRATION_"));
    assert.ok(migrationEntries.length >= 2, `count=${count}`);
    for (const [key, value] of migrationEntries) {
      assert.ok(Buffer.byteLength(value, "utf8") <= 9 * 1024, `${key} is oversized`);
    }
    const state = JSON.parse(fixture.props.get("EVENT_MIGRATION_STATE"));
    assert.match(state.reportSignature, /^[0-9a-f]{64}$/);
    assert.match(state.sourceSignature, /^[0-9a-f]{64}$/);
    assert.equal(state.issuedRowCount, count);
    assert.match(state.issuedRowsDigest, /^[0-9a-f]{64}$/);
    const issuedEntries = migrationEntries.filter(([key]) => key.startsWith("EVENT_MIGRATION_ISSUED_"));
    assert.equal(issuedEntries.length, count);
    issuedEntries.forEach(([, value]) => {
      const issued = JSON.parse(value);
      assert.equal(issued.version, 1);
      assert.match(issued.sourceSignature, /^[0-9a-f]{64}$/);
      assert.match(issued.rowSignature, /^[0-9a-f]{64}$/);
    });
    const resultValue = JSON.parse(fixture.props.get(`EVENT_MIGRATION_${makeMigrationReport(count, { sourceRows }).reportId}`));
    assert.equal(Object.prototype.hasOwnProperty.call(resultValue, "records"), false);
    assert.equal(resultValue.issuedRowCount, count);
    assert.match(resultValue.issuedRowsDigest, /^[0-9a-f]{64}$/);
  }
});

test("移行状態は9KB直前の入力を短縮し、結果の上限超過は保存しない", () => {
  const fixture = gas({ propertyLimitBytes: 9 * 1024 });
  fixture.ctx.saveEventMigrationState_({
    status: "failed",
    reportId: "mig_01JBOUNDARY00000000000000",
    reportSignature: "a".repeat(64),
    sourceSignature: "b".repeat(64),
    sourceCount: 1,
    recordCount: 1,
    error: "x".repeat(8 * 1024),
  });
  assert.ok(Buffer.byteLength(fixture.props.get("EVENT_MIGRATION_STATE"), "utf8") <= 9 * 1024);
  assert.throws(() => fixture.ctx.saveEventMigrationResult_("mig_01JBOUNDARY00000000000000", {
    reportSignature: "a".repeat(64),
    sourceSignature: "b".repeat(64),
    result: { ok: true, eventIds: Array.from({ length: 5000 }, () => "evt_01JOVERSIZED000000000000") },
  }), /9KB|容量|大きすぎ/);
});

test("移行結果の保存失敗後は同じレポートを再送して公開可能なcompleteへ再開する", () => {
  const sourceRows = migrationSourceRows(2);
  const fixture = gas({
    migrationEmpty: true,
    backupRows: sourceRows,
    failMigrationResultSave: true,
  });
  const report = makeMigrationReport(2, { sourceRows });
  const first = fixture.ctx.migrateStructuredEvents(report);
  assert.equal(first.ok, false);
  assert.equal(fixture.eventRows.length, 3);
  assert.equal(JSON.parse(fixture.props.get("EVENT_MIGRATION_STATE")).status, "failed");
  const issuedBeforeRetry = [...fixture.props.entries()]
    .filter(([key]) => key.startsWith("EVENT_MIGRATION_ISSUED_"))
    .sort();
  assert.equal(runPost(fixture.ctx, { action: "read", what: "structuredEvents", token: "test-token" }).ok, false);

  fixture.setFailMigrationResultSave(false);
  const second = fixture.ctx.migrateStructuredEvents(report);
  assert.equal(second.ok, true);
  assert.equal(fixture.eventRows.length, 3);
  assert.equal(JSON.parse(fixture.props.get("EVENT_MIGRATION_STATE")).status, "complete");
  const issuedAfterRetry = [...fixture.props.entries()]
    .filter(([key]) => key.startsWith("EVENT_MIGRATION_ISSUED_"))
    .sort();
  assert.deepEqual(issuedAfterRetry, issuedBeforeRetry);
});

test("append後の発行値保存失敗は元の発行値を保持して同一・別reportIdから再開でき、改ざん行は採用しない", () => {
  for (const failAt of [1, 2]) {
    for (const resendWithDifferentReportId of [false, true]) {
      for (const tamperColumn of [null, 0, 10]) {
        const sourceRows = migrationSourceRows(2);
        const fixture = gas({
          migrationEmpty: true,
          backupRows: sourceRows,
          failIssuedSaveAt: failAt,
        });
        const report = makeMigrationReport(2, { sourceRows });
        const first = fixture.ctx.migrateStructuredEvents(report);
        assert.equal(first.ok, false, JSON.stringify({ failAt, resendWithDifferentReportId, tamperColumn, first }));
        assert.equal(fixture.eventRows.length, failAt + 1);

        const pendingRow = failAt;
        const originalValue = fixture.eventRows[pendingRow][tamperColumn];
        if (tamperColumn === 0) fixture.eventRows[pendingRow][tamperColumn] = "evt_01JTAMPERED0000000000001";
        if (tamperColumn === 10) fixture.eventRows[pendingRow][tamperColumn] = "2026-09-23T07:00:00+09:00";

        fixture.setFailIssuedSaveAt(null);
        const resend = resendWithDifferentReportId
          ? { ...report, reportId: "mig_01JRESENDISSUED0000000000" }
          : report;
        const second = fixture.ctx.migrateStructuredEvents(resend);
        if (tamperColumn === null) {
          assert.equal(second.ok, true, JSON.stringify({ failAt, resendWithDifferentReportId, second }));
          assert.equal(fixture.eventRows.length, 3);
          assert.equal(JSON.parse(fixture.props.get("EVENT_MIGRATION_STATE")).status, "complete");
          assert.equal([...fixture.props.keys()].some(key => key.startsWith("EVENT_MIGRATION_PENDING_")), false);
        } else {
          assert.equal(second.ok, false, JSON.stringify({ failAt, resendWithDifferentReportId, tamperColumn, second }));
          assert.match(second.error, /不一致|発行|再開/);
          assert.equal(fixture.eventRows[pendingRow][tamperColumn] !== originalValue, true);
          assert.equal(JSON.parse(fixture.props.get("EVENT_MIGRATION_STATE")).status, "failed");
          assert.equal(fixture.calls.delete, 0);
        }
      }
    }
  }
});

test("古い成功済みレポートは現在のfailed世代をcompleteへ戻さない", () => {
  const sourceRows = migrationSourceRows(2);
  const fixture = gas({ migrationEmpty: true, backupRows: sourceRows });
  const firstReport = makeMigrationReport(1, { sourceRows });
  const firstResult = fixture.ctx.migrateStructuredEvents(firstReport);
  assert.equal(firstResult.ok, true, JSON.stringify(firstResult));

  const failedReport = makeMigrationReport(3, {
    sourceRows,
    reportId: "mig_01JFAILEDGEN0000000000000",
  });
  fixture.ctx.saveEventMigrationState_({
    status: "failed",
    reportId: failedReport.reportId,
    reportSignature: fixture.ctx.migrationReportSignature_(failedReport),
    sourceSignature: fixture.ctx.migrationSourceSignature_(failedReport),
    sourceCount: failedReport.sourceCount,
    recordCount: failedReport.recordCount,
  });
  const before = fixture.eventRows.map(row => row.slice());
  const stale = fixture.ctx.migrateStructuredEvents(firstReport);

  assert.equal(stale.ok, false, JSON.stringify({ stale, state: JSON.parse(fixture.props.get("EVENT_MIGRATION_STATE")) }));
  assert.deepEqual(fixture.eventRows, before);
  assert.equal(fixture.calls.delete, 0);
  assert.equal(JSON.parse(fixture.props.get("EVENT_MIGRATION_STATE")).status, "failed");
  assert.equal(runPost(fixture.ctx, { action: "read", what: "structuredEvents", token: "test-token" }).ok, false);
});

test("完了済み移行へ異なる元データを投入せず、既存行を削除しない", () => {
  const sourceRows = migrationSourceRows(1);
  const fixture = gas({ migrationEmpty: true, backupRows: sourceRows });
  const firstReport = makeMigrationReport(1, { sourceRows });
  const firstResult = fixture.ctx.migrateStructuredEvents(firstReport);
  assert.equal(firstResult.ok, true, JSON.stringify(firstResult));
  const before = fixture.eventRows.map(row => row.slice());
  const changedRecord = {
    ...firstReport.records[0],
    title: "修正版の元イベント",
    migrationKey: "migsrc_11111111111111111111111111111111",
  };
  const changedReport = makeMigrationReport(1, {
    sourceRows,
    reportId: "mig_01JCHANGEDSRC000000000000",
    records: [changedRecord],
  });

  const result = fixture.ctx.migrateStructuredEvents(changedReport);
  assert.equal(result.ok, false);
  assert.deepEqual(fixture.eventRows, before);
  assert.equal(fixture.calls.delete, 0);
});

test("発行済みA-LとmigrationKeyの照合で同一report・別reportId再送のA列/K列改変を拒否する", () => {
  for (const changedColumn of [0, 10]) {
    for (const resendWithDifferentReportId of [false, true]) {
      const sourceRows = migrationSourceRows(1);
      const fixture = gas({ migrationEmpty: true, backupRows: sourceRows });
      const report = makeMigrationReport(1, { sourceRows });
      const first = fixture.ctx.migrateStructuredEvents(report);
      assert.equal(first.ok, true, JSON.stringify(first));
      const issuedValue = fixture.eventRows[1][changedColumn];
      fixture.eventRows[1][changedColumn] = changedColumn === 0
        ? "evt_01JMODIFIED00000000000001"
        : "2026-09-23T07:00:00+09:00";
      const resend = resendWithDifferentReportId
        ? { ...report, reportId: "mig_01JRESENDDIFFERENT0000000" }
        : report;

      const result = fixture.ctx.migrateStructuredEvents(resend);
      assert.equal(result.ok, false, JSON.stringify({ changedColumn, resendWithDifferentReportId, result }));
      assert.equal(fixture.eventRows[1][changedColumn] !== issuedValue, true);
      assert.equal(fixture.calls.delete, 0);
    }
  }
});
