/**
 * 人脈リスト 読み書きAPI（Google Apps Script / ウェブアプリ）
 *
 * アプリ(list.html)がこのURLを叩いて、
 *   - GET  … スプレッドシートのA〜Dを読み取ってJSONで返す
 *   - POST … 指定行の「アクション日 / アクション内容 / 次会う日 / 次会う日にする事」だけを更新する
 *
 * セットアップ（詳細は「アプリ更新セットアップ.md」参照）:
 *   1. script.google.com で新規プロジェクトを作り、このファイルの中身を貼り付ける
 *   2. プロジェクトの設定 > スクリプト プロパティ に API_TOKEN を追加（好きな合言葉）
 *   3. デプロイ > 新しいデプロイ > 種類「ウェブアプリ」
 *        次のユーザーとして実行: 自分
 *        アクセスできるユーザー: 全員
 *      → 発行された /exec URL を list.html の API_URL に貼る
 */

var CONFIG = {
  SPREADSHEET_ID: '1vjDb8_5WTfVffwW2iJGLnL_squUAGLRxhAfY_oveHYw',
  SHEET_NAME: 'リスト',
  CATEGORIES: ['A', 'B', 'C', 'D']
};

// シートの列順（左から）。アプリのキー名と同じ。
var COLUMNS = [
  'カテゴリー', 'ステータス', '名前(あだ名)', 'アクション日', 'アクション内容',
  '次会う日', '次会う日にする事', '履歴', '性別', 'LINE/Insta名', 'Insta URL',
  '出会った日', '出会った時の年齢', '現在の年齢', '誕生日', '出会い(どこで)', '出会い(誰と)',
  '最寄駅', '一人暮らしor実家', '土日休みorシフト', '出身地・家族(F)', '仕事(O)',
  '趣味・部活(R)', 'お金の価値観(M)', '目標(D)', 'メモ'
];

// アプリから更新を許可する項目 → 列番号(1始まり)。ここに無い項目は絶対に書き換えない。
// アプリ側の EDITABLE_FIELDS と必ず揃えること。
// ※ カテゴリー/ステータス/名前/性別は運用の根幹なのでアプリからは触らせない。
//   現在の年齢(N列)は自動計算なので除外。履歴(H列)は下の自動追記でのみ書き込む。
var EDITABLE = {
  'アクション日': 4,        // D列
  'アクション内容': 5,      // E列
  '次会う日': 6,            // F列
  '次会う日にする事': 7,    // G列
  // ここから下は「土の栄養」＝プロフィールの空欄を埋めるための項目
  '出会った日': 12,         // L列
  '出会った時の年齢': 13,   // M列
  '誕生日': 15,             // O列
  '出会い(どこで)': 16,     // P列
  '出会い(誰と)': 17,       // Q列
  '最寄駅': 18,             // R列
  '一人暮らしor実家': 19,   // S列
  '土日休みorシフト': 20,   // T列
  '出身地・家族(F)': 21,    // U列
  '仕事(O)': 22,            // V列
  '趣味・部活(R)': 23,      // W列
  'お金の価値観(M)': 24,    // X列
  '目標(D)': 25             // Y列
};

var NAME_COL = 3;    // C列 = 名前(あだ名)
var HISTORY_COL = 8; // H列 = 履歴（次会う日を更新したとき、旧予定をここに自動追記する）
var CONTACT_CYCLE = { A: 14, B: 30, C: 90, D: 120 };
var MATERIAL_SNAPSHOT_VERSION = 2;
var MATERIAL_SNAPSHOT_CACHE_KEY = 'garden-material-snapshot-v2';
var MATERIAL_SNAPSHOT_CACHE_SECONDS = 21600;
var MATERIAL_SNAPSHOT_MAX_AGE_MS = 3 * 60 * 60 * 1000;
var MATERIAL_SNAPSHOT_DAYS = 32; // 今日 + 31日先まで（終了日は含めない）

// 履歴に追記するときの区切り文字。詰まって見えるなら ' / ' などに変更する。
var HISTORY_SEP = ' ';

// Existing A:AC columns remain intact. AD:AF are explicitly set up by the owner.
var CONTACT_TRACKING_START_COLUMN = 30;
var CONTACT_TRACKING_COLUMN_COUNT = 3;
var CONTACT_TRACKING_REQUEST_COLUMN = CONTACT_TRACKING_START_COLUMN + CONTACT_TRACKING_COLUMN_COUNT - 1;
var CONTACT_TRACKING_RANGE = 'AD:AF';
var CONTACT_TRACKING_HEADERS = ['連絡記録状態', '連絡記録日', '連絡記録リクエスト'];
function contactTrackingReady_(sh) {
  if(sh.getMaxColumns&&sh.getMaxColumns()<CONTACT_TRACKING_REQUEST_COLUMN)return false;
  var headers=sh.getRange(1,CONTACT_TRACKING_START_COLUMN,1,CONTACT_TRACKING_COLUMN_COUNT).getValues()[0];
  return CONTACT_TRACKING_HEADERS.every(function(h,i){return cellText_(headers[i])===h;});
}
function setupContactTrackingSheet() {
  return withMaterialLock_(function(){
    var sh=getSheet_();if(sh.getMaxColumns&&sh.getMaxColumns()<CONTACT_TRACKING_REQUEST_COLUMN)sh.insertColumnsAfter(sh.getMaxColumns(),CONTACT_TRACKING_REQUEST_COLUMN-sh.getMaxColumns());
    var headerRange=sh.getRange(1,CONTACT_TRACKING_START_COLUMN,1,CONTACT_TRACKING_COLUMN_COUNT),headers=headerRange.getValues()[0];
    if(headerRange.getFormulas&&headerRange.getFormulas()[0].some(function(v){return v!=='';}))throw Error(CONTACT_TRACKING_RANGE+'の見出しに既存の数式があります。設定を中止しました。');
    if(headers.some(function(v,i){return cellText_(v)&&cellText_(v)!==CONTACT_TRACKING_HEADERS[i];}))throw Error('AD:AFには既存データがあります。列を確認してください。');
    if(!contactTrackingReady_(sh)){
      var n=sh.getLastRow()-1;
      var dataRange=n>0?sh.getRange(2,CONTACT_TRACKING_START_COLUMN,n,CONTACT_TRACKING_COLUMN_COUNT):null;
      if(dataRange&&dataRange.getFormulas&&dataRange.getFormulas().some(function(r){return r.some(function(v){return v!=='';});}))throw Error(CONTACT_TRACKING_RANGE+'には既存の数式があります。設定を中止しました。');
      if(n>0&&dataRange.getValues().some(function(r){return r.some(function(v){return cellText_(v)!=='';});}))throw Error('AD:AFには既存データがあります。設定を中止しました。');
      sh.getRange(1,CONTACT_TRACKING_START_COLUMN,1,CONTACT_TRACKING_COLUMN_COUNT).setValues([CONTACT_TRACKING_HEADERS]);SpreadsheetApp.flush();
    }
    return {ok:true,columns:CONTACT_TRACKING_RANGE};
  });
}
function contactVersion_(sh,row) {
  return contactVersionFromCells_(sh.getRange(row,1,1,COLUMNS.length).getValues()[0],contactTrackingReady_(sh)?sh.getRange(row,CONTACT_TRACKING_START_COLUMN,1,CONTACT_TRACKING_COLUMN_COUNT).getValues()[0]:null);
}
function contactVersionFromCells_(row,meta) {
  var cells=row.map(cellText_);
  cells[13]=''; // Formula-derived current age does not represent a manual edit.
  if(meta)cells=cells.concat(meta.map(cellText_));
  // Exact content version: also detects direct sheet edits without a trigger or counter column.
  return 'contact-v1:'+JSON.stringify(cells);
}
function checkContactVersion_(sh,row,body){
  if(typeof body.version!=='string'||!body.version)return {ok:false,error:'version required',message:'最新データを再取得してください。'};
  if(body.version!==contactVersion_(sh,row))return {ok:false,error:'conflict',message:'ほかの端末またはシートで更新されています。入力を控えて最新データを再取得してください。'};
  return null;
}
function contactState_(sh,row){
  if(!contactTrackingReady_(sh))return null;
  var v=sh.getRange(row,CONTACT_TRACKING_START_COLUMN,1,CONTACT_TRACKING_COLUMN_COUNT).getValues()[0].map(cellText_);
  return /^(contacted|waiting|planning)$/.test(v[0])?{status:v[0],date:v[1]}:null;
}
function readContactRecord_(sh,row){
  var cells=sh.getRange(row,1,1,COLUMNS.length).getValues()[0],meta=contactTrackingReady_(sh)?sh.getRange(row,CONTACT_TRACKING_START_COLUMN,1,CONTACT_TRACKING_COLUMN_COUNT).getValues()[0]:null;
  var record={_row:row,_version:contactVersionFromCells_(cells,meta)};
  COLUMNS.forEach(function(k,i){var v=cellText_(cells[i]);if(v)record[k]=v;});
  if(meta&&/^(contacted|waiting|planning)$/.test(cellText_(meta[0])))record._contactState={status:cellText_(meta[0]),date:cellText_(meta[1])};
  return record;
}
function contactActionRecord_(body,row){
  var sh=getSheet_();
  if(!contactTrackingReady_(sh))return {ok:false,error:'tracking not ready',message:'GAS所有者による連絡記録列（AD:AF）の設定が必要です。'};
  if(!/^(contacted|waiting|planning)$/.test(body.status)||!eventDateIsValid_(body.date)||!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId))return {ok:false,error:'invalid input'};
  var name=String(body.name||'').trim();if(!name)return {ok:false,error:'invalid input'};
  if(cellText_(sh.getRange(row,NAME_COL).getValue())!==name){var matches=findRowsByName_(sh,name);if(matches.length!==1)return {ok:false,error:matches.length?'ambiguous name':'name not found'};row=matches[0];}
  var receiptText=cellText_(sh.getRange(row,CONTACT_TRACKING_REQUEST_COLUMN).getValue()),receipt;
  try{receipt=JSON.parse(receiptText);}catch(e){receipt=null;}
  // The durable last receipt survives a lost response; do not replay any changes.
  if(receipt&&receipt.id===body.requestId){
    if(receipt.status!==body.status||receipt.date!==body.date)return {ok:false,error:'request mismatch'};
    var current=readContactRecord_(sh,row);
    return {ok:true,row:row,version:current._version,updated:{},contactState:current._contactState,record:current,replayed:true};
  }
  var conflict=checkContactVersion_(sh,row,body);if(conflict)return conflict;
  var updated={},cat=cellText_(sh.getRange(row,1).getValue());if(CONFIG.CATEGORIES.indexOf(cat)<0)return {ok:false,error:'invalid category'};
  if(body.status==='contacted'){
    var d=new Date(body.date+'T00:00:00Z'),entry=d.getUTCFullYear()+'/'+(d.getUTCMonth()+1)+'/'+d.getUTCDate()+' 連絡';
    var history=cellText_(sh.getRange(row,HISTORY_COL).getValue());updated['履歴']=history?history+HISTORY_SEP+entry:entry;setCell_(sh,row,HISTORY_COL,updated['履歴']);
    var old=normDate_(sh.getRange(row,EDITABLE['アクション日']).getValue());
    var parts=old.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/),oldIso=parts?parts[1]+'-'+('0'+parts[2]).slice(-2)+'-'+('0'+parts[3]).slice(-2):null;
    if(!old||(oldIso&&oldIso<=body.date)){d.setUTCDate(d.getUTCDate()+CONTACT_CYCLE[cat]);updated['アクション日']=d.getUTCFullYear()+'/'+(d.getUTCMonth()+1)+'/'+d.getUTCDate();setCell_(sh,row,EDITABLE['アクション日'],updated['アクション日']);}
  }
  sh.getRange(row,CONTACT_TRACKING_START_COLUMN,1,CONTACT_TRACKING_COLUMN_COUNT).setValues([[body.status,body.date,JSON.stringify({id:body.requestId,status:body.status,date:body.date})]]);SpreadsheetApp.flush();
  return {ok:true,row:row,version:contactVersion_(sh,row),updated:updated,contactState:contactState_(sh,row)};
}

// ---------- 共通 ----------

function getToken_() {
  return PropertiesService.getScriptProperties().getProperty('API_TOKEN');
}

function getSheet_() {
  var sh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) throw new Error('シート「' + CONFIG.SHEET_NAME + '」が見つかりません');
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function cellText_(v) {
  if (v == null) return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  return String(v).trim();
}

/**
 * 日付の表記ゆれを吸収して比較用の正準形 'YYYY/M/D' に正規化する。
 * Date型 /「2026/08/05」/「2026-08-05」/「8/5」(年省略→今年) を同じ形にそろえる。
 * 日付として解釈できない文字列はそのまま返す（従来どおり文字列一致で比較）。
 */
function normDate_(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.getFullYear() + '/' + (v.getMonth() + 1) + '/' + v.getDate();
  var s = String(v).trim();
  if (!s) return '';
  var m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/); // 年あり
  if (m) return (+m[1]) + '/' + (+m[2]) + '/' + (+m[3]);
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);                   // 年省略 → 今年
  if (m) return (new Date().getFullYear()) + '/' + (+m[1]) + '/' + (+m[2]);
  return s;
}

/**
 * セルに値を書く。入力規則（入力を拒否）が付いていると setValue が弾かれるので、
 * 一時的に規則を外して書き込み、元に戻す。
 */
function setCell_(sh, row, col, val) {
  var cell = sh.getRange(row, col);
  var dv = null;
  try { dv = cell.getDataValidation(); } catch (ignore) {}
  if (dv) cell.clearDataValidations();
  cell.setValue(val == null ? '' : String(val));
  if (dv) { try { cell.setDataValidation(dv); } catch (ignore) {} }
}

// ---------- 読み取り ----------

