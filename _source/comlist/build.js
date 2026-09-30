#!/usr/bin/env node
/**
 * 人脈ガーデン ビルドスクリプト
 *
 * 毎朝のタスクが「素材を集める → これを実行するだけ」で index.html を作れるようにするためのもの。
 * 重いロジック（空き枠計算・暗号化・差し込み・検証）はすべてここに固めてある。
 *
 * 使い方:
 *   フル build（暗号化 index.html を出力）:
 *     node build.js \
 *       --today 2026-08-08 --now 08:00 \
 *       --master _assets/list.html \
 *       --contacts _work/contacts.json \        # 連絡先 配列（各要素に _row を含む）
 *       --events   _work/app_events.json \       # アプリ表示用 EVENTS 配列（イベントシート由来）
 *       --calendar _work/calendar.json \         # 空き枠計算用のGoogleカレンダー予定 [["YYYY-MM-DDTHH:MM","..."], ...]
 *       --pass levelup \
 *       --out _deploy/comlist.html
 *
 *   空き枠だけ計算して表示（マスターの FREE_SLOTS 更新用）:
 *     node build.js --slots-only --today 2026-08-08 --now 08:00 --calendar _work/calendar.json
 *
 * --today / --now を渡さない場合はマシンのローカル時刻を使う（サンドボックスの時計がずれることがあるので、
 *  毎朝タスクでは必ず実際の日付を --today で渡すこと）。
 */

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { validateDailyTasks } = require("./daily_tasks");
const { resolveDefeated, appendVictoryLog } = require("./resolved_tasks");
const { normalizeEvent, eventToDisplay } = require("./event_records");