function doGet(e) {
  try {
    var token = (e && e.parameter && e.parameter.token) || '';
    if (token !== getToken_()) return json_({ ok: false, error: 'unauthorized' });
    var records = readContacts_();
    return json_({ ok: true, records: records, count: records.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// ---------- 今日のタスクの完了チェック（端末間の共有） ----------
// 画面のチェック状態を日付ごとにスクリプトプロパティへ置く。保存するのはタスクIDと完了フラグだけで、
// タスク名や本文は受け取らない。14日より古い日付は保存のたびに消す。
var TASK_STATE_PREFIX = 'TASK_STATE_';
var TASK_STATE_KEEP_DAYS = 14;
var TASK_STATE_MAX_IDS = 300;

function taskState_(body) {
  var date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'invalid date' };
  var props = PropertiesService.getScriptProperties();
  var key = TASK_STATE_PREFIX + date;
  if (body.op === 'get') return { ok: true, date: date, done: readTaskState_(props, key) };
  if (body.op !== 'set') return { ok: false, error: 'unknown op' };

  var id = String(body.id || '');
  if (!id || id.length > 200) return { ok: false, error: 'invalid id' };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (lockErr) { return { ok: false, error: 'busy' }; }
  try {
    var done = readTaskState_(props, key);
    if (body.done === true) done[id] = true; else delete done[id];
    if (Object.keys(done).length > TASK_STATE_MAX_IDS) return { ok: false, error: 'too many ids' };
    props.setProperty(key, JSON.stringify(done));
    pruneTaskState_(props, date);
    return { ok: true, date: date, done: done };
  } finally {
    lock.releaseLock();
  }
}

function readTaskState_(props, key) {
  try {
    var parsed = JSON.parse(props.getProperty(key) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

function pruneTaskState_(props, today) {
  var limit = new Date(today + 'T00:00:00Z');
  limit.setUTCDate(limit.getUTCDate() - TASK_STATE_KEEP_DAYS);
  var min = Utilities.formatDate(limit, 'UTC', 'yyyy-MM-dd');
  Object.keys(props.getProperties()).forEach(function (k) {
    if (k.indexOf(TASK_STATE_PREFIX) === 0 && k.slice(TASK_STATE_PREFIX.length) < min) props.deleteProperty(k);
  });
}

// ---------- 更新 ----------

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (!getToken_() || (body.token || '') !== getToken_()) return json_({ ok: false, error: 'unauthorized' });

    if (body.action === 'fieldGoalsRead') return json_(withMaterialLock_(fieldGoalsRead_));
    if (body.action === 'fieldGoalsWrite') return json_(withMaterialLock_(function(){return fieldGoalsWrite_(body);}));

    // 読み取り要求。既存の書き戻しは action を送らないので互換は保たれる。
    if (body.action === 'read') {
      if (body.what === 'snapshot') {
        var snapshot = readMaterialSnapshot_();
        return json_({ ok: true, snapshot: snapshot });
      }
      if (body.what === 'contacts') {
        var recs = readContacts_();
        return json_({ ok: true, records: recs, count: recs.length });
      }
      if (body.what === 'events') {
        var evRows = readEventRows_();
        return json_({ ok: true, rows: evRows, count: evRows.length });
      }
      if (body.what === 'structuredEvents') {
        var structuredEvents = readStructuredEvents_();
        return json_({ ok: true, events: structuredEvents });
      }
      return json_({ ok: false, error: 'unknown what' });
    }

    if (body.action === 'taskState') {
      return json_(taskState_(body));
    }

    if (body.action === 'eventCreate') {
      return json_(withEventLock_(function () { return createEvent_(body); }));
    }
    if (body.action === 'eventUpdate') {
      return json_(withEventLock_(function () { return updateEvent_(body); }));
    }
    if (body.action === 'eventStatus') {
      return json_(withEventLock_(function () { return setEventStatus_(body); }));
    }
    if (body.action === 'eventDelete') {
      return json_(withEventLock_(function () { return deleteEvent_(body); }));
    }

    var row = parseInt(body.row, 10);
    if (body.action !== 'create' && body.action !== 'bulk' && (!row || row < 2)) return json_({ ok: false, error: 'invalid row' });

    // 書き込みは1件ずつ順番に処理する。
    // 保存ボタンを連打すると同じ内容のリクエストが同時に届き、どちらも「変更前の次会う日」を
    // 読んでしまうため、履歴に同じ予定が二重に追記されていた。ロックで直列化して防ぐ。
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(20000);
    } catch (lockErr) {
      return json_({
        ok: false, error: 'busy',
        message: 'ほかの保存を処理中です。少し待ってからもう一度お試しください。'
      });
    }
    try {
      if (body.action === 'create') return createRecord_(body);
      if (body.action === 'bulk') return json_(bulkWrite_(body));
      if (body.action === 'contacted') return json_(contactedRecord_(body, row));
      if (body.action === 'contactAction') return json_(contactActionRecord_(body, row));
      return json_(writeRecord_(body, row));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** 連絡完了を履歴と次回アクション日に原子的に反映する。 */
function contactedRecord_(body, row) {
  var requestId = String(body.requestId || '');
  var category = String(body.category || '');
  var dateText = String(body.date || '');
  var match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId) || CONFIG.CATEGORIES.indexOf(category) < 0 || !match) {
    return { ok: false, error: 'invalid input' };
  }
  var year = +match[1], month = +match[2], day = +match[3];
  var checked = new Date(Date.UTC(year, month - 1, day));
  if (checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day) {
    return { ok: false, error: 'invalid input' };
  }

  var sh = getSheet_();
  var expect = String(body.name || '').trim();
  var actual = cellText_(sh.getRange(row, NAME_COL).getValue());
  if (!expect) return { ok: false, error: 'invalid input' };
  if (actual !== expect) {
    var found = findRowsByName_(sh, expect);
    if (found.length === 1) {
      row = found[0];
      actual = expect;
    } else if (!found.length) {
      return { ok: false, error: 'name not found' };
    } else {
      return { ok: false, error: 'ambiguous name' };
    }
  }

  var entry = month + '/' + day + ' 連絡';
  var conflict=checkContactVersion_(sh,row,body);if(conflict)return conflict;
  var history = cellText_(sh.getRange(row, HISTORY_COL).getValue());
  var escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var completeEntry = new RegExp('(?:^| )' + escaped + '(?=$| \\d{1,2}/\\d{1,2} )');
  if (!completeEntry.test(history)) {
    history = history ? history + HISTORY_SEP + entry : entry;
    setCell_(sh, row, HISTORY_COL, history);
  }

  var next = new Date(checked.getTime());
  next.setUTCDate(next.getUTCDate() + CONTACT_CYCLE[category]);
  var actionDate = (next.getUTCMonth() + 1) + '/' + next.getUTCDate();
  setCell_(sh, row, EDITABLE['アクション日'], actionDate);
  return { ok: true, row: row, name: actual, version:contactVersion_(sh,row), updated: { '履歴': history, 'アクション日': actionDate } };
}

/** 1件分の書き戻し。doPost からロックの内側で呼ばれる。 */
function createRecord_(body) {
  var values = body.values || {};
  var name = String(values['名前(あだ名)'] || '').trim();
  var cat = String(values['カテゴリー'] || '');
  var id = String(body.requestId || '');
  if (!name || name.length > 100 || CONFIG.CATEGORIES.indexOf(cat) < 0 || !/^[a-zA-Z0-9-]{16,80}$/.test(id)) {
    return json_({ok:false, error:'invalid input', message:'名前とカテゴリを確認してください。'});
  }
  var sh = getSheet_();
  // A sheet note survives a lost response and makes retries idempotent.
  var names = sh.getLastRow() > 1 ? sh.getRange(2, NAME_COL, sh.getLastRow()-1, 1).getNotes() : [];
  for (var n = 0; n < names.length; n++) {
    if (names[n][0] === 'garden-create:' + id) {
      var saved = sh.getRange(n+2, 1, 1, COLUMNS.length).getValues()[0];
      var record = {_row:n+2,_version:contactVersion_(sh,n+2)};
      COLUMNS.forEach(function(k,i){ if(cellText_(saved[i])) record[k]=cellText_(saved[i]); });
      return json_({ok:true, record:record, replayed:true});
    }
  }
  if (findRowsByName_(sh, name).length) return json_({ok:false, error:'duplicate', message:'同じ名前が登録されています。別の人の場合は、区別できる名前にしてください。'});
  var allowed = ['カテゴリー','名前(あだ名)','メモ'].concat(Object.keys(EDITABLE));
  var rowValues = COLUMNS.map(function(k){
    var v = allowed.indexOf(k) >= 0 ? String(values[k] == null ? '' : values[k]).trim() : '';
    if (v.length > 2000) throw new Error('入力は1項目2000文字以内にしてください');
    // Never interpret user input as a spreadsheet formula.
    return /^[=+@-]/.test(v) ? "'" + v : v;
  });
  var row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
  sh.getRange(row, 1, 1, COLUMNS.length).setValues([rowValues]);
  sh.getRange(row, NAME_COL).setNote('garden-create:' + id);
  SpreadsheetApp.flush();
  var out = {_row:row,_version:contactVersion_(sh,row)};
  sh.getRange(row,1,1,COLUMNS.length).getValues()[0].forEach(function(v,i){ if(cellText_(v)) out[COLUMNS[i]]=cellText_(v); });
  return json_({ok:true, record:out});
}

function writeRecord_(body, row) {
    var sh = getSheet_();

    // 行ズレの解決。
    // _row はアプリのビルド時点（毎朝）のスナップショットなので、その後シート側で
    // 行を挿入・削除すると宛先がずれる。アプリを再読み込みしても直らない（翌朝まで同じ値）。
    // そこで、名前で一意に特定できるときは自動で正しい行に付け替える。
    // 一意に決まらないとき（同名が複数 / 見つからない）は、書かずに止める。
    var expect = String(body.name || '').trim();
    if (expect) {
      var actual = cellText_(sh.getRange(row, NAME_COL).getValue());
      if (actual !== expect) {
        var found = findRowsByName_(sh, expect);
        if (found.length === 1) {
          row = found[0];    // 自動修復。以降の書き込みはすべてこの行に対して行う
          actual = expect;   // 応答の name も修復後の行のものに合わせる
        } else if (found.length === 0) {
          return ({
            ok: false, error: 'name not found',
            message: '「' + expect + '」がシートに見つかりません。名前が変わったか、行が削除された可能性があります。'
          });
        } else {
          return ({
            ok: false, error: 'ambiguous name',
            message: '「' + expect + '」が' + found.length + '行あるため、どこに保存するか決められません（行 '
                     + found.join(', ') + '）。シート側で名前を区別してください。'
          });
        }
      }
    }

    var conflict=checkContactVersion_(sh,row,body);if(conflict)return conflict;
    var values = body.values || {};
    var updated = {};

    // --- 次会う日の予定を履歴へ自動追記 ---
    // 「次会う日（日付）」が変わったときだけ、変更前の予定を「7/22 夢マップ」の形で履歴の末尾に足す。
    // 会い終わって次の予定に進んだ＝past の予定として記録する、という意味なので、
    // 「する事」だけを直した場合（予定の書き間違いの修正など）は追記しない。
    // 変更前の日付が空のとき（初めて予定を入れるとき）も、記録すべき過去の予定が無いので追記しない。
    if (('次会う日' in values) || ('次会う日にする事' in values)) {
      var oldRaw = sh.getRange(row, EDITABLE['次会う日']).getValue(); // Date型のこともある
      var oldDate = cellText_(oldRaw); // 履歴に書くための表示用
      var oldWhat = cellText_(sh.getRange(row, EDITABLE['次会う日にする事']).getValue());
      var newDate = ('次会う日' in values) ? String(values['次会う日'] || '').trim() : oldDate;

      // 表記ゆれ（Date型 vs "8/5" vs "2026/08/05"）で誤検知しないよう正規化してから比較する。
      // 次会う日が実質同じなら履歴に追記しない。
      var dateChanged = (normDate_(newDate) !== normDate_(oldRaw));
      if (dateChanged && normDate_(oldRaw)) {
        var entry = [oldDate, oldWhat].filter(function (s) { return s; }).join(' ');
        var hist = cellText_(sh.getRange(row, HISTORY_COL).getValue());
        // 二重登録の防止（ロックをすり抜けた再送・リトライへの保険）。
        // 同じ内容が履歴の末尾に既にあるなら足さない。
        var already = entry && hist && hist.slice(-entry.length) === entry;
        if (!already) {
          var merged = hist ? (hist + HISTORY_SEP + entry) : entry;
          setCell_(sh, row, HISTORY_COL, merged);
          updated['履歴'] = merged;
        }
      }
    }

    // --- 許可された4項目のみ更新 ---
    Object.keys(EDITABLE).forEach(function (key) {
      if (!(key in values)) return;
      var val = values[key] == null ? '' : String(values[key]);
      setCell_(sh, row, EDITABLE[key], val);
      updated[key] = val;
    });

    SpreadsheetApp.flush();
    return ({ ok: true, row: row, name: actual, version:contactVersion_(sh,row), updated: updated });
}

/**
 * 複数人分の書き戻しを1リクエストで処理する。doPost からロックの内側で呼ばれる。
 * 1人1リクエストにするとロックの取り合いになり、後続が busy で落ちるため、まとめて受ける。
 */
var BULK_MAX = 50; // GAS の実行時間制限に対する余裕。まとめて選べる人数の上限。

function bulkWrite_(body) {
  var items = body.items;
  if (!Array.isArray(items) || !items.length) {
    return { ok: false, error: 'empty batch', message: '更新する人が選ばれていません。' };
  }
  if (items.length > BULK_MAX) {
    return {
      ok: false, error: 'batch too large',
      message: '一度に更新できるのは' + BULK_MAX + '人までです（' + items.length + '人が選ばれています）。'
    };
  }
  var results = items.map(function (it) {
    var row = parseInt(it && it.row, 10);
    if (!row || row < 2) return { ok: false, error: 'invalid row', message: '行が特定できませんでした。' };
    return writeRecord_(it, row);
  });
  return { ok: true, results: results };
}

// ---------- 読み取り（アプリ以外のクライアント用） ----------

var EVENTS_SHEET_GID = 2140110738;
var EVENTS_MANAGED_SHEET_NAME = 'イベント管理';
var EVENT_HEADERS = ['イベントID', '状態', '開催日', '開始時刻', '終了時刻', 'タイトル', 'テーマ', '場所', '案内URL', '集計シートURL', '更新日時', '更新番号'];
var EVENT_REQUEST_ID_COLUMN = EVENT_HEADERS.length + 1;
var EVENT_REQUEST_ID_HEADER = '内部requestId（手動編集禁止）';
var EVENT_REQUEST_ID_PROTECTION_DESCRIPTION = 'イベント管理M列（内部requestId・手動編集禁止）';
var EVENT_ID_RE = /^evt_[A-Za-z0-9_-]{16,76}$/;
var EVENT_REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,80}$/;
var EVENT_REQUEST_CACHE_PREFIX = 'event-request-';
var EVENT_REQUEST_PROPERTY_PREFIX = 'EVENT_REQUEST_';
var EVENT_REQUEST_CACHE_SECONDS = 21600;
var EVENT_REQUEST_PROPERTY_MAX = 200;
var EVENT_MIGRATION_PROPERTY_PREFIX = 'EVENT_MIGRATION_';
var EVENT_MIGRATION_ISSUED_PROPERTY_PREFIX = 'EVENT_MIGRATION_ISSUED_';
var EVENT_MIGRATION_PENDING_PROPERTY_PREFIX = 'EVENT_MIGRATION_PENDING_';
var EVENT_MIGRATION_STATE_PROPERTY = 'EVENT_MIGRATION_STATE';
var EVENT_MIGRATION_PROPERTY_VALUE_MAX_BYTES = 9 * 1024;
var EVENT_MIGRATION_ERROR_MAX_CHARS = 512;
var EVENT_SYSTEM_COLUMN_START = 11;
var EVENT_SYSTEM_COLUMN_COUNT = 2;
var EVENT_SYSTEM_PROTECTION_DESCRIPTION = 'イベント管理K:L列（システム管理・手動編集禁止）';
var EVENT_TIMEZONE = 'Asia/Tokyo';
var EVENT_MAX_THEME_LENGTH = 120;
var EVENT_MAX_PLACE_LENGTH = 200;
var EVENT_MAX_URL_LENGTH = 500;

function getSheetByGid_(gid) {
  var sheets = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === gid) return sheets[i];
  }
  throw new Error('gid ' + gid + ' のシートが見つかりません');
}

// A〜Dのレコード配列を返す。_row は実際のシート行番号。
function readContacts_() {
  var sh = getSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, COLUMNS.length).getValues();
  var tracking=contactTrackingReady_(sh),meta=tracking?sh.getRange(2,CONTACT_TRACKING_START_COLUMN,last-1,CONTACT_TRACKING_COLUMN_COUNT).getValues():[];
  var records = [];
  values.forEach(function (row, i) {
    var cat = cellText_(row[0]);
    if (CONFIG.CATEGORIES.indexOf(cat) === -1) return;
    var o = { _row: i + 2, _version:contactVersionFromCells_(row,tracking?meta[i]:null) };
    if(tracking&&/^(contacted|waiting|planning)$/.test(cellText_(meta[i][0])))o._contactState={status:cellText_(meta[i][0]),date:cellText_(meta[i][1])};
    for (var c = 0; c < COLUMNS.length; c++) {
      var v = cellText_(row[c]);
      if (v) o[COLUMNS[c]] = v;
    }
    if (!o['名前(あだ名)']) o['名前(あだ名)'] = '(名前なし)';
    records.push(o);
  });
  return records;
}

/**
 * 名前(あだ名)が一致する行番号をすべて返す（A〜Dの行のみ）。
 * 行ズレの自動修復に使う。見つからない/複数あるときは呼び出し側で止める。
 */
function findRowsByName_(sh, name) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, NAME_COL).getValues();
  var hits = [];
  for (var i = 0; i < values.length; i++) {
    if (CONFIG.CATEGORIES.indexOf(cellText_(values[i][0])) === -1) continue;
    if (cellText_(values[i][NAME_COL - 1]) === name) hits.push(i + 2);
  }
  return hits;
}

// イベントシートのA〜C列を生のまま返す。解析はローカル側の責務。
function readEventRows_() {
  var sh = getSheetByGid_(EVENTS_SHEET_GID);
  var last = sh.getLastRow();
  if (last < 1) return [];
  return sh.getRange(1, 1, last, 3).getValues().map(function (r) {
    return [cellText_(r[0]), cellText_(r[1]), cellText_(r[2])];
  });
}

function getEventsManagedSheet_() {
  var sh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(EVENTS_MANAGED_SHEET_NAME);
  if (!sh) throw new Error('シート「' + EVENTS_MANAGED_SHEET_NAME + '」が見つかりません');
  return sh;
}

function eventHeaderValues_() {
  return EVENT_HEADERS.concat([EVENT_REQUEST_ID_HEADER]);
}

function requestIdColumnProtection_(sh) {
  if (!sh.getProtections || !SpreadsheetApp.ProtectionType || typeof sh.getSheetId !== 'function') return null;
  var requiredRows = sh.getMaxRows ? sh.getMaxRows() : sh.getLastRow();
  if (!requiredRows) return null;
  var sheetId = sh.getSheetId();
  var protections = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE) || [];
  for (var i = 0; i < protections.length; i++) {
    var range = protections[i].getRange();
    var protectedSheet = range && range.getSheet ? range.getSheet() : null;
    if (!protectedSheet || typeof protectedSheet.getSheetId !== 'function' || protectedSheet.getSheetId() !== sheetId) continue;
    if (range.getRow() === 1 &&
        range.getColumn() === EVENT_REQUEST_ID_COLUMN &&
        range.getNumColumns() === 1 &&
        typeof range.getNumRows === 'function' &&
        range.getNumRows() >= requiredRows) return protections[i];
  }
  return null;
}

function eventSystemColumnsProtection_(sh) {
  if (!sh.getProtections || !SpreadsheetApp.ProtectionType || typeof sh.getSheetId !== 'function') return null;
  var requiredRows = sh.getMaxRows ? sh.getMaxRows() : sh.getLastRow();
  if (!requiredRows) return null;
  var sheetId = sh.getSheetId();
  var protections = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE) || [];
  for (var i = 0; i < protections.length; i++) {
    var range = protections[i].getRange();
    var protectedSheet = range && range.getSheet ? range.getSheet() : null;
    if (!protectedSheet || typeof protectedSheet.getSheetId !== 'function' || protectedSheet.getSheetId() !== sheetId) continue;
    if (range.getRow() === 1 &&
        range.getColumn() === EVENT_SYSTEM_COLUMN_START &&
        range.getNumColumns() === EVENT_SYSTEM_COLUMN_COUNT &&
        typeof range.getNumRows === 'function' &&
        range.getNumRows() >= requiredRows) return protections[i];
  }
  return null;
}

function requestIdColumnIsProtected_(sh) {
  var protection = requestIdColumnProtection_(sh);
  return !!protection && eventProtectionIsEffective_(protection, sh);
}

function eventProtectionIsEffective_(protection, sh) {
  if (!protection || typeof protection.isWarningOnly !== 'function' || protection.isWarningOnly()) return false;
  if (typeof protection.canDomainEdit !== 'function' || protection.canDomainEdit()) return false;
  if (typeof protection.getEditors !== 'function') return false;
  var allowed = eventProtectionAllowedEmails_(sh);
  return (protection.getEditors() || []).every(function (user) {
    var email = user && user.getEmail ? user.getEmail() : String(user || '');
    return !!allowed[email];
  });
}

function eventProtectionAllowedEmails_(sh) {
  var allowed = {};
  var effective = Session.getEffectiveUser && Session.getEffectiveUser();
  if (effective && effective.getEmail && effective.getEmail()) allowed[effective.getEmail()] = true;
  var owner = null;
  try {
    var book = sh && sh.getParent ? sh.getParent() : SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    owner = book && book.getOwner ? book.getOwner() : null;
  } catch (ignore) {}
  if (owner && owner.getEmail && owner.getEmail()) allowed[owner.getEmail()] = true;
  var configured = PropertiesService.getScriptProperties().getProperty('EVENT_M_COLUMN_ALLOWED_EDITORS');
  if (configured) configured.split(',').forEach(function (email) {
    email = String(email || '').trim();
    if (email) allowed[email] = true;
  });
  return allowed;
}

function secureEventProtection_(protection, sh, columnLabel) {
  columnLabel = columnLabel || 'M列';
  if (!protection || typeof protection.isWarningOnly !== 'function' ||
      typeof protection.setWarningOnly !== 'function' ||
      typeof protection.getEditors !== 'function' ||
      typeof protection.canDomainEdit !== 'function' ||
      typeof protection.setDomainEdit !== 'function') {
    throw new Error('イベント管理シートの' + columnLabel + 'の保護状態を検査できないため停止しました');
  }
  if (protection.isWarningOnly()) protection.setWarningOnly(false);
  if (protection.isWarningOnly()) throw new Error('イベント管理シートの' + columnLabel + 'を手動編集禁止にできないため停止しました');

  var allowed = eventProtectionAllowedEmails_(sh);
  var effective = Session.getEffectiveUser && Session.getEffectiveUser();
  if (effective && protection.addEditor) protection.addEditor(effective);
  var editors = protection.getEditors() || [];
  var removals = editors.filter(function (user) {
    var email = user && user.getEmail ? user.getEmail() : String(user || '');
    return !allowed[email];
  });
  if (removals.length) {
    if (!protection.removeEditors) throw new Error('イベント管理シートの' + columnLabel + 'の編集者を制限できません');
    protection.removeEditors(removals);
  }
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
  if (protection.canDomainEdit()) throw new Error('イベント管理シートの' + columnLabel + 'のドメイン編集を無効化できません');

  var remaining = protection.getEditors() || [];
  var hasUnexpected = remaining.some(function (user) {
    var email = user && user.getEmail ? user.getEmail() : String(user || '');
    return !allowed[email];
  });
  if (hasUnexpected) throw new Error('イベント管理シートの' + columnLabel + 'の編集者を検査できないため停止しました');
  return protection;
}

function eventInputRulesConfigured_(sh) {
  return eventInputRuleDetails_(sh).every(function (detail) {
    return detail && eventValidationSpecMatches_(detail, eventValidationSpec_(detail.column));
  });
}

function eventValidationSpec_(column) {
  if (column === 2) {
    return { criteriaType: 'VALUE_IN_LIST', criteriaValues: [['公開', '終了'], false], allowInvalid: false };
  }
  if (column === 3) {
    return { criteriaType: 'DATE_IS_VALID_DATE', criteriaValues: [], allowInvalid: false };
  }
  var letter = column === 4 ? 'D' : 'E';
  return {
    criteriaType: 'CUSTOM_FORMULA',
    criteriaValues: ['=OR(' + letter + '2="",AND(ISNUMBER(' + letter + '2),' + letter + '2>=0,' + letter + '2<1),REGEXMATCH(TO_TEXT(' + letter + '2),"^(?:[01]\\d|2[0-3]):[0-5]\\d$"))'],
    allowInvalid: false
  };
}

function eventValidationDetail_(rule) {
  if (!rule || typeof rule.getCriteriaType !== 'function' ||
      typeof rule.getCriteriaValues !== 'function' || typeof rule.getAllowInvalid !== 'function') return null;
  return {
    criteriaType: String(rule.getCriteriaType()),
    criteriaValues: rule.getCriteriaValues() || [],
    allowInvalid: rule.getAllowInvalid() === true
  };
}

function eventValidationSpecMatches_(detail, spec) {
  return !!detail && !!spec && detail.criteriaType === spec.criteriaType &&
    JSON.stringify(detail.criteriaValues) === JSON.stringify(spec.criteriaValues) &&
    detail.allowInvalid === spec.allowInvalid;
}

function eventValidationDetailForRow_(rule, column, row) {
  var detail = eventValidationDetail_(rule);
  if (!detail || detail.criteriaType !== 'CUSTOM_FORMULA' || (column !== 4 && column !== 5) ||
      !Array.isArray(detail.criteriaValues) || typeof detail.criteriaValues[0] !== 'string') return detail;
  var letter = column === 4 ? 'D' : 'E';
  var rowRef = new RegExp('\\b' + letter + row + '\\b', 'g');
  detail.criteriaValues = detail.criteriaValues.slice();
  detail.criteriaValues[0] = detail.criteriaValues[0].replace(rowRef, letter + '2');
  return detail;
}

function eventInputRuleDetails_(sh) {
  if (!sh || !sh.getRange) return [2, 3, 4, 5].map(function (column) { return null; });
  var maxRows = sh.getMaxRows ? sh.getMaxRows() : sh.getLastRow();
  var numRows = Math.max(0, maxRows - 1);
  return [2, 3, 4, 5].map(function (column) {
    var detail = {
      column: column,
      row: 2,
      numRows: numRows,
      criteriaType: null,
      criteriaValues: null,
      allowInvalid: null
    };
    if (!numRows) return detail;
    var range = sh.getRange(2, column, numRows, 1);
    if (!range || typeof range.getDataValidations !== 'function') return detail;
    var matrix = range.getDataValidations();
    if (!Array.isArray(matrix) || matrix.length !== numRows) return detail;
    var first = eventValidationDetailForRow_(matrix[0] && matrix[0][0], column, 2);
    if (!first) return detail;
    for (var i = 1; i < matrix.length; i++) {
      var current = eventValidationDetailForRow_(matrix[i] && matrix[i][0], column, i + 2);
      if (!current || JSON.stringify(current) !== JSON.stringify(first)) return detail;
    }
    detail.criteriaType = first.criteriaType;
    detail.criteriaValues = first.criteriaValues;
    detail.allowInvalid = first.allowInvalid;
    return detail;
  });
}

function ensureEventInputRules_(sh) {
  if (!SpreadsheetApp.newDataValidation) throw new Error('イベント管理シートの入力規則を設定できません');
  var maxRows = sh.getMaxRows ? sh.getMaxRows() : sh.getLastRow();
  if (maxRows < 2) maxRows = 2;
  var rules = [
    { column: 2, build: function () {
      return SpreadsheetApp.newDataValidation()
        .requireValueInList(['公開', '終了'], false)
        .setAllowInvalid(false)
        .build();
    } },
    { column: 3, build: function () {
      return SpreadsheetApp.newDataValidation()
        .requireDate()
        .setAllowInvalid(false)
        .build();
    } },
    { column: 4, build: function () {
      return SpreadsheetApp.newDataValidation()
        .requireFormulaSatisfied(eventValidationSpec_(4).criteriaValues[0])
        .setAllowInvalid(false)
        .build();
    } },
    { column: 5, build: function () {
      return SpreadsheetApp.newDataValidation()
        .requireFormulaSatisfied(eventValidationSpec_(5).criteriaValues[0])
        .setAllowInvalid(false)
        .build();
    } }
  ];
  rules.forEach(function (item) {
    var current = eventInputRuleDetails_(sh).filter(function (detail) { return detail.column === item.column; })[0];
    if (!current || !eventValidationSpecMatches_(current, eventValidationSpec_(item.column))) {
      sh.getRange(2, item.column, maxRows - 1, 1).setDataValidation(item.build());
    }
  });
  if (!eventInputRulesConfigured_(sh)) throw new Error('イベント管理シートの入力規則を内容・対象範囲まで検査できません');
}