function writeAtomic(filePath, contents, fsApi = fs) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(12).toString("hex")}.tmp`
  );
  fsApi.mkdirSync(directory, { recursive: true });
  try {
    fsApi.writeFileSync(temporaryPath, contents, "utf8");
    fsApi.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fsApi.unlinkSync(temporaryPath); } catch (ignore) { /* preserve the original error */ }
    throw error;
  }
}

function materialManifestPath(files) {
  const contactsName = path.basename(files.contacts);
  const match = contactsName.match(/^contacts(.*)\.json$/);
  const suffix = match ? match[1] : "";
  return path.join(path.dirname(files.contacts), `material_manifest${suffix}.json`);
}

function resolveManifestFile(baseDir, relativePath) {
  if (typeof relativePath !== "string" || !relativePath) throw new Error("素材manifestのパスがありません");
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, relativePath);
  const relative = path.relative(resolvedBase, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("素材manifestが作業ディレクトリ外を指しています");
  }
  return resolved;
}

function resolveMaterialSelection(files, proofPath, fsApi = fs) {
  const defaults = {
    contacts: files.contacts,
    events: files.events,
    calendar: files.calendar,
    proof: proofPath || path.join(path.dirname(files.contacts), "snapshot_success.json"),
  };
  const manifestPath = materialManifestPath(files);
  if (!fsApi.existsSync || !fsApi.existsSync(manifestPath)) return defaults;
  let manifest;
  try {
    manifest = JSON.parse(fsApi.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error("素材manifestを読み込めません");
  }
  if (!manifest || manifest.version !== 1 || !manifest.files) {
    throw new Error("素材manifestの形式が不正です");
  }
  if (manifest.status === "invalidated" || manifest.active === false) {
    throw new Error("素材manifestが無効化されているためbuildできません");
  }
  const baseDir = path.dirname(manifestPath);
  return {
    contacts: resolveManifestFile(baseDir, manifest.files.contacts),
    events: resolveManifestFile(baseDir, manifest.files.events),
    calendar: resolveManifestFile(baseDir, manifest.files.calendar),
    proof: resolveManifestFile(baseDir, manifest.files.proof),
    manifestPath,
    manifest,
  };
}

const SNAPSHOT_PROOF_MAX_AGE_MS = 3 * 60 * 60 * 1000;

function readMaterialFiles(files, fsApi = fs) {
  const selected = resolveMaterialSelection(files, null, fsApi);
  const loaded = {};
  for (const name of ["contacts", "events", "calendar"]) {
    const filePath = selected[name];
    if (!filePath) throw new Error("素材ファイルのパスがありません: " + name);
    const raw = fsApi.readFileSync(filePath);
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    loaded[name] = {
      path: filePath,
      bytes,
      text: bytes.toString("utf8"),
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  }
  return loaded;
}

function verifySnapshotProof(contactsPath, eventsPath, calendarPath, proofPath, materialFiles) {
  const selected = resolveMaterialSelection({ contacts: contactsPath, events: eventsPath, calendar: calendarPath }, proofPath, fs);
  const resolvedProofPath = selected.proof;
  let proof;
  try {
    proof = JSON.parse(fs.readFileSync(resolvedProofPath, "utf8"));
  } catch (error) {
    throw new Error("新鮮なスナップショット成功証跡がありません");
  }
  if (!proof || proof.version !== 1 || proof.result !== "OK" || proof.source !== "snapshot") {
    throw new Error("スナップショット成功証跡がOKではありません");
  }
  const generatedMs = Date.parse(proof.generatedAt);
  const ageMs = Date.now() - generatedMs;
  if (!Number.isFinite(generatedMs) || ageMs < -5 * 60 * 1000 || ageMs > SNAPSHOT_PROOF_MAX_AGE_MS) {
    throw new Error("スナップショット成功証跡が古すぎます");
  }
  const actual = { contacts: selected.contacts, events: selected.events, calendar: selected.calendar };
  const loaded = materialFiles || readMaterialFiles(actual);
  for (const name of Object.keys(actual)) {
    const entry = proof.files && proof.files[name];
    if (!entry || entry.path !== path.basename(actual[name])) {
      throw new Error("スナップショット成功証跡と素材の組み合わせが一致しません");
    }
    const file = loaded[name];
    if (!file || file.path !== actual[name]) {
      throw new Error("素材manifestが検証中に切り替わりました");
    }
    if (entry.bytes !== file.bytes.length || entry.sha256 !== file.sha256) {
      throw new Error("スナップショット成功証跡と素材の内容が一致しません");
    }
  }
  return proof;
}

// ---------- 引数 ----------
function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) { a[key] = true; }
      else { a[key] = next; i++; }
    }
  }
  return a;
}
const ARGS = parseArgs(process.argv);

function jstNow() {
  // マシンのローカル時刻を JST とみなす（--today/--now 未指定時のフォールバック）
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return {
    today: d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()),
    now: p(d.getHours()) + ":" + p(d.getMinutes())
  };
}
const NOWDEF = jstNow();
const TODAY = ARGS.today || NOWDEF.today;   // "YYYY-MM-DD"
const NOWHM = ARGS.now || NOWDEF.now;       // "HH:MM"

// ========== 空き枠計算 ==========
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const EVENT_STATUSES = new Set(["公開", "終了"]);
const DISPLAY_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAX_EVENT_URL_LENGTH = 500;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function validateDisplayDate(value, year) {
  const text = String(value == null ? "" : value).trim();
  if (!/^\d{1,2}\/\d{1,2}(?:[、,・]\d{1,2})*$/.test(text)) {
    throw new Error("表示開催日が不正です");
  }
  const numbers = text.match(/\d+/g).map(Number);
  const month = numbers[0];
  for (const day of numbers.slice(1)) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new Error("表示開催日が不正です");
    }
  }
}

function validateDisplayTime(value) {
  const text = String(value == null ? "" : value).trim();
  const match = text.match(/^(\d{2}:\d{2})\s*[-ー–—〜~]\s*(\d{2}:\d{2})$/);
  if (!match) {
    if (/^\d{2}:\d{2}\s*[-ー–—〜~]/.test(text)) throw new Error("表示時刻が不正です");
    return;
  }
  if (!DISPLAY_TIME_RE.test(match[1]) || !DISPLAY_TIME_RE.test(match[2]) || match[2] < match[1]) {
    throw new Error("表示時刻が不正です");
  }
}

function validateDisplayUrl(value, label) {
  const text = String(value == null ? "" : value).trim();
  if (text && (text.length > MAX_EVENT_URL_LENGTH || !/^https:\/\/\S+$/.test(text))) throw new Error(`${label}が不正です`);
  return text;
}

function validateDisplayEvent(event, year) {
  if (!event || typeof event !== "object") throw new Error("イベントが不正です");
  const title = String(event.title == null ? "" : event.title).trim();
  if (!title || title.length > 120) throw new Error("タイトルが不正です");
  validateDisplayDate(event.d, year);
  validateDisplayTime(event.t);
  const url = validateDisplayUrl(event.url, "案内URL");
  const sheetUrl = hasOwn(event, "sheetUrl") ? validateDisplayUrl(event.sheetUrl, "集計シートURL") : "";
  const sheetAlias = hasOwn(event, "sheet") ? validateDisplayUrl(event.sheet, "集計シートURL") : "";
  const sheet = sheetUrl || sheetAlias;
  if (sheet && !/^https:\/\/docs\.google\.com\/spreadsheets\/.+$/.test(sheet)) {
    throw new Error("集計シートURLが不正です");
  }
  if (event.status != null && !EVENT_STATUSES.has(String(event.status).trim())) {
    throw new Error("状態が不正です");
  }
  return { ...event, title, d: String(event.d).trim(), t: String(event.t == null ? "" : event.t).trim(), url, sheet };
}

function validateBuildEvents(events, year) {
  if (!Array.isArray(events)) throw new Error("イベント一覧が不正です");
  const seenIds = new Set();
  return events.map((event) => {
    const structured = ["id", "status", "date", "startTime", "endTime", "sheetUrl", "updatedAt", "version"]
      .some((key) => hasOwn(event || {}, key));
    if (!structured) return validateDisplayEvent(event, year);

    const displayFields = ["d", "t", "sheet"].some((key) => hasOwn(event || {}, key));
    if (displayFields) validateDisplayEvent(event, year);
    const input = { ...event, sheetUrl: event.sheetUrl || event.sheet };
    const normalized = normalizeEvent(input);
    if (seenIds.has(normalized.id)) throw new Error("イベントIDが重複しています");
    seenIds.add(normalized.id);
    const display = eventToDisplay(normalized);
    if (hasOwn(event, "d") && String(event.d).trim() !== display.d) throw new Error("表示開催日が不正です");
    if (hasOwn(event, "t") && String(event.t).trim() !== display.t) throw new Error("表示時刻が不正です");
    return display;
  });
}

function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function toMin(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
function fmtT(m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }

// 予定 [startISO,endISO]（分単位 wall time, タイムゾーンなし）を、その日 dayStr の [0,1440] にクランプ
function evMinOnDay(dayStr, ev) {
  const [es, ee] = ev;
  const dayS = dayStr + "T00:00", dayE = dayStr + "T23:59";
  if (ee <= dayS || es > dayE) return null;      // その日にかからない
  let s = (es < dayS) ? 0 : toMin(es.slice(11));
  let e = (ee > dayStr + "T23:59") ? 1440 : toMin(ee.slice(11));
  if (es < dayS) s = 0;
  if (ee > dayStr + "T23:59") e = 1440;
  if (s < 0) s = 0; if (e > 1440) e = 1440;
  if (e <= s) return null;
  return [s, e];
}
function subtract(winS, winE, busy) {
  let free = [[winS, winE]];
  busy.forEach((b) => {
    const nf = [];
    free.forEach((f) => {
      if (b[1] <= f[0] || b[0] >= f[1]) { nf.push(f); return; }
      if (b[0] > f[0]) nf.push([f[0], Math.min(b[0], f[1])]);
      if (b[1] < f[1]) nf.push([Math.max(b[1], f[0]), f[1]]);
    });
    free = nf.filter((x) => x[1] > x[0]);
  });
  return free;
}
/**
 * 平日=昼12:00-13:30/夜18:00-24:00、土日=8:00-24:00 の中で、
 * 予定を差し引いて連続1.5h(=90分)枠を先頭から詰めて切り出す。過去分(today の now 以前)は除外。
 */
function computeSlots(events, todayStr, nowHM) {
  const start = new Date(todayStr + "T00:00:00");
  const nowMin = toMin(nowHM);
  const slots = [];
  for (let i = 0; i < 31; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const dayStr = ymd(d), dow = d.getDay();
    const weekend = (dow === 0 || dow === 6);
    const windows = weekend ? [[8 * 60, 24 * 60]] : [[12 * 60, 13 * 60 + 30], [18 * 60, 24 * 60]];
    const busy = [];
    events.forEach((ev) => { const r = evMinOnDay(dayStr, ev); if (r) busy.push(r); });
    windows.forEach((w) => {
      subtract(w[0], w[1], busy).forEach((iv) => {
        let s = iv[0];
        while (s + 90 <= iv[1]) {
          const isPastToday = (i === 0 && s < nowMin);
          if (!isPastToday) slots.push({ d: (d.getMonth() + 1) + "/" + d.getDate(), dow: DOW[dow], t: fmtT(s) + "-" + fmtT(s + 90) });
          s += 90;
        }
      });
    });
  }
  return slots;
}

// ========== 暗号化（アプリの復号ゲートと対）==========
async function encryptPayload(payload, pass) {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const subtle = crypto.webcrypto.subtle;
  const keyMat = await subtle.importKey("raw", Buffer.from(pass, "utf8"), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    keyMat, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    key,
    ENC: { salt: salt.toString("base64"), iv: iv.toString("base64"), ct: Buffer.from(ct).toString("base64"), it: 250000 }
  };
}
async function decryptCheck(ENC, pass) {
  const subtle = crypto.webcrypto.subtle;
  const keyMat = await subtle.importKey("raw", Buffer.from(pass, "utf8"), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey(
    { name: "PBKDF2", salt: Buffer.from(ENC.salt, "base64"), iterations: ENC.it, hash: "SHA-256" },
    keyMat, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(ENC.iv, "base64") }, key, Buffer.from(ENC.ct, "base64"));
  return JSON.parse(Buffer.from(pt).toString("utf8"));
}

// 復号ゲート（パスフレーズ入力→復号→DATA代入→描画）
function gateHtml(ENC, dateStr) {
  // dateStr: "YYYY-MM-DD" → "YYYY/M/D" 表示
  var dispDate = "";
  if (dateStr) { var m = dateStr.split("-"); dispDate = (+m[0]) + "/" + (+m[1]) + "/" + (+m[2]); }
  return '<div id="lockgate" style="position:fixed;inset:0;z-index:9999;background:#f2f7ee;display:flex;align-items:center;justify-content:center;">'
    + '<div style="text-align:center;font-family:sans-serif;">'
    + '<div style="font-size:22px;margin-bottom:12px;"><span class="brief-icon bi-18" role="img" aria-label="ロック"></span> マイベストライフ</div>'
    + '<input id="lockpass" type="password" placeholder="パスフレーズ" style="padding:10px 12px;font-size:15px;border:1px solid #cdddc5;border-radius:8px;">'
    + '<button id="lockbtn" style="margin-left:8px;padding:10px 16px;font-size:15px;border:0;border-radius:8px;background:#2f8f4e;color:#fff;font-weight:700;cursor:pointer;"><span class="brief-icon bi-20" aria-hidden="true"></span> ひらく</button>'
    + '<label style="display:block;margin-top:10px;font-size:13px;color:#5f6f58;"><input id="lockremember" type="checkbox"> この端末で30日間覚える</label>'
    + '<div id="lockerr" style="color:#c0392b;font-size:13px;margin-top:10px;min-height:18px;"></div>'
    + (dispDate ? '<div style="color:#7a8a72;font-size:12px;margin-top:14px;">データ更新日: ' + dispDate + '</div>' : '')
    + '</div></div>'
    + '\n<script data-comlist="lock">\n'
    + 'let DATA = [];\n'
    + 'let DAILY_TASKS = [];\n'
    + 'const ENC = ' + JSON.stringify(ENC) + ';\n'
    + '(function(){\n'
    + '  function b64d(s){var bin=atob(s);var u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;}\n'
    // 「覚える」を選んだ端末だけ、パスフレーズを期限付きでlocalStorageに置く。
    // 連絡先の平文は保存しない。復号に失敗したら（パスフレーズ変更時など）記憶を消す。
    + '  var REMEMBER_KEY="garden-pass", REMEMBER_MS=30*86400000;\n'
    + '  function recall(){try{var r=JSON.parse(localStorage.getItem(REMEMBER_KEY)||"null");if(r&&r.p&&r.exp>Date.now())return r.p;localStorage.removeItem(REMEMBER_KEY);}catch(e){}return "";}\n'
    + '  function remember(p){try{localStorage.setItem(REMEMBER_KEY,JSON.stringify({p:p,exp:Date.now()+REMEMBER_MS}));}catch(e){}}\n'
    + '  function forget(){try{localStorage.removeItem(REMEMBER_KEY);}catch(e){}}\n'
    + '  async function unlock(saved){\n'
    + '    var pass=typeof saved==="string"?saved:document.getElementById("lockpass").value;\n'
    + '    try{\n'
    + '      var km=await crypto.subtle.importKey("raw",new TextEncoder().encode(pass),"PBKDF2",false,["deriveKey"]);\n'
    + '      var key=await crypto.subtle.deriveKey({name:"PBKDF2",salt:b64d(ENC.salt),iterations:ENC.it,hash:"SHA-256"},km,{name:"AES-GCM",length:256},false,["decrypt"]);\n'
    + '      var pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64d(ENC.iv)},key,b64d(ENC.ct));\n'
    + '      var payload=JSON.parse(new TextDecoder().decode(pt));\n'
    + '      DATA=payload.contacts;\n'
    + '      DAILY_TASKS=payload.dailyTasks;\n'
    + '      window.PASSPHRASE=pass;\n'
    + '      if(typeof initializeSavedState === \"function\") await initializeSavedState(pass,DAILY_TASKS.date);\n'  // 「今日のタスク」が朝ブリーフを復号するのに使う。メモリ上だけで保持する
    + '      if(typeof saved!=="string"&&document.getElementById("lockremember").checked)remember(pass);\n'
    + '      document.getElementById("lockgate").style.display="none";\n'
    + '      renderEvents(); setView("today");\n'
    + '      if(typeof refreshEventsFromApi === "function") refreshEventsFromApi();\n'
    + '      if(typeof refreshRegisteredPeople === "function") refreshRegisteredPeople();\n'
    + '    }catch(e){ if(typeof saved==="string"){forget();return;} document.getElementById("lockerr").textContent="パスフレーズが違います"; }\n'
    + '  }\n'
    + '  document.getElementById("lockbtn").addEventListener("click",function(){unlock();});\n'
    + '  document.getElementById("lockpass").addEventListener("keydown",function(e){if(e.key==="Enter")unlock();});\n'
    + '  var remembered=recall(); if(remembered) window.addEventListener("load",function(){unlock(remembered);});\n'
    + '})();\n'
    + '</script>';
}

// ========== 差し込み ==========
function replaceArray(html, name, arr) {
  const re = new RegExp("const " + name + " = \\[[\\s\\S]*?\\];");
  if (!re.test(html)) throw new Error("差し込み失敗: const " + name + " が見つからない");
  const json = JSON.stringify(arr)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return html.replace(re, () => "const " + name + " = " + json + ";");
}

async function fullBuild() {
  const masterPath = ARGS.master || "_assets/list.html";
  const pass = ARGS.pass || "levelup";
  const outPath = ARGS.out || "_deploy/comlist.html";
  // Presentation-only rebuild: retain the existing data in memory, never write plaintext.
  let retained = null;
  if (ARGS["reuse-data"]) {
    const previous = require("./app_sources").readApp(outPath);
    const enc = previous.match(/const ENC = (\{[\s\S]*?\});/);
    const events = previous.match(/const EVENTS = (\[[\s\S]*?\]);/);
    const slots = previous.match(/const FREE_SLOTS = (\[[\s\S]*?\]);/);
    const date = previous.match(/データ更新日: (\d{4})\/(\d+)\/(\d+)/);
    if (!enc || !events || !slots || !date) throw new Error("既存データを読み取れません。通常ビルドを実行してください。");
    const payload = await decryptCheck(JSON.parse(enc[1]), pass);
    if (!payload || !Array.isArray(payload.contacts) || !payload.dailyTasks) {
      throw new Error("既存データに連絡先または日次タスクがありません。通常ビルドを実行してください。");
    }
    retained = {
      contacts: payload.contacts, dailyTasks: payload.dailyTasks,
      events: JSON.parse(events[1]), slots: JSON.parse(slots[1]),
      date: date[1] + "-" + date[2].padStart(2, "0") + "-" + date[3].padStart(2, "0")
    };
    if (ARGS["refresh-contacts"]) {
      const path = require("path");
      const token = fs.readFileSync(require("./garden_paths.js").loadGardenPaths().gardenToken, "utf8").trim();
      if (!token) throw new Error("トークンが無いので中断します");
      const master = require("./app_sources").readApp(masterPath);
      const url = master.match(/const API_URL = "([^"]+)"/);
      if (!url) throw new Error("API_URL が見つかりません");
      const res = await fetch(url[1], { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({token, action:"read", what:"contacts"}), signal:AbortSignal.timeout(45000) });
      const result = await res.json();
      if (!result.ok || !Array.isArray(result.records)) throw new Error("最新の連絡先を取得できませんでした");
      const previousRows = new Map(retained.contacts.map(o => [o._row, o]));
      const changedCount = result.records.filter(o => {
        const old = previousRows.get(o._row);
        return old && [...new Set([...Object.keys(old), ...Object.keys(o)])].some(k => String(old[k] ?? "") !== String(o[k] ?? ""));
      }).length;
      console.log("  公開済みデータと内容が異なる既存行: " + changedCount + "件");
      retained.contacts = result.records;
      retained.date = TODAY;
      console.log("  連絡先をAPIから再取得（平文ファイルは作成しません）");
    }
    console.log("  イベント・空き枠は前回分を維持、連絡先のデータ更新日: " + retained.date);
  }
  const materialPaths = {
    contacts: ARGS.contacts || "_work/contacts.json",
    events: ARGS.events || "_work/app_events.json",
    calendar: ARGS.calendar || "_work/calendar.json",
  };
  const materialFiles = retained ? null : readMaterialFiles(materialPaths);
  const contacts = retained ? retained.contacts : JSON.parse(materialFiles.contacts.text);
  const rawAppEvents = retained ? retained.events : JSON.parse(materialFiles.events.text);
  const appEvents = validateBuildEvents(rawAppEvents, Number(TODAY.slice(0, 4)));
  const calendar = retained ? null : JSON.parse(materialFiles.calendar.text);
  if (!retained) {
    verifySnapshotProof(
      materialPaths.contacts,
      materialPaths.events,
      materialPaths.calendar,
      ARGS["snapshot-proof"],
      materialFiles
    );
  }
  if (!retained && !ARGS.tasks) throw new Error("通常ビルドには --tasks が必要です");
  const dailyTasks = retained ? validateDailyTasks({
    ...retained.dailyTasks,
    tasks: retained.dailyTasks.tasks.filter(task => task.type !== "contact").map(task => {
      if (task.section != null) return task;
      const legacy = { ...task };
      // Legacy numeric priorities were ordering buckets, not high/medium/low.
      if (typeof legacy.priority === "number") legacy.priority = null;
      // A legacy email deadline does not establish whether its owner is self or a member.
      if (legacy.type === "gmail" && legacy.due && legacy.due < retained.dailyTasks.date) legacy.section = "other";
      return legacy;
    })
  }, retained.dailyTasks.date, { reuseData: true }) : validateDailyTasks(
    JSON.parse(fs.readFileSync(ARGS.tasks, "utf8")),
    TODAY,
    { requireSection: true }
  );
  dailyTasks.tasks = dailyTasks.tasks.filter((task) => task.type !== "contact");

  // 全レコードに _row があること。
  // _row はスプシ書き戻しの宛先なので、ズレると他人の行を上書きしてしまう。
  // 素材の作り方（gviz/コネクタ）を変えても事故らないよう、ここで妥当性を検査する。
  if (!Array.isArray(contacts) || contacts.length === 0) throw new Error("連絡先が空");
  const seenRows = new Set();
  let prevRow = 1;
  contacts.forEach((c, i) => {
    const r = c._row;
    if (typeof r !== "number" || !Number.isInteger(r)) throw new Error("_rowが無い/整数でない: index " + i);
    if (r < 2) throw new Error("_rowが2未満(ヘッダー行を指している): index " + i + " _row=" + r);
    if (seenRows.has(r)) throw new Error("_rowが重複: _row=" + r);
    if (r <= prevRow) throw new Error("_rowが昇順でない: index " + i + " _row=" + r + " (前=" + prevRow + ")");
    seenRows.add(r); prevRow = r;
    if (!/^[ABCD]$/.test(c["カテゴリー"] || "")) throw new Error("カテゴリーがA〜Dでない: index " + i + " _row=" + r);
  });

  // 前回ビルドとの件数比較（素材の「黙った欠落」を止める）。
  // _row の昇順・重複検査は、末尾がごっそり切れたケースを検出できない
  // （残った行は昇順・重複なしのまま成立してしまう）。前回の出力を復号して
  // 件数を比べ、大きく減っていたら止める。正当に減った日は --allow-shrink を付ける。
  // 前回ビルドは「件数ガード」と「撃破の算出」の両方で使うので、一度だけ復号する。
  let prevPayload = null;
  if (fs.existsSync(outPath)) {
    try {
      const prevHtml = require("./app_sources").readApp(outPath);
      const m = prevHtml.match(/const ENC = (\{[\s\S]*?\});/);
      if (m) prevPayload = await decryptCheck(JSON.parse(m[1]), pass);
    } catch (e) {
      console.log("  前回比: (前回の出力を読めなかったのでスキップ)");
    }
  }
  if (prevPayload && !ARGS["allow-shrink"]) {
    const prevContacts = Array.isArray(prevPayload) ? prevPayload : prevPayload.contacts;
    if (Array.isArray(prevContacts) && prevContacts.length > 0) {
      const drop = prevContacts.length - contacts.length;
      if (contacts.length < prevContacts.length * 0.9) {
        throw new Error(
          "連絡先が前回より大幅に減っている: 前回 " + prevContacts.length + "件 → 今回 " + contacts.length +
          "件 (-" + drop + "). 素材が途中で切れている可能性が高い。" +
          "正しく減ったのなら --allow-shrink を付けて再実行する。");
      }
      console.log("  前回比: " + prevContacts.length + "件 → " + contacts.length + "件");
    }
  }
  // 撃破＝前回の期限切れのうち、今日は期限切れでなくなったもの。
  // --reuse-data のときは前回の戦果をそのまま引き継ぐ（画面だけ作り直すため）。
  if (!retained) {
    const prevDaily = prevPayload && !Array.isArray(prevPayload) ? prevPayload.dailyTasks : null;
    dailyTasks.resolved = resolveDefeated(prevDaily, dailyTasks);
    if (dailyTasks.resolved.length) console.log("  撃破: " + dailyTasks.resolved.length + "件");
    dailyTasks.victoryLog = appendVictoryLog(prevDaily && prevDaily.victoryLog, dailyTasks.date || TODAY, dailyTasks.resolved.length);
  }

  if (!retained) {
    dailyTasks.analysisLog = require('./analysis_history').appendAnalysisLog(prevPayload && prevPayload.dailyTasks && prevPayload.dailyTasks.analysisLog, dailyTasks, contacts);
  }
  const freeSlots = retained ? retained.slots : computeSlots(calendar, TODAY, NOWHM);
  const payload = { contacts, dailyTasks };
  const { ENC } = await encryptPayload(payload, pass);

  let html = require("./app_sources").readApp(masterPath);
  const before = html;
  // (a) robots noindex
  html = html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n  <meta name="robots" content="noindex,nofollow">');
  if (html === before) throw new Error("差し込み失敗: <meta charset> が見つからない");
  // (b) EVENTS / (b2) FREE_SLOTS
  html = replaceArray(html, "EVENTS", appEvents);
  html = replaceArray(html, "FREE_SLOTS", freeSlots);
  // (c) data.js → ゲート
  if (html.indexOf('<script src="data.js"></script>') === -1) throw new Error("差し込み失敗: data.js の script タグが無い");
  html = html.replace('<script src="data.js"></script>', gateHtml(ENC, retained ? retained.date : TODAY));
  // (d) 末尾の自動描画を削除（ゲート解除前に描画させない）
  const trailRe = /renderEvents\(\);\s*\nsetView\("today"\);/;
  if (!trailRe.test(html)) throw new Error("差し込み失敗: 末尾の renderEvents();/setView(today) が見つからない");
  html = html.replace(trailRe, "/* 描画は復号後に行う */");

  // ---- 検証 ----
  const errs = [];
  // 構造
  if (html.indexOf('id="lockgate"') === -1) errs.push("lockgate が無い");
  if (html.indexOf('<script src="data.js"></script>') !== -1) errs.push("data.js の参照が残っている");
  if (!/const FREE_SLOTS = \[/.test(html)) errs.push("FREE_SLOTS が無い");
  if (!/const EVENTS = \[/.test(html)) errs.push("EVENTS が無い");
  for (const assetUrl of ["brief-icons-v2.png", "brief-hero-morning-v2.jpg", "victory-icons-v1.png", "victory-banner-v1.jpg"]) {
    if (!fs.existsSync(require("path").join(require("path").dirname(masterPath),assetUrl))) errs.push("画像が無い: " + assetUrl);
  }
  if (!html.includes('setView("today")')) errs.push("復号後のToday初期表示が無い");
  // 復号ラウンドトリップ（暗号文が本当に levelup で戻るか）
  const round = await decryptCheck(ENC, pass);
  if (JSON.stringify(round) !== JSON.stringify(payload)) errs.push("復号ラウンドトリップ不一致");
  // 平文リーク：連絡先の名前が平文で出ていないこと
  // ※1〜2文字の名前（やす/ごう等）はUIの通常テキストと偶発一致するため対象外。
  //   暗号化が壊れれば3文字以上の名前が多数漏れるので検出力は落ちない。
  const leaked = contacts
    .map((c) => c["名前(あだ名)"])
    .filter((n) => n && n !== "(名前なし)" && n.length >= 3 && html.indexOf(n) !== -1);
  if (leaked.length) errs.push("平文の名前が混入: " + leaked.slice(0, 3).join(", "));
  const leakedTaskTitles = dailyTasks.tasks.concat(dailyTasks.resolved || [])
    .map((task) => task.title)
    .filter((title) => title && title.length >= 3 && html.indexOf(title) !== -1);
  if (leakedTaskTitles.length) errs.push("平文のタスク名が混入: " + leakedTaskTitles.slice(0, 3).join(", "));
  const leakedTaskUrls = dailyTasks.tasks
    .map((task) => task.url)
    .filter((url) => url && html.indexOf(url) !== -1);
  if (leakedTaskUrls.length) errs.push("平文のタスクURLが混入: " + leakedTaskUrls.slice(0, 3).join(", "));
  // 書き込みトークンらしき文字列が無いこと（API_URL は可）
  if (/API_TOKEN\s*[:=]/.test(html)) errs.push("API_TOKEN らしき文字列が混入");
  if (errs.length) { console.error("検証NG:\n - " + errs.join("\n - ")); process.exit(1); }

  require("./artifact_bundle").writeBundle(outPath,html,require("path").dirname(masterPath));
  // ルートURL(.../teambuilding/)は開かせない方針。転送用 index.html は作らない
  // （デプロイ側でリポジトリの index.html を削除する）。

  // サマリ
  const cats = {};
  contacts.forEach((c) => { const k = c["カテゴリー"] || "?"; cats[k] = (cats[k] || 0) + 1; });
  console.log("OK build → " + outPath);
  console.log("  連絡先: " + contacts.length + "件 (" + Object.keys(cats).sort().map((k) => k + ":" + cats[k]).join(" ") + ")");
  console.log("  イベント: " + appEvents.length + "件 / 空き枠: " + freeSlots.length + "件 (today=" + TODAY + " now=" + NOWHM + ")");
  console.log("  検証: ラウンドトリップOK・平文リークなし");
}

async function main() {
  if (ARGS["slots-only"]) {
    const calendar = JSON.parse(fs.readFileSync(ARGS.calendar || "_work/calendar.json", "utf8"));
    const slots = computeSlots(calendar, TODAY, NOWHM);
    console.error("slots=" + slots.length + " (today=" + TODAY + " now=" + NOWHM + ")");
    process.stdout.write(JSON.stringify(slots));
    return;
  }
  await fullBuild();
}
if (require.main === module) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}

module.exports = { materialManifestPath, readMaterialFiles, replaceArray, resolveMaterialSelection, verifySnapshotProof, writeAtomic, validateBuildEvents, gateHtmlForTest: gateHtml, encryptForTest: async (p, pass) => (await encryptPayload(p, pass)).ENC };