function eventFilterRange_(sh) {
  if (!sh || !sh.getFilter) return null;
  var filter = sh.getFilter();
  if (!filter || !filter.getRange) return null;
  var range = filter.getRange();
  if (!range || typeof range.getRow !== 'function' || typeof range.getColumn !== 'function' ||
      typeof range.getNumRows !== 'function' || typeof range.getNumColumns !== 'function') return null;
  return {
    row: range.getRow(),
    column: range.getColumn(),
    numRows: range.getNumRows(),
    numColumns: range.getNumColumns()
  };
}

function eventFilterConfigured_(sh) {
  var detail = eventFilterRange_(sh);
  var maxRows = sh && sh.getMaxRows ? sh.getMaxRows() : (sh && sh.getLastRow ? sh.getLastRow() : 0);
  return !!detail && detail.row === 1 && detail.column === 1 &&
    detail.numRows === maxRows && detail.numColumns === EVENT_REQUEST_ID_COLUMN;
}

function ensureEventViewSettings_(sh) {
  if (!sh.setFrozenRows || !sh.getFrozenRows) throw new Error('イベント管理シートの固定行を設定できません');
  if (sh.getFrozenRows() !== 1) sh.setFrozenRows(1);
  if (!eventFilterConfigured_(sh)) {
    var current = sh.getFilter ? sh.getFilter() : null;
    if (current && current.remove) current.remove();
    var filterRange = sh.getRange(1, 1, sh.getMaxRows ? sh.getMaxRows() : sh.getLastRow(), EVENT_REQUEST_ID_COLUMN);
    if (!filterRange || typeof filterRange.createFilter !== 'function') throw new Error('イベント管理シートのフィルタを設定できません');
    filterRange.createFilter();
    if (!eventFilterConfigured_(sh)) throw new Error('イベント管理シートのフィルタ状態を検査できません');
  }
  ensureEventInputRules_(sh);
}

function ensureStructuredEventSheet_(sh) {
  var maxColumns = sh.getMaxColumns ? sh.getMaxColumns() : sh.getLastColumn();
  if (maxColumns < EVENT_REQUEST_ID_COLUMN) {
    if (!sh.insertColumnsAfter) throw new Error('イベント管理シートの列数を13列に設定できません');
    sh.insertColumnsAfter(maxColumns, EVENT_REQUEST_ID_COLUMN - maxColumns);
  }

  var expected = eventHeaderValues_();
  var header = sh.getRange(1, 1, 1, EVENT_REQUEST_ID_COLUMN).getValues()[0];
  var hasHeader = header.some(function (value) { return eventText_(value) !== ''; });
  if (!hasHeader) {
    if (sh.getLastRow() > 1) throw new Error('イベント管理シートにヘッダーがないため、既存データを上書きせず停止しました');
    sh.getRange(1, 1, 1, EVENT_REQUEST_ID_COLUMN).setValues([expected]);
  } else {
    for (var i = 0; i < expected.length; i++) {
      if (eventText_(header[i]) !== expected[i]) {
        if (i === EVENT_REQUEST_ID_COLUMN - 1 && !eventText_(header[i])) {
          sh.getRange(1, EVENT_REQUEST_ID_COLUMN).setValue(expected[i]);
          continue;
        }
        throw new Error('イベント管理シートのヘッダーが想定と異なります（' + (i + 1) + '列目）');
      }
    }
  }

  if (!sh.hideColumns || !sh.isColumnHiddenByUser || !sh.isColumnHiddenByUser(EVENT_REQUEST_ID_COLUMN)) {
    if (!sh.hideColumns) throw new Error('イベント管理シートのM列を非表示にできません');
    sh.hideColumns(EVENT_REQUEST_ID_COLUMN, 1);
  }
  var existingProtection = requestIdColumnProtection_(sh);
  if (existingProtection) {
    secureEventProtection_(existingProtection, sh);
    if (existingProtection.setDescription) existingProtection.setDescription(EVENT_REQUEST_ID_PROTECTION_DESCRIPTION);
  } else {
    if (!sh.getRange(1, EVENT_REQUEST_ID_COLUMN, sh.getMaxRows ? sh.getMaxRows() : sh.getLastRow(), 1).protect) {
      throw new Error('イベント管理シートのM列を保護できません');
    }
    var protection = sh.getRange(1, EVENT_REQUEST_ID_COLUMN, sh.getMaxRows ? sh.getMaxRows() : sh.getLastRow(), 1).protect();
    if (!protection) throw new Error('イベント管理シートのM列の保護状態を検査できないため停止しました');
    if (protection.setDescription) protection.setDescription(EVENT_REQUEST_ID_PROTECTION_DESCRIPTION);
    secureEventProtection_(protection, sh);
  }
  ensureEventViewSettings_(sh);
  var systemProtection = eventSystemColumnsProtection_(sh);
  if (systemProtection) {
    secureEventProtection_(systemProtection, sh, 'K:L列');
    if (systemProtection.setDescription) systemProtection.setDescription(EVENT_SYSTEM_PROTECTION_DESCRIPTION);
  } else {
    var systemRange = sh.getRange(1, EVENT_SYSTEM_COLUMN_START, sh.getMaxRows ? sh.getMaxRows() : sh.getLastRow(), EVENT_SYSTEM_COLUMN_COUNT);
    if (!systemRange.protect) throw new Error('イベント管理シートのK:L列を保護できません');
    var newSystemProtection = systemRange.protect();
    if (!newSystemProtection) throw new Error('イベント管理シートのK:L列の保護状態を検査できないため停止しました');
    if (newSystemProtection.setDescription) newSystemProtection.setDescription(EVENT_SYSTEM_PROTECTION_DESCRIPTION);
    secureEventProtection_(newSystemProtection, sh, 'K:L列');
  }
  return sh;
}

function inspectStructuredEventSheet() {
  var sh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(EVENTS_MANAGED_SHEET_NAME);
  if (!sh) throw new Error('シート「' + EVENTS_MANAGED_SHEET_NAME + '」が見つかりません');
  var header = sh.getRange(1, 1, 1, EVENT_REQUEST_ID_COLUMN).getValues()[0];
  return {
    sheetName: EVENTS_MANAGED_SHEET_NAME,
    headers: header,
    columnCount: sh.getMaxColumns ? sh.getMaxColumns() : sh.getLastColumn(),
    requestIdHeader: eventText_(header[EVENT_REQUEST_ID_COLUMN - 1]),
    requestIdColumnHidden: !!(sh.isColumnHiddenByUser && sh.isColumnHiddenByUser(EVENT_REQUEST_ID_COLUMN)),
    requestIdProtected: requestIdColumnIsProtected_(sh),
    frozenRows: sh.getFrozenRows ? sh.getFrozenRows() : 0,
    filterConfigured: eventFilterConfigured_(sh),
    filterRange: eventFilterRange_(sh),
    inputRulesConfigured: eventInputRulesConfigured_(sh),
    inputRuleRanges: eventInputRuleDetails_(sh),
    systemColumnsProtected: !!eventSystemColumnsProtection_(sh) && eventProtectionIsEffective_(eventSystemColumnsProtection_(sh), sh),
    dataRows: Math.max(0, sh.getLastRow() - 1)
  };
}

function setupStructuredEventSheet() {
  var book = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sh = book.getSheetByName(EVENTS_MANAGED_SHEET_NAME);
  if (!sh) {
    if (!book.insertSheet) throw new Error('シート「' + EVENTS_MANAGED_SHEET_NAME + '」を作成できません');
    sh = book.insertSheet(EVENTS_MANAGED_SHEET_NAME);
  }
  ensureStructuredEventSheet_(sh);
  return inspectStructuredEventSheet();
}

function assertStructuredEventSheetReady_(sh) {
  var expected = eventHeaderValues_();
  var header = sh.getRange(1, 1, 1, EVENT_REQUEST_ID_COLUMN).getValues()[0];
  for (var i = 0; i < expected.length; i++) {
    if (eventText_(header[i]) !== expected[i]) {
      throw new Error('イベント管理シートが未初期化またはヘッダー不正です。先にsetupStructuredEventSheetを実行してください');
    }
  }
  if (!sh.isColumnHiddenByUser || !sh.isColumnHiddenByUser(EVENT_REQUEST_ID_COLUMN)) {
    throw new Error('イベント管理シートのM列が未初期化または非表示ではありません。先にsetupStructuredEventSheetを実行してください');
  }
  if (!requestIdColumnIsProtected_(sh)) {
    throw new Error('イベント管理シートのM列が未初期化または保護されていません。先にsetupStructuredEventSheetを実行してください');
  }
  if (!sh.getFrozenRows || sh.getFrozenRows() !== 1 || !eventFilterConfigured_(sh) || !eventInputRulesConfigured_(sh)) {
    throw new Error('イベント管理シートの固定行・フィルタ・入力規則が未初期化です。先にsetupStructuredEventSheetを実行してください');
  }
  var systemProtection = eventSystemColumnsProtection_(sh);
  if (!systemProtection || !eventProtectionIsEffective_(systemProtection, sh)) {
    throw new Error('イベント管理シートのK:L列が未初期化または保護されていません。先にsetupStructuredEventSheetを実行してください');
  }
  return sh;
}

function eventText_(value) {
  return value == null ? '' : String(value).trim();
}

function eventIdIsValid_(id, allowMissing) {
  return allowMissing ? (!id || EVENT_ID_RE.test(id)) : EVENT_ID_RE.test(id);
}

function eventDateIsValid_(date) {
  var match = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var checked = new Date(Date.UTC(year, month - 1, day));
  return checked.getUTCFullYear() === year && checked.getUTCMonth() === month - 1 && checked.getUTCDate() === day;
}

function eventUrlIsValid_(value, label) {
  if (!value) return;
  if (!/^https:\/\/\S+$/.test(value)) throw new Error(label + 'が不正です');
}

function normalizeEvent_(input, allowMissingId, allowMissingVersion) {
  if (!input || typeof input !== 'object') throw new Error('イベントが不正です');
  var hasVersion = Object.prototype.hasOwnProperty.call(input, 'version');
  var event = {
    id: eventText_(input.id),
    status: eventText_(input.status || '公開'),
    date: eventText_(input.date),
    startTime: eventText_(input.startTime),
    endTime: eventText_(input.endTime),
    title: eventText_(input.title),
    theme: eventText_(input.theme),
    place: eventText_(input.place),
    url: eventText_(input.url),
    sheetUrl: eventText_(input.sheetUrl),
    updatedAt: eventText_(input.updatedAt),
    version: hasVersion ? input.version : 0
  };

  if (!eventIdIsValid_(event.id, !!allowMissingId)) throw new Error('イベントIDが不正です');
  if (event.status !== '公開' && event.status !== '終了') throw new Error('状態が不正です');
  if (!eventDateIsValid_(event.date)) throw new Error('開催日が不正です');
  if (event.startTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.startTime)) throw new Error('開始時刻が不正です');
  if (event.endTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.endTime)) throw new Error('終了時刻が不正です');
  if (event.endTime && !event.startTime) throw new Error('開始時刻が必要です');
  if (event.startTime && event.endTime && event.endTime <= event.startTime) throw new Error('終了時刻が開始時刻より前です');
  if (!event.title || event.title.length > 120) throw new Error('タイトルが不正です');
  if (event.theme.length > EVENT_MAX_THEME_LENGTH) throw new Error('テーマが不正です');
  if (event.place.length > EVENT_MAX_PLACE_LENGTH) throw new Error('場所が不正です');
  eventUrlIsValid_(event.url, '案内URL');
  eventUrlIsValid_(event.sheetUrl, '集計シートURL');
  if (event.url.length > EVENT_MAX_URL_LENGTH || event.sheetUrl.length > EVENT_MAX_URL_LENGTH) {
    throw new Error('URLが不正です');
  }
  if (event.sheetUrl && !/^https:\/\/docs\.google\.com\/spreadsheets\/.+$/.test(event.sheetUrl)) {
    throw new Error('集計シートURLが不正です');
  }
  if (hasVersion) {
    if (typeof event.version !== 'number' || !Number.isInteger(event.version) || event.version <= 0) {
      throw new Error('更新番号が不正です');
    }
  } else if (!allowMissingVersion) throw new Error('更新番号が不正です');
  return event;
}

function isoDateCell_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, EVENT_TIMEZONE, 'yyyy-MM-dd');
  var text = eventText_(value);
  var match = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!match) return text;
  return match[1] + '-' + ('0' + match[2]).slice(-2) + '-' + ('0' + match[3]).slice(-2);
}

function timeCell_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, EVENT_TIMEZONE, 'HH:mm');
  var text = eventText_(value);
  var match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  return match ? ('0' + match[1]).slice(-2) + ':' + match[2] : text;
}

function eventFromRow_(row) {
  return {
    id: eventText_(row[0]),
    status: eventText_(row[1]),
    date: isoDateCell_(row[2]),
    startTime: timeCell_(row[3]),
    endTime: timeCell_(row[4]),
    title: eventText_(row[5]),
    theme: eventText_(row[6]),
    place: eventText_(row[7]),
    url: eventText_(row[8]),
    sheetUrl: eventText_(row[9]),
    updatedAt: eventText_(row[10]),
    version: Number(row[11])
  };
}

function findEventRowById_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var values = sheet.getRange(2, 1, last - 1, 1).getValues();
  var found = null;
  for (var i = 0; i < values.length; i++) {
    if (eventText_(values[i][0]) !== id) continue;
    if (found !== null) throw new Error('イベントIDが重複しています');
    found = i + 2;
  }
  return found;
}

function findEventRowByRequestId_(sheet, requestId) {
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var values = sheet.getRange(2, EVENT_REQUEST_ID_COLUMN, last - 1, 1).getValues();
  var found = null;
  for (var i = 0; i < values.length; i++) {
    if (eventText_(values[i][0]) !== requestId) continue;
    if (found !== null) throw new Error('イベント要求IDが重複しています');
    found = i + 2;
  }
  return found;
}

function readStructuredEvents_(allowMigrationStaging) {
  if (!allowMigrationStaging) assertMigrationPublicReady_();
  var sh = getEventsManagedSheet_();
  assertStructuredEventSheetReady_(sh);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, EVENT_HEADERS.length).getValues();
  var ids = {};
  return values.map(function (row) {
    var hasValue = row.some(function (value) { return eventText_(value) !== ''; });
    if (!hasValue) return null;
    if (!eventText_(row[0])) throw new Error('イベントIDがありません');
    var event = normalizeEvent_(eventFromRow_(row), false);
    if (ids[event.id]) throw new Error('イベントIDが重複しています');
    ids[event.id] = true;
    return event;
  }).filter(function (event) { return event !== null; });
}

function safeCell_(value) {
  var text = value == null ? '' : String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function eventRowValues_(event, requestId) {
  var values = [
    safeCell_(event.id),
    safeCell_(event.status),
    safeCell_(event.date),
    safeCell_(event.startTime),
    safeCell_(event.endTime),
    safeCell_(event.title),
    safeCell_(event.theme),
    safeCell_(event.place),
    safeCell_(event.url),
    safeCell_(event.sheetUrl),
    safeCell_(event.updatedAt),
    event.version
  ];
  if (requestId !== undefined) values.push(safeCell_(requestId));
  return [values];
}

function eventMigrationPropertyKey_(reportId) {
  return EVENT_MIGRATION_PROPERTY_PREFIX + reportId;
}

function migrationRequestId_(source) {
  var key = eventText_(source && source.migrationKey);
  if (!key || !EVENT_REQUEST_ID_RE.test(key)) throw new Error('移行元キーが不正です');
  return key;
}

function getEventMigrationResult_(reportId) {
  var value = PropertiesService.getScriptProperties().getProperty(eventMigrationPropertyKey_(reportId));
  if (!value) return null;
  try { return JSON.parse(value); } catch (err) { throw new Error('移行結果の保存値が壊れているため停止しました'); }
}

function migrationPropertyByteLength_(text) {
  if (Utilities.newBlob) return Utilities.newBlob(String(text), 'text/plain').getBytes().length;
  return unescape(encodeURIComponent(String(text))).length;
}

function saveMigrationProperty_(key, value) {
  var text = JSON.stringify(value);
  if (migrationPropertyByteLength_(text) > EVENT_MIGRATION_PROPERTY_VALUE_MAX_BYTES) {
    throw new Error('移行保存値が9KBを超えるため保存できません');
  }
  PropertiesService.getScriptProperties().setProperty(key, text);
}

function migrationHash_(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    var n = (b + 256) % 256;
    return ('0' + n.toString(16)).slice(-2);
  }).join('');
}

function migrationIssuedPropertyKey_(sourceSignature, requestId) {
  return EVENT_MIGRATION_ISSUED_PROPERTY_PREFIX + sourceSignature + '_' + migrationHash_(requestId);
}

function migrationPendingPropertyKey_(sourceSignature, requestId) {
  return EVENT_MIGRATION_PENDING_PROPERTY_PREFIX + sourceSignature + '_' + migrationHash_(requestId);
}

function migrationIssuedRowSignature_(requestId, event) {
  return migrationHash_({
    migrationKey: requestId,
    values: normalizeEvent_(event, false, false)
  });
}

function migrationIssuedRows_(sourceSignature) {
  var prefix = EVENT_MIGRATION_ISSUED_PROPERTY_PREFIX + sourceSignature + '_';
  var properties = PropertiesService.getScriptProperties().getProperties() || {};
  var byKey = {};
  Object.keys(properties).forEach(function (key) {
    if (key.indexOf(prefix) !== 0) return;
    var value;
    try { value = JSON.parse(properties[key]); } catch (err) {
      throw new Error('発行済み移行値の保存値が壊れているため停止しました');
    }
    var migrationKey = eventText_(value && value.migrationKey);
    var rowSignature = eventText_(value && value.rowSignature);
    if (!value || value.version !== 1 || value.sourceSignature !== sourceSignature ||
        !EVENT_REQUEST_ID_RE.test(migrationKey) || !/^[0-9a-f]{64}$/.test(rowSignature) ||
        key !== migrationIssuedPropertyKey_(sourceSignature, migrationKey)) {
      throw new Error('発行済み移行値の形式が不正なため停止しました');
    }
    if (byKey[migrationKey]) throw new Error('発行済み移行キーが重複しているため停止しました');
    byKey[migrationKey] = { migrationKey: migrationKey, rowSignature: rowSignature };
  });
  return Object.keys(byKey).sort().map(function (key) { return byKey[key]; });
}

function saveMigrationIssuedRow_(sourceSignature, requestId, event) {
  saveMigrationProperty_(migrationIssuedPropertyKey_(sourceSignature, requestId), {
    version: 1,
    sourceSignature: sourceSignature,
    migrationKey: requestId,
    rowSignature: migrationIssuedRowSignature_(requestId, event)
  });
}

function migrationPendingRows_(sourceSignature) {
  var prefix = EVENT_MIGRATION_PENDING_PROPERTY_PREFIX + sourceSignature + '_';
  var properties = PropertiesService.getScriptProperties().getProperties() || {};
  var byKey = {};
  Object.keys(properties).forEach(function (key) {
    if (key.indexOf(prefix) !== 0) return;
    var value;
    try { value = JSON.parse(properties[key]); } catch (err) {
      throw new Error('移行予定発行値の保存値が壊れているため停止しました');
    }
    var migrationKey = eventText_(value && value.migrationKey);
    var id = eventText_(value && value.id);
    var updatedAt = eventText_(value && value.updatedAt);
    if (!value || value.version !== 1 || value.sourceSignature !== sourceSignature ||
        !EVENT_REQUEST_ID_RE.test(migrationKey) || !EVENT_ID_RE.test(id) || !updatedAt ||
        key !== migrationPendingPropertyKey_(sourceSignature, migrationKey)) {
      throw new Error('移行予定発行値の形式が不正なため停止しました');
    }
    if (byKey[migrationKey]) throw new Error('移行予定発行キーが重複しているため停止しました');
    byKey[migrationKey] = { migrationKey: migrationKey, id: id, updatedAt: updatedAt };
  });
  return Object.keys(byKey).sort().map(function (key) { return byKey[key]; });
}

function saveMigrationPendingRow_(sourceSignature, requestId, event) {
  saveMigrationProperty_(migrationPendingPropertyKey_(sourceSignature, requestId), {
    version: 1,
    sourceSignature: sourceSignature,
    migrationKey: requestId,
    id: eventText_(event && event.id),
    updatedAt: eventText_(event && event.updatedAt)
  });
}

function deleteMigrationPendingRow_(sourceSignature, requestId) {
  PropertiesService.getScriptProperties().deleteProperty(migrationPendingPropertyKey_(sourceSignature, requestId));
}

function migrationIssuedRowsDigest_(entries) {
  return migrationHash_((entries || []).map(function (entry) {
    return { migrationKey: entry.migrationKey, rowSignature: entry.rowSignature };
  }));
}

function migrationIssuedRowsMatch_(sheet, entries) {
  var actualRows = migrationRows_(sheet);
  if (actualRows.length !== entries.length) return false;
  var actualByKey = {};
  actualRows.forEach(function (item) {
    if (actualByKey[item.requestId]) throw new Error('移行元キーがシート内で重複しています');
    actualByKey[item.requestId] = item;
  });
  return entries.every(function (entry) {
    var actual = actualByKey[entry.migrationKey];
    return !!actual && migrationIssuedRowSignature_(entry.migrationKey, actual.event) === entry.rowSignature;
  });
}

function migrationStagedRowsMatch_(sheet, report, issuedRows, pendingRows) {
  var actualRows = migrationRows_(sheet);
  var actualByKey = {};
  actualRows.forEach(function (item) {
    if (actualByKey[item.requestId]) throw new Error('移行元キーがシート内で重複しています');
    actualByKey[item.requestId] = item;
  });
  var issuedByKey = {};
  (issuedRows || []).forEach(function (entry) {
    if (issuedByKey[entry.migrationKey]) throw new Error('発行済み移行キーが重複しています');
    issuedByKey[entry.migrationKey] = entry;
  });
  var pendingByKey = {};
  (pendingRows || []).forEach(function (entry) {
    if (pendingByKey[entry.migrationKey]) throw new Error('移行予定発行キーが重複しています');
    pendingByKey[entry.migrationKey] = entry;
  });
  var sourceByKey = {};
  report.records.forEach(function (source) {
    sourceByKey[migrationRequestId_(source)] = source;
  });
  actualRows.forEach(function (item) {
    var issued = issuedByKey[item.requestId];
    var pending = pendingByKey[item.requestId];
    var source = sourceByKey[item.requestId];
    if (!source || (!issued && !pending) ||
        !migrationEventMatchesSource_(source, item.event)) {
      throw new Error('再開対象の移行値がreportまたは発行記録と不一致のため停止しました');
    }
    if (issued && migrationIssuedRowSignature_(issued.migrationKey, item.event) !== issued.rowSignature) {
      throw new Error('再開対象の発行済みA-L値がシートと不一致のため停止しました');
    }
    if (pending && (pending.id !== item.event.id || pending.updatedAt !== item.event.updatedAt)) {
      throw new Error('再開対象の予定発行値がシートと不一致のため停止しました');
    }
  });
  (issuedRows || []).forEach(function (entry) {
    if (!actualByKey[entry.migrationKey]) {
      throw new Error('再開対象の発行済み行がシートにありません');
    }
  });
  return true;
}

function saveEventMigrationResult_(reportId, result) {
  var compact = {
    reportSignature: eventText_(result && result.reportSignature),
    sourceSignature: eventText_(result && result.sourceSignature),
    snapshotSignature: eventText_(result && result.snapshotSignature),
    issuedRowCount: Number(result && result.issuedRowCount),
    issuedRowsDigest: eventText_(result && result.issuedRowsDigest),
    result: result && result.result ? {
      ok: result.result.ok === true,
      reportId: eventText_(result.result.reportId),
      recordCount: Number(result.result.recordCount),
      eventIds: Array.isArray(result.result.eventIds) ? result.result.eventIds.map(eventText_) : []
    } : null
  };
  saveMigrationProperty_(eventMigrationPropertyKey_(reportId), compact);
}

function getEventMigrationState_() {
  var value = PropertiesService.getScriptProperties().getProperty(EVENT_MIGRATION_STATE_PROPERTY);
  if (!value) return null;
  try { return JSON.parse(value); } catch (err) { throw new Error('移行状態の保存値が壊れているため停止しました'); }
}

function saveEventMigrationState_(state) {
  var compact = {
    status: eventText_(state && state.status),
    reportId: eventText_(state && state.reportId),
    reportSignature: eventText_(state && state.reportSignature),
    sourceSignature: eventText_(state && state.sourceSignature),
    sourceCount: Number(state && state.sourceCount),
    recordCount: Number(state && state.recordCount)
  };
  if (state && state.snapshotSignature) compact.snapshotSignature = eventText_(state.snapshotSignature);
  if (state && state.issuedRowCount !== undefined) compact.issuedRowCount = Number(state.issuedRowCount);
  if (state && state.issuedRowsDigest) compact.issuedRowsDigest = eventText_(state.issuedRowsDigest);
  if (state && state.error) compact.error = String(state.error).slice(0, EVENT_MIGRATION_ERROR_MAX_CHARS);
  saveMigrationProperty_(EVENT_MIGRATION_STATE_PROPERTY, compact);
}

function assertMigrationPublicReady_() {
  var state = getEventMigrationState_();
  if (state && state.status !== 'complete') {
    throw new Error('移行が完了するまで通常read/snapshotを公開できません（状態: ' + state.status + '）');
  }
}

function migrationCanonicalize_(value) {
  if (Array.isArray(value)) return value.map(migrationCanonicalize_);
  if (!value || typeof value !== 'object') return value;
  var result = {};
  Object.keys(value).sort().forEach(function (key) { result[key] = migrationCanonicalize_(value[key]); });
  return result;
}

function migrationStableJson_(value) {
  return JSON.stringify(migrationCanonicalize_(value));
}

function migrationSortedRecords_(records) {
  return records.slice().sort(function (a, b) {
    return String(a.migrationKey).localeCompare(String(b.migrationKey));
  });
}

function migrationReportComparable_(report) {
  return {
    reportId: report.reportId,
    sourceVersion: report.sourceVersion,
    ready: report.ready,
    backupSheetName: report.backupSheetName,
    backupVerified: report.backupVerified,
    sourceCount: report.sourceCount,
    sourceRows: report.sourceRows,
    recordCount: report.recordCount,
    warnings: report.warnings,
    skipped: report.skipped,
    records: migrationSortedRecords_(report.records)
  };
}

function migrationSourceComparable_(report) {
  return {
    sourceVersion: report.sourceVersion,
    sourceCount: report.sourceCount,
    sourceRows: report.sourceRows,
    recordCount: report.recordCount,
    records: migrationSortedRecords_(report.records)
  };
}

function migrationReportSignature_(report) {
  return migrationHash_(migrationReportComparable_(report));
}

function migrationSourceSignature_(report) {
  return migrationHash_(migrationSourceComparable_(report));
}

function migrationRowsEqual_(expected, actual) {
  if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return false;
  for (var i = 0; i < expected.length; i++) {
    if (!Array.isArray(expected[i]) || !Array.isArray(actual[i]) || expected[i].length !== actual[i].length) return false;
    for (var j = 0; j < expected[i].length; j++) {
      if (eventText_(expected[i][j]) !== eventText_(actual[i][j])) return false;
    }
  }
  return true;
}

function migrationRows_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(2, 1, last - 1, EVENT_REQUEST_ID_COLUMN).getValues();
  return values.filter(function (row) {
    return eventText_(row[EVENT_REQUEST_ID_COLUMN - 1]) !== '';
  }).map(function (row) {
    return {
      requestId: eventText_(row[EVENT_REQUEST_ID_COLUMN - 1]),
      event: normalizeEvent_(eventFromRow_(row), false)
    };
  });
}

function migrationExpectedRows_(report) {
  return migrationSortedRecords_(report.records).map(function (source) {
    return {
      requestId: migrationRequestId_(source),
      source: normalizeEvent_(source, true, false)
    };
  });
}

function migrationRowSetMatches_(sheet, expectedRows) {
  var actualRows = migrationRows_(sheet);
  if (actualRows.length !== expectedRows.length) return false;
  var actualByKey = {};
  actualRows.forEach(function (item) {
    if (actualByKey[item.requestId]) throw new Error('移行元キーがシート内で重複しています');
    actualByKey[item.requestId] = item;
  });
  return expectedRows.every(function (expected) {
    var actual = actualByKey[expected.requestId];
    return !!actual && (expected.source
      ? migrationEventMatchesSource_(expected.source, actual.event)
      : migrationStableJson_(actual.event) === migrationStableJson_(expected.event));
  });
}

function migrationSnapshotMatches_(snapshot, expectedEvents) {
  if (!snapshot || !Array.isArray(snapshot.events) || !snapshot.counts ||
      snapshot.counts.events !== expectedEvents.length || snapshot.events.length !== expectedEvents.length) return false;
  var expected = expectedEvents.map(function (event) { return normalizeEvent_(event, false); })
    .sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
  var actual = snapshot.events.map(function (event) { return normalizeEvent_(event, false); })
    .sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
  return migrationStableJson_(actual) === migrationStableJson_(expected);
}

function migrationBackupRows_(book, sheetName) {
  var sheet = book.getSheetByName(sheetName);
  if (!sheet) throw new Error('移行元バックアップシートが見つかりません');
  var last = sheet.getLastRow ? sheet.getLastRow() : 0;
  if (last < 1) return [];
  return sheet.getRange(1, 1, last, 3).getValues().map(function (row) {
    return row.map(function (value) { return eventText_(value); });
  });
}

function validateMigrationReport_(report) {
  if (!report || typeof report !== 'object' || report.sourceVersion !== 1 ||
      report.ready !== true ||
      !report.reportId || !/^mig_[A-Za-z0-9_-]{8,76}$/.test(String(report.reportId)) ||
      report.backupVerified !== true || !report.backupSheetName ||
      !Array.isArray(report.warnings) || report.warnings.length ||
      !Array.isArray(report.skipped) || report.skipped.length ||
      !Array.isArray(report.sourceRows) || !Number.isInteger(report.sourceCount) ||
      report.sourceCount !== report.sourceRows.length ||
      !Array.isArray(report.records) || !report.records.length ||
      !Number.isInteger(report.recordCount) || report.recordCount !== report.records.length) {
    throw new Error('移行レポートの確認条件を満たしていません');
  }
  var seen = {};
  report.records.forEach(function (record) {
    var key = eventText_(record && record.migrationKey);
    if (!key || !EVENT_REQUEST_ID_RE.test(key) || seen[key]) throw new Error('移行元キーが重複または未設定です');
    seen[key] = true;
    normalizeEvent_(record, true, false);
  });
}

function migrateStructuredEventsLocked_(report) {
  validateMigrationReport_(report);
  var book = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var backupRows = migrationBackupRows_(book, report.backupSheetName);
  if (backupRows.length !== report.sourceCount || !migrationRowsEqual_(report.sourceRows, backupRows)) {
    throw new Error('移行レポートのsourceCountまたは元行がバックアップと一致しません');
  }
  var reportSignature = migrationReportSignature_(report);
  var sourceSignature = migrationSourceSignature_(report);
  var sh = getEventsManagedSheet_();
  var state = getEventMigrationState_();
  if (state && state.sourceSignature && state.sourceSignature !== sourceSignature) {
    throw new Error('現在の移行世代と異なる元データのため安全に再開できません');
  }
  var issuedRows = migrationIssuedRows_(sourceSignature);
  var issuedRowsDigest = migrationIssuedRowsDigest_(issuedRows);
  var pendingRows = migrationPendingRows_(sourceSignature);
  var expectedRows = migrationExpectedRows_(report);
  var saved = getEventMigrationResult_(report.reportId);
  if (saved) {
    if (!state || (state.status !== 'staging' && state.status !== 'failed' && state.status !== 'complete') ||
        saved.reportSignature !== reportSignature || saved.sourceSignature !== sourceSignature ||
        !saved.result || saved.result.ok !== true || saved.result.recordCount !== report.recordCount ||
        saved.issuedRowCount !== report.recordCount || saved.issuedRowsDigest !== issuedRowsDigest ||
        issuedRows.length !== report.recordCount || pendingRows.length) {
      throw new Error('同じreportIdの既存値または移行レポートが不一致のため停止しました');
    }
    ensureStructuredEventSheet_(sh);
    assertStructuredEventSheetReady_(sh);
    if (!migrationIssuedRowsMatch_(sh, issuedRows) || !migrationRowSetMatches_(sh, expectedRows)) {
      throw new Error('同じreportIdの投入行集合または発行済みA-L値が不一致のため停止しました');
    }
    var savedEvents = readStructuredEvents_(true);
    var savedSnapshot = refreshMaterialSnapshotAtLocked_(new Date(), true);
    if (!migrationSnapshotMatches_(savedSnapshot, savedEvents)) throw new Error('同じreportIdの公開snapshotが不一致のため停止しました');
    saveEventMigrationState_({
      status: 'complete',
      reportId: report.reportId,
      reportSignature: reportSignature,
      sourceSignature: sourceSignature,
      sourceCount: report.sourceCount,
      recordCount: report.recordCount,
      snapshotSignature: savedSnapshot.digest,
      issuedRowCount: issuedRows.length,
      issuedRowsDigest: issuedRowsDigest
    });
    return saved.result;
  }

  var stateStarted = false;
  try {
    saveEventMigrationState_({
      status: 'staging',
      reportId: report.reportId,
      reportSignature: reportSignature,
      sourceSignature: sourceSignature,
      sourceCount: report.sourceCount,
      recordCount: report.recordCount,
      issuedRowCount: issuedRows.length,
      issuedRowsDigest: issuedRowsDigest
    });
    stateStarted = true;
    ensureStructuredEventSheet_(sh);
    assertStructuredEventSheetReady_(sh);
    if (issuedRows.length || pendingRows.length) {
      migrationStagedRowsMatch_(sh, report, issuedRows, pendingRows);
    }

    var issuedByKey = {};
    issuedRows.forEach(function (entry) { issuedByKey[entry.migrationKey] = entry; });
    var pendingByKey = {};
    pendingRows.forEach(function (entry) { pendingByKey[entry.migrationKey] = entry; });

    var declaredIds = {};
    report.records.forEach(function (source) {
      var preflight = normalizeEvent_(source, true, false);
      if (preflight.id) {
        if (declaredIds[preflight.id]) throw new Error('移行レポート内のイベントIDが重複しています');
        declaredIds[preflight.id] = true;
        var requestRow = findEventRowByRequestId_(sh, migrationRequestId_(source));
        if (requestRow === null && findEventRowById_(sh, preflight.id) !== null) {
          throw new Error('移行対象のイベントIDが既存データと重複しています');
        }
      }
    });

    var migrated = [];
    var seenRequestIds = {};
    report.records.forEach(function (source) {
      var event = normalizeEvent_(source, true, false);
      if (event.version !== 1) throw new Error('移行レコードの更新番号は1である必要があります');
      var requestId = migrationRequestId_(source);
      if (seenRequestIds[requestId]) throw new Error('移行元キーが重複しています');
      seenRequestIds[requestId] = true;
      var issued = issuedByKey[requestId] || null;
      var pending = pendingByKey[requestId] || null;
      var existingRequestRow = findEventRowByRequestId_(sh, requestId);
      if (existingRequestRow !== null) {
        var existing = normalizeEvent_(eventFromRow_(sh.getRange(existingRequestRow, 1, 1, EVENT_HEADERS.length).getValues()[0]), false);
        if (!issued && !pending) throw new Error('移行元キーに対応する発行記録がないため停止しました');
        if (!migrationEventMatchesSource_(source, existing)) throw new Error('移行元キーに対応する既存値が不一致のため停止しました');
        if (issued && migrationIssuedRowSignature_(requestId, existing) !== issued.rowSignature) {
          throw new Error('再開対象の発行済みA-L値がシートと不一致のため停止しました');
        }
        if (pending && (pending.id !== existing.id || pending.updatedAt !== existing.updatedAt)) {
          throw new Error('再開対象の予定発行値がシートと不一致のため停止しました');
        }
        event = existing;
      } else {
        if (issued) throw new Error('発行済み行がシートにないため停止しました');
        if (pending) {
          event.id = pending.id;
          event.updatedAt = pending.updatedAt;
        } else {
          if (!event.id) event.id = newEventId_();
          event.updatedAt = event.updatedAt || eventNow_();
        }
        if (findEventRowById_(sh, event.id) !== null) throw new Error('移行対象のイベントIDが既存データと重複しています');
        if (!pending) {
          saveMigrationPendingRow_(sourceSignature, requestId, event);
          pending = { migrationKey: requestId, id: event.id, updatedAt: event.updatedAt };
          pendingByKey[requestId] = pending;
        }
        event.version = 1;
        sh.appendRow(eventRowValues_(event, requestId)[0]);
      }
      migrated.push({ migrationKey: requestId, requestId: requestId, event: JSON.parse(JSON.stringify(event)) });
      if (!issued) {
        saveMigrationIssuedRow_(sourceSignature, requestId, event);
        issuedByKey[requestId] = {
          migrationKey: requestId,
          rowSignature: migrationIssuedRowSignature_(requestId, event)
        };
      }
      if (pending) {
        deleteMigrationPendingRow_(sourceSignature, requestId);
        delete pendingByKey[requestId];
      }
    });
    if (migrated.length !== report.recordCount) throw new Error('移行投入件数がレポートと一致しません');
    issuedRows = migrationIssuedRows_(sourceSignature);
    issuedRowsDigest = migrationIssuedRowsDigest_(issuedRows);
    pendingRows = migrationPendingRows_(sourceSignature);
    if (issuedRows.length !== report.recordCount || !migrationIssuedRowsMatch_(sh, issuedRows)) {
      throw new Error('発行済みA-L値または移行投入件数の照合に失敗しました');
    }
    if (pendingRows.length) throw new Error('移行予定発行値が残っているため公開できません');
    if (!migrationRowSetMatches_(sh, migrated)) throw new Error('移行投入行集合または投入値の照合に失敗しました');
    var allEvents = readStructuredEvents_(true);
    var snapshot = refreshMaterialSnapshotAtLocked_(new Date(), true);
    if (!migrationSnapshotMatches_(snapshot, allEvents)) throw new Error('移行後のsnapshot件数または値の照合に失敗しました');
    var stableResult = {
      ok: true,
      reportId: report.reportId,
      recordCount: migrated.length,
      eventIds: migrated.map(function (item) { return item.event.id; })
    };
    saveEventMigrationResult_(report.reportId, {
      reportSignature: reportSignature,
      sourceSignature: sourceSignature,
      snapshotSignature: snapshot.digest,
      issuedRowCount: issuedRows.length,
      issuedRowsDigest: issuedRowsDigest,
      result: stableResult
    });
    saveEventMigrationState_({
      status: 'complete',
      reportId: report.reportId,
      reportSignature: reportSignature,
      sourceSignature: sourceSignature,
      sourceCount: report.sourceCount,
      recordCount: report.recordCount,
      snapshotSignature: snapshot.digest,
      issuedRowCount: issuedRows.length,
      issuedRowsDigest: issuedRowsDigest
    });
    return stableResult;
  } catch (err) {
    if (stateStarted) {
      try {
        var failedIssuedRows = migrationIssuedRows_(sourceSignature);
        saveEventMigrationState_({
          status: 'failed',
          reportId: report.reportId,
          reportSignature: reportSignature,
          sourceSignature: sourceSignature,
          sourceCount: report.sourceCount,
          recordCount: report.recordCount,
          issuedRowCount: failedIssuedRows.length,
          issuedRowsDigest: migrationIssuedRowsDigest_(failedIssuedRows),
          error: String(err && err.message || err)
        });
      } catch (ignore) {}
    }
    throw err;
  }
}

function migrationEventMatchesSource_(source, actual) {
  var expected = normalizeEvent_(source, true, false);
  var fields = ['status', 'date', 'startTime', 'endTime', 'title', 'theme', 'place', 'url', 'sheetUrl'];
  if (expected.id && expected.id !== actual.id) return false;
  if (expected.updatedAt && expected.updatedAt !== actual.updatedAt) return false;
  if (actual.version !== 1) return false;
  for (var i = 0; i < fields.length; i++) if (expected[fields[i]] !== actual[fields[i]]) return false;
  return true;
}

function migrateStructuredEvents(report) {
  try {
    return withMaterialLock_(function () {
      return migrateStructuredEventsLocked_(report);
    }, false);
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

function eventRequestKey_(requestId) {
  return EVENT_REQUEST_CACHE_PREFIX + requestId;
}

function eventRequestPropertyKey_(requestId) {
  return EVENT_REQUEST_PROPERTY_PREFIX + requestId;
}

function getEventRequestResult_(requestId) {
  var value = null;
  try { value = CacheService.getScriptCache().get(eventRequestKey_(requestId)); } catch (ignore) {}
  if (!value) {
    try { value = PropertiesService.getScriptProperties().getProperty(eventRequestPropertyKey_(requestId)); } catch (ignore2) {}
  }
  if (!value) return null;
  try {
    var parsed = JSON.parse(value);
    return parsed && parsed.result && parsed.savedAt ? parsed.result : parsed;
  } catch (ignore3) { return null; }
}

function saveEventRequestResult_(requestId, result) {
  var value = JSON.stringify(result);
  try {
    CacheService.getScriptCache().put(eventRequestKey_(requestId), value, EVENT_REQUEST_CACHE_SECONDS);
  } catch (ignore) {}
  try {
    var properties = PropertiesService.getScriptProperties();
    var key = eventRequestPropertyKey_(requestId);
    var all = properties.getProperties ? properties.getProperties() : {};
    var keys = Object.keys(all).filter(function (name) { return name.indexOf(EVENT_REQUEST_PROPERTY_PREFIX) === 0; });
    while (keys.length >= EVENT_REQUEST_PROPERTY_MAX) {
      var oldestIndex = 0;
      var oldest = keys[oldestIndex];
      var oldestSavedAt = Number.MAX_SAFE_INTEGER;
      try {
        var old = JSON.parse(all[oldest]);
        oldestSavedAt = Number(old && old.savedAt) || 0;
      } catch (ignore2) {}
      for (var i = 1; i < keys.length; i++) {
        var candidateSavedAt = Number.MAX_SAFE_INTEGER;
        try {
          var candidate = JSON.parse(all[keys[i]]);
          candidateSavedAt = Number(candidate && candidate.savedAt) || 0;
        } catch (ignore3) {}
        if (candidateSavedAt < oldestSavedAt) {
          oldestIndex = i;
          oldest = keys[i];
          oldestSavedAt = candidateSavedAt;
        }
      }
      if (properties.deleteProperty) properties.deleteProperty(oldest);
      keys.splice(oldestIndex, 1);
    }
    properties.setProperty(key, JSON.stringify({ savedAt: new Date().getTime(), result: result }));
  } catch (ignore4) {}
}

function newEventId_() {
  var id = 'evt_' + String(Utilities.getUuid()).replace(/-/g, '');
  if (!EVENT_ID_RE.test(id)) throw new Error('イベントIDを発行できません');
  return id;
}

function eventNow_() {
  return isoWithOffset_(new Date(), EVENT_TIMEZONE);
}

function eventConflict_() {
  return { ok: false, error: 'conflict', message: '別の画面で更新されています。' };
}

function refreshEventSnapshot_(result, previousVersion) {
  try {
    var encoded = CacheService.getScriptCache().get(MATERIAL_SNAPSHOT_CACHE_KEY);
    var snapshot = null;
    try { if (encoded) snapshot = decodeSnapshot_(encoded); } catch (ignore) {}
    var valid = snapshot && snapshot.version === MATERIAL_SNAPSHOT_VERSION &&
      Number.isFinite(Date.parse(snapshot.generatedAt)) &&
      new Date().getTime() - Date.parse(snapshot.generatedAt) <= MATERIAL_SNAPSHOT_MAX_AGE_MS &&
      new Date().getTime() - Date.parse(snapshot.generatedAt) >= -5 * 60 * 1000 &&
      Array.isArray(snapshot.contacts) && snapshot.contacts.length > 0 &&
      Array.isArray(snapshot.events) && Array.isArray(snapshot.calendar) &&
      snapshot.counts && snapshot.counts.contacts === snapshot.contacts.length &&
      snapshot.counts.events === snapshot.events.length &&
      snapshot.counts.calendar === snapshot.calendar.length &&
      snapshot.digest === snapshotDigest_(snapshot);
    if (valid) {
      var id = result.deletedId || result.event.id;
      var index = snapshot.events.findIndex(function (event) { return event.id === id; });
      if (result.deletedId) {
        valid = index >= 0 && snapshot.events[index].version === previousVersion;
        if (valid) snapshot.events.splice(index, 1);
      } else if (previousVersion == null) {
        valid = index < 0;
        if (valid) snapshot.events.push(result.event);
      } else {
        valid = index >= 0 && snapshot.events[index].version === previousVersion;
        if (valid) snapshot.events[index] = result.event;
      }
    }
    if (valid) {
      snapshot.counts.events = snapshot.events.length;
      snapshot.digest = snapshotDigest_(snapshot);
      storeMaterialSnapshot_(snapshot);
    } else {
      // Cache eviction or an out-of-band sheet edit requires a complete reconciliation.
      refreshMaterialSnapshotAtLocked_(new Date());
    }
    return result;
  } catch (err) {
    return {
      ok: result.ok,
      event: result.event,
      warningCode: 'snapshot_refresh_failed',
      warning: 'イベントは保存されましたが、同期スナップショットの更新に失敗しました。'
    };
  }
}

function flushEventWrite_() {
  if (SpreadsheetApp.flush) SpreadsheetApp.flush();
}

function createEvent_(body) {
  var requestId = eventText_(body.requestId);
  if (!EVENT_REQUEST_ID_RE.test(requestId)) return { ok: false, error: 'invalid input' };
  var previous = getEventRequestResult_(requestId);
  if (previous) return previous;

  var event;
  try {
    event = normalizeEvent_(body.event, true, true);
  } catch (err) {
    return { ok: false, error: 'invalid input', message: String(err.message || err) };
  }
  var sh = getEventsManagedSheet_();
  assertStructuredEventSheetReady_(sh);
  var existingRow = findEventRowByRequestId_(sh, requestId);
  if (existingRow !== null) {
    var existing = normalizeEvent_(eventFromRow_(sh.getRange(existingRow, 1, 1, EVENT_HEADERS.length).getValues()[0]), false);
    return { ok: true, event: existing };
  }
  event.id = newEventId_();
  event.updatedAt = eventNow_();
  event.version = 1;
  if (findEventRowById_(sh, event.id) !== null) throw new Error('イベントIDが重複しています');
  sh.appendRow(eventRowValues_(event, requestId)[0]);
  flushEventWrite_();
  var result = refreshEventSnapshot_({ ok: true, event: event }, null);
  saveEventRequestResult_(requestId, result);
  return result;
}

function updateEvent_(body) {
  if (!body.event || body.event.version == null || body.event.version === '') return { ok: false, error: 'invalid input' };
  var event;
  try {
    event = normalizeEvent_(body.event, false);
  } catch (err) {
    return { ok: false, error: 'invalid input', message: String(err.message || err) };
  }
  var sh = getEventsManagedSheet_();
  assertStructuredEventSheetReady_(sh);
  var rowNumber = findEventRowById_(sh, event.id);
  if (rowNumber === null) return { ok: false, error: 'not_found' };
  var current = eventFromRow_(sh.getRange(rowNumber, 1, 1, EVENT_HEADERS.length).getValues()[0]);
  if (current.version !== event.version) return eventConflict_();
  event.updatedAt = eventNow_();
  event.version = current.version + 1;
  sh.getRange(rowNumber, 1, 1, EVENT_HEADERS.length).setValues(eventRowValues_(event));
  flushEventWrite_();
  return refreshEventSnapshot_({ ok: true, event: event }, current.version);
}

function setEventStatus_(body) {
  var id = eventText_(body.id);
  if (body.version === null || body.version === undefined || body.version === '') {
    return { ok: false, error: 'invalid input' };
  }
  var version = body.version;
  var status = eventText_(body.status);
  if (!EVENT_ID_RE.test(id) || typeof version !== 'number' || !Number.isInteger(version) || version <= 0 || (status !== '公開' && status !== '終了')) {
    return { ok: false, error: 'invalid input' };
  }
  var sh = getEventsManagedSheet_();
  assertStructuredEventSheetReady_(sh);
  var rowNumber = findEventRowById_(sh, id);
  if (rowNumber === null) return { ok: false, error: 'not_found' };
  var current = eventFromRow_(sh.getRange(rowNumber, 1, 1, EVENT_HEADERS.length).getValues()[0]);
  if (current.version !== version) return eventConflict_();
  current.status = status;
  current.updatedAt = eventNow_();
  current.version = version + 1;
  sh.getRange(rowNumber, 1, 1, EVENT_HEADERS.length).setValues(eventRowValues_(current));
  flushEventWrite_();
  return refreshEventSnapshot_({ ok: true, event: current }, version);
}

function deleteEvent_(body) {
  var id = eventText_(body.id);
  var version = body.version;
  if (!EVENT_ID_RE.test(id) || typeof version !== 'number' || !Number.isInteger(version) || version <= 0) {
    return { ok: false, error: 'invalid input' };
  }
  var sh = getEventsManagedSheet_();
  assertStructuredEventSheetReady_(sh);
  var rowNumber = findEventRowById_(sh, id);
  if (rowNumber === null) return { ok: false, error: 'not_found' };
  var current = eventFromRow_(sh.getRange(rowNumber, 1, 1, EVENT_HEADERS.length).getValues()[0]);
  if (current.version !== version) return eventConflict_();
  sh.deleteRow(rowNumber);
  flushEventWrite_();
  return refreshEventSnapshot_({ ok: true, deletedId: id }, version);
}

function withEventLock_(callback) {
  return withMaterialLock_(callback, true);
}

function withMaterialLock_(callback, returnBusy) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    if (returnBusy) {
      return { ok: false, error: 'busy', message: 'ほかの保存を処理中です。少し待ってからもう一度お試しください。' };
    }
    throw err;
  }
  try {
    return callback();
  } finally {
    if (SpreadsheetApp.flush) SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

// ---------- 日次素材スナップショット ----------

function isoWithOffset_(date, timezone) {
  return Utilities.formatDate(date, timezone, "yyyy-MM-dd'T'HH:mm:ss") +
    Utilities.formatDate(date, timezone, 'XXX');
}

function snapshotDigest_(snapshot) {
  var payload = {
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    contacts: snapshot.contacts,
    events: snapshot.events,
    calendar: snapshot.calendar,
    counts: snapshot.counts
  };
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(payload),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    var n = (b + 256) % 256;
    return ('0' + n.toString(16)).slice(-2);
  }).join('');
}

function calendarSnapshot_(now) {
  var today = Utilities.formatDate(now, EVENT_TIMEZONE, 'yyyy-MM-dd');
  var start = new Date(today + 'T00:00:00+09:00');
  var end = new Date(start.getTime());
  end.setDate(end.getDate() + MATERIAL_SNAPSHOT_DAYS);
  return CalendarApp.getDefaultCalendar().getEvents(start, end)
    .filter(function (event) { return !event.isAllDayEvent(); })
    .map(function (event) {
      return [
        Utilities.formatDate(event.getStartTime(), EVENT_TIMEZONE, "yyyy-MM-dd'T'HH:mm"),
        Utilities.formatDate(event.getEndTime(), EVENT_TIMEZONE, "yyyy-MM-dd'T'HH:mm")
      ];
    });
}

function encodeSnapshot_(snapshot) {
  var json = JSON.stringify(snapshot);
  var zipped = Utilities.gzip(Utilities.newBlob(json, 'application/json'));
  return Utilities.base64Encode(zipped.getBytes());
}

function decodeSnapshot_(encoded) {
  var zipped = Utilities.newBlob(Utilities.base64Decode(encoded), 'application/gzip');
  return JSON.parse(Utilities.ungzip(zipped).getDataAsString('UTF-8'));
}

function refreshMaterialSnapshotAtUnlocked_(now, allowMigrationStaging) {
  if (!allowMigrationStaging) assertMigrationPublicReady_();
  var snapshot = {
    version: MATERIAL_SNAPSHOT_VERSION,
    generatedAt: isoWithOffset_(now, EVENT_TIMEZONE),
    contacts: readContacts_(),
    events: readStructuredEvents_(!!allowMigrationStaging),
    calendar: calendarSnapshot_(now)
  };
  snapshot.counts = {
    contacts: snapshot.contacts.length,
    events: snapshot.events.length,
    calendar: snapshot.calendar.length
  };
  if (!snapshot.counts.contacts) throw new Error('連絡先が0件のためスナップショットを更新しません');
  snapshot.digest = snapshotDigest_(snapshot);

  storeMaterialSnapshot_(snapshot);
  return snapshot;
}

function storeMaterialSnapshot_(snapshot) {
  CacheService.getScriptCache().put(
    MATERIAL_SNAPSHOT_CACHE_KEY,
    encodeSnapshot_(snapshot),
    MATERIAL_SNAPSHOT_CACHE_SECONDS
  );
  PropertiesService.getScriptProperties().setProperties({
    MATERIAL_SNAPSHOT_VERSION: String(snapshot.version),
    MATERIAL_SNAPSHOT_GENERATED_AT: snapshot.generatedAt,
    MATERIAL_SNAPSHOT_DIGEST: snapshot.digest,
    MATERIAL_SNAPSHOT_COUNT_CONTACTS: String(snapshot.counts.contacts),
    MATERIAL_SNAPSHOT_COUNT_EVENTS: String(snapshot.counts.events),
    MATERIAL_SNAPSHOT_COUNT_CALENDAR: String(snapshot.counts.calendar)
  });
}

function refreshMaterialSnapshotAtLocked_(now, allowMigrationStaging) {
  return refreshMaterialSnapshotAtUnlocked_(now, allowMigrationStaging);
}

function refreshMaterialSnapshotAt_(now) {
  return withMaterialLock_(function () {
    return refreshMaterialSnapshotAtLocked_(now);
  }, false);
}

function refreshMaterialSnapshot() {
  return refreshMaterialSnapshotAt_(new Date());
}

function readMaterialSnapshot_() {
  assertMigrationPublicReady_();
  var encoded = CacheService.getScriptCache().get(MATERIAL_SNAPSHOT_CACHE_KEY);
  if (encoded) return decodeSnapshot_(encoded);
  return refreshMaterialSnapshot();
}

function installMaterialSnapshotTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'refreshMaterialSnapshot') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('refreshMaterialSnapshot')
    .timeBased()
    .everyHours(1)
    .create();
  return refreshMaterialSnapshot();
}

// BEGIN GENERATED FIELD GOALS
(function(root){
  'use strict';
  var keys=['orientation','introductions','individual','first_individual','new_friends'];
  var personMetrics=['orientation','first_individual','new_friends'];
  var statuses=['proposed','confirmed','completed','postponed','cancelled'];
  function empty(){return {goals:{},persons:[],records:[],missions:[]};}
  function date(s){return typeof s==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
  function month(s){return typeof s==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(s);}
  function validate(input){
    if(!input||!input.goals||typeof input.goals!=='object'||Array.isArray(input.goals)||!Array.isArray(input.persons)||!Array.isArray(input.records)||input.persons.length>200||input.records.length>300)throw Error('目標・行動データが不正です');
    var data=empty(),ids=new Set(),names=new Set();
    input.persons.forEach(function(p){if(!p||typeof p.id!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||names.has(p.name)||p.name.length>200||!Number.isInteger(p.row)||p.row<2)throw Error('人物IDが不正です');ids.add(p.id);names.add(p.name);data.persons.push({id:p.id,name:p.name,row:p.row});});
    if(Object.keys(input.goals).length>120)throw Error('目標月が多すぎます');
    Object.keys(input.goals).forEach(function(m){var g=input.goals[m];if(!month(m)||!g||typeof g!=='object')throw Error('目標月が不正です');var out={prospects:null,metrics:{}};if(g.prospects!==null&&(!Number.isInteger(g.prospects)||g.prospects<1||g.prospects>10000))throw Error('人数目標が不正です');out.prospects=g.prospects;keys.forEach(function(k){var n=g.metrics&&g.metrics[k];if(n!==null&&n!==undefined&&(!Number.isInteger(n)||n<1||n>10000))throw Error('指標目標が不正です');out.metrics[k]=n===undefined?null:n;});data.goals[m]=out;});
    var records=new Set();input.records.forEach(function(r){if(!r||typeof r.id!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(r.id)||records.has(r.id)||!ids.has(r.personId)||!keys.includes(r.kind)||!statuses.includes(r.status)||!date(r.date)||!date(r.dueDate)||typeof r.purpose!=='string'||!r.purpose.trim()||r.purpose.length>500||typeof r.outcomeConfirmed!=='boolean'||typeof r.newPersonForMonth!=='boolean')throw Error('行動記録が不正です');if(r.outcomeConfirmed&&(r.kind!=='introductions'||r.status!=='completed'))throw Error('紹介につながった確認は紹介の実施後に記録してください');records.add(r.id);data.records.push({id:r.id,personId:r.personId,kind:r.kind,status:r.status,date:r.date,dueDate:r.dueDate,purpose:r.purpose,outcomeConfirmed:r.outcomeConfirmed,newPersonForMonth:r.newPersonForMonth});});
    var missions=input.missions===undefined?[]:input.missions,missionIds=new Set();
    if(!Array.isArray(missions)||missions.length>120)throw Error('週ミッションが不正です');
    missions.forEach(function(w){
      if(!w||!month(w.month)||!date(w.weekStart)||new Date(w.weekStart+'T00:00:00Z').getUTCDay()!==1||!date(w.startDate)||w.startDate.slice(0,7)!==w.month||w.startDate<w.weekStart||w.startDate>weekEnd(w.weekStart)||w.id!==w.weekStart+'@'+w.month||missionIds.has(w.id)||!w.targets||!w.baseline)throw Error('週ミッションの日付が不正です');
      var targets={},baseline={recordIds:[],personIds:{}};
      ['prospects'].concat(keys).forEach(function(k){var n=w.targets[k];if(n!==null&&(!Number.isInteger(n)||n<0||n>10000))throw Error('週ミッション目標が不正です');targets[k]=n;var p=w.baseline.personIds&&w.baseline.personIds[k];if(!Array.isArray(p)||p.some(function(id){return !ids.has(id);})||new Set(p).size!==p.length)throw Error('週ミッション人物が不正です');baseline.personIds[k]=p.slice();});
      var b=w.baseline.recordIds;if(!Array.isArray(b)||b.some(function(id){return !records.has(id);})||new Set(b).size!==b.length)throw Error('週ミッション記録が不正です');baseline.recordIds=b.slice();missionIds.add(w.id);data.missions.push({id:w.id,month:w.month,weekStart:w.weekStart,startDate:w.startDate,targets:targets,baseline:baseline});
    });
    return data;
  }
  function count(rows,k){return personMetrics.includes(k)?new Set(rows.map(function(r){return r.personId;})).size:rows.length;}
  function weekStart(today){var d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
  function weekEnd(start){var d=new Date(start+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+6);return d.toISOString().slice(0,10);}
  function missionBaseline(data,m,today){
    var completed=data.records.filter(function(r){return r.status==='completed'&&r.date<=today&&r.date.slice(0,7)===m;}),baseline={recordIds:completed.map(function(r){return r.id;}),personIds:{}};
    baseline.personIds.prospects=Array.from(new Set(completed.filter(function(r){return r.kind==='introductions'&&r.outcomeConfirmed;}).map(function(r){return r.personId;})));
    keys.forEach(function(k){baseline.personIds[k]=Array.from(new Set(completed.filter(function(r){return r.kind===k;}).map(function(r){return r.personId;})));});return baseline;
  }
  function createMission(input,report,m,today){
    var data=validate(input),s=summarize(data,report,m,today),start=weekStart(today);
    if(m!==today.slice(0,7)||data.missions.some(function(w){return w.id===start+'@'+m;}))throw Error('今週ミッションは設定済み、または今月ではありません');
    var baseline=missionBaseline(data,m,today),targets={prospects:s.remaining===null?null:Math.ceil(s.remaining*s.weekDays/s.remainingDays)};
    keys.forEach(function(k){targets[k]=s.metrics[k].weekly;});
    if(!Object.values(targets).some(function(n){return n>0;}))throw Error('必要数が確認できる新しいミッションはありません');
    data.missions.push({id:start+'@'+m,month:m,weekStart:start,startDate:today,targets:targets,baseline:baseline});return validate(data);
  }
  function missionSummary(data,w,today){
    var rows=data.records.filter(function(r){return r.status==='completed'&&r.date>=w.startDate&&r.date<=today&&r.date<=weekEnd(w.weekStart)&&r.date.slice(0,7)===w.month&&!w.baseline.recordIds.includes(r.id);}),actual={};
    actual.prospects=new Set(rows.filter(function(r){return r.kind==='introductions'&&r.outcomeConfirmed&&!w.baseline.personIds.prospects.includes(r.personId);}).map(function(r){return r.personId;})).size;
    keys.forEach(function(k){var eligible=rows.filter(function(r){return r.kind===k&&(!personMetrics.includes(k)||(r.newPersonForMonth&&!w.baseline.personIds[k].includes(r.personId)));});actual[k]=count(eligible,k);});
    var required=Object.keys(w.targets).filter(function(k){return w.targets[k]>0;});return {actual:actual,required:required,achieved:required.length>0&&required.every(function(k){return actual[k]>=w.targets[k];})};
  }
  function summarize(data,report,m,today){
    data=validate(data);if(!month(m)||!date(today))throw Error('集計日が不正です');
    var records=data.records.filter(function(r){return r.date.slice(0,7)===m;});
    var completed=records.filter(function(r){return r.status==='completed'&&r.date<=today;}),prospects=new Set(completed.filter(function(r){return r.kind==='introductions'&&r.outcomeConfirmed;}).map(function(r){return r.personId;}));
    var g=data.goals[m],target=g?g.prospects:m===today.slice(0,7)?3:null;
    var end=new Date(m+'-01T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);var endDate=end.toISOString().slice(0,10);
    var remainingDays=m<today.slice(0,7)?0:Math.round((end-new Date((m===today.slice(0,7)?today:m+'-01')+'T00:00:00Z'))/86400000)+1;
    var untilSunday=7-((new Date(today+'T00:00:00Z').getUTCDay()+6)%7),weekDays=m===today.slice(0,7)?Math.min(remainingDays,untilSunday):Math.min(remainingDays,7);
    var confirmed=records.filter(function(r){return r.status==='confirmed'&&r.date>=today&&r.date<=endDate;});
    var futurePeople=new Set(confirmed.filter(function(r){return r.kind==='introductions'&&!prospects.has(r.personId);}).map(function(r){return r.personId;}));
    var metrics={};keys.forEach(function(k){
      var base=report&&report.values?report.values[k]:null;base=Number.isInteger(base)&&base>=0?base:null;
      var goal=g?g.metrics[k]:report&&report.goals?report.goals[k]:null;goal=Number.isInteger(goal)&&goal>0?goal:null;
      var rows=completed.filter(function(r){return r.kind===k;}),extra=rows.filter(function(r){return report&&date(report.activityDate)&&r.date>report.activityDate&&(!personMetrics.includes(k)||r.newPersonForMonth);});
      var held=rows.length-extra.length,additional=count(extra,k),actual=base===null?null:base+additional,gap=actual===null||goal===null?null:Math.max(0,goal-actual);
      var booked=confirmed.filter(function(r){return r.kind===k;}),bookedCount=count(booked,k);
      var eligible=booked.filter(function(r){return report&&date(report.activityDate)&&r.date>report.activityDate&&(!personMetrics.includes(k)||r.newPersonForMonth);});
      if(personMetrics.includes(k)){var extraIds=new Set(extra.map(function(r){return r.personId;}));eligible=eligible.filter(function(r){return !extraIds.has(r.personId);});}
      var secured=count(eligible,k);
      metrics[k]={reported:base,additional:additional,held:held,actual:actual,goal:goal,gap:gap,weekly:gap===null||remainingDays===0?null:Math.ceil(gap*weekDays/remainingDays),confirmed:bookedCount,secured:secured,unsecured:gap===null?null:Math.max(0,gap-secured),conditional:actual===null?null:actual+secured};
    });
    return {month:m,target:target,prospects:prospects.size,remaining:target===null?null:Math.max(0,target-prospects.size),conditionalProspects:prospects.size+futurePeople.size,metrics:metrics,records:records,weekDays:weekDays,remainingDays:remainingDays,actions:records.filter(function(r){return ['proposed','confirmed'].includes(r.status)&&r.dueDate<=today;})};
  }
  var model={keys:keys,personMetrics:personMetrics,statuses:statuses,empty:empty,validate:validate,date:date,month:month,summarize:summarize,weekStart:weekStart,weekEnd:weekEnd,createMission:createMission,missionSummary:missionSummary,missionBaseline:missionBaseline};
  if(typeof module!=='undefined'&&module.exports)module.exports=model;else root.FieldGoalsModel=model;
})(typeof globalThis!=='undefined'?globalThis:this);

// Private state is stored only in the owner's spreadsheet, never in a public JSON.
var FIELD_GOALS_SHEET_NAME = '目標達成管理';
var FIELD_GOALS_HEADERS = ['状態JSON', '更新番号', '最終リクエストID', '最終要求SHA256'];
var FIELD_GOALS_CHUNK_SIZE = 20000;
var FIELD_GOALS_MAX_CHARACTERS = 1000000;
function setupFieldGoalsSheet() {
  return withMaterialLock_(function(){
    var book=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID),sh=book.getSheetByName(FIELD_GOALS_SHEET_NAME);
    if(!sh)sh=book.insertSheet(FIELD_GOALS_SHEET_NAME);
    if(sh.getLastRow()>0){
      if(!fieldGoalsReady_(sh))throw Error('目標達成管理には既存データがあります。設定を中止しました。');
      fieldGoalsRead_();return {ok:true,sheet:FIELD_GOALS_SHEET_NAME,alreadyReady:true};
    }
    sh.getRange(1,1,1,4).setValues([FIELD_GOALS_HEADERS]);
    sh.getRange(2,1,1,4).setValues([[JSON.stringify(FieldGoalsModel.empty()),0,'','']]);SpreadsheetApp.flush();
    return {ok:true,sheet:FIELD_GOALS_SHEET_NAME};
  });
}
function fieldGoalsReady_(sh){var h=sh.getRange(1,1,1,4).getValues()[0];return FIELD_GOALS_HEADERS.every(function(v,i){return h[i]===v;});}
function fieldGoalsDigest_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function fieldGoalsSnapshot_(){
  var sh=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(FIELD_GOALS_SHEET_NAME);
  if(!sh||!fieldGoalsReady_(sh))throw Error('field goals not ready');
  var rows=sh.getRange(2,1,Math.max(1,sh.getLastRow()-1),4).getValues(),cells=rows[0];
  if(rows.slice(1).some(function(r){return r.slice(1).some(function(v){return v!=='';});}))throw Error('目標管理の保存範囲に別のデータがあります。確認してください');
  if(!Number.isInteger(cells[1])||cells[1]<0)throw Error('目標管理の更新番号が不正です');
  var raw=rows.map(function(r){return String(r[0]||'');}).join('');if(raw.length>FIELD_GOALS_MAX_CHARACTERS)throw Error('目標管理の保存上限です');
  var data=FieldGoalsModel.validate(JSON.parse(raw));
  return {sheet:sh,cells:cells,rowCount:rows.length,state:data,version:fieldGoalsDigest_(raw+'\n'+cells[1])};
}
function fieldGoalsRead_(){var s=fieldGoalsSnapshot_();return {ok:true,state:s.state,version:s.version,requestId:s.cells[2]||''};}
function fieldGoalsWrite_(body){
  var s=fieldGoalsSnapshot_();
  if(typeof body.requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId))return {ok:false,error:'invalid request'};
  var data=FieldGoalsModel.validate(body.state),serialized=JSON.stringify(data),digest=fieldGoalsDigest_(serialized);
  if(serialized.length>FIELD_GOALS_MAX_CHARACTERS)return {ok:false,error:'capacity',message:'記録の保存上限です。管理者に確認してください。'};
  if(s.cells[2]===body.requestId){if(s.cells[3]!==digest)return {ok:false,error:'request mismatch'};return fieldGoalsRead_();}
  if(!body.version)return {ok:false,error:'version required'};
  if(body.version!==s.version)return {ok:false,error:'conflict',state:s.state,version:s.version};
  var today=Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd');
  if(data.records.some(function(r){return r.status==='completed'&&r.date>today;}))return {ok:false,error:'future completion',message:'未来の日付を実施済みにできません。予定として保存してください。'};
  var newPeople=data.persons.filter(function(p){return !s.state.persons.some(function(old){return old.id===p.id;});});
  if(newPeople.length){var contacts=readContacts_();if(newPeople.some(function(p){return contacts.filter(function(c){return c['名前(あだ名)']===p.name;}).length!==1;}))return {ok:false,error:'person unknown',message:'新しい人物IDの対象を人脈リストで一意に確認できません。最新データを確認してください。'};}
  if(s.state.persons.some(function(p){return !data.persons.some(function(x){return x.id===p.id&&x.name===p.name;});}))return {ok:false,error:'identity changed'};
  if(s.state.records.some(function(r){return !data.records.some(function(x){return x.id===r.id&&x.personId===r.personId;});}))return {ok:false,error:'record removed',message:'記録は削除せず、取消として残してください。'};
  if(s.state.missions.some(function(w){return !data.missions.some(function(x){return x.id===w.id&&JSON.stringify(x)===JSON.stringify(w);});}))return {ok:false,error:'mission changed',message:'確定した週ミッションは変更・削除せず残してください。'};
  if(data.missions.some(function(w){return !s.state.missions.some(function(x){return x.id===w.id;})&&w.startDate!==today;}))return {ok:false,error:'invalid mission date'};
  if(data.missions.some(function(w){return !s.state.missions.some(function(x){return x.id===w.id;})&&JSON.stringify(w.baseline)!==JSON.stringify(FieldGoalsModel.missionBaseline(data,w.month,today));}))return {ok:false,error:'invalid mission baseline'};
  var chunks=[];for(var offset=0;offset<serialized.length;offset+=FIELD_GOALS_CHUNK_SIZE)chunks.push(serialized.slice(offset,offset+FIELD_GOALS_CHUNK_SIZE));
  var count=Math.max(chunks.length,s.rowCount),matrix=[];for(var i=0;i<count;i++)matrix.push([chunks[i]||'',i===0?s.cells[1]+1:'',i===0?body.requestId:'',i===0?digest:'']);
  if(s.sheet.getMaxRows&&s.sheet.getMaxRows()<count+1)s.sheet.insertRowsAfter(s.sheet.getMaxRows(),count+1-s.sheet.getMaxRows());
  s.sheet.getRange(2,1,count,4).setValues(matrix);SpreadsheetApp.flush();
  return fieldGoalsRead_();
}
// END GENERATED FIELD GOALS
