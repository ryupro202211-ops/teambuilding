
let EVENT_EDITOR_EVENT = null;
let EVENT_PENDING_REQUEST_ID = null;
let EVENT_SAVE_BUSY = false;
let EVENT_STATUS_BUSY = false;
let EVENT_DELETE_BUSY = false;
let EVENT_REFRESH_BUSY = false;
let EVENT_REFRESH_PROMISE = null;
let EVENTS_FRESH = false;
let EVENT_MUTATION_BUSY = false;
let EVENT_REVISION = 0;
let EVENT_SYNC_MESSAGE = "";
let EVENT_LAST_FETCHED_AT = null;
let EVENT_BUSY_ACTION = "";
let EVENT_BUSY_EVENT_ID = "";
let EVENT_BUSY_STATUS = "";

const EVENTS = [{"d":"8/15","dow":"土","t":"19:00-21:00","place":"浜松町","title":"VELTイベント","id":"evt_a0ac657612f44609a95d0ec7b61a6de7","status":"公開","date":"2026-08-15","startTime":"19:00","endTime":"21:00","updatedAt":"2026-09-23T07:41:51+09:00","version":1,"theme":"交流飲み会"},{"d":"10/21","dow":"水","t":"20:00-22:00","place":"田町","title":"モルック","id":"evt_65a62d4927274ffb95fded8d54d9dd77","status":"公開","date":"2026-10-21","startTime":"20:00","endTime":"22:00","updatedAt":"2026-09-26T07:45:00+09:00","version":2,"sheet":"https://docs.google.com/spreadsheets/d/1zU2jpYg-bhG7z3sgZ-Ba74T1NlohMXXsr-SZeRvwQV0/edit?gid=1036230069#gid=1036230069"},{"d":"10/11","dow":"日","t":"19:00-21:00","place":"大井町","title":"バスケ","id":"evt_9fecb72cbcc14073a52b85a521399e33","status":"公開","date":"2026-10-11","startTime":"19:00","endTime":"21:00","updatedAt":"2026-09-24T12:02:37+09:00","version":3,"sheet":"https://docs.google.com/spreadsheets/d/1l5kSQWDCXu-LOXqKFOI0asoCDAdNxIDdrixRkBDjmHI/edit?usp=sharing"},{"d":"9/9","dow":"水","t":"20:20-22:30","place":"","title":"ライフデザイン講演会","id":"evt_0425f186c193417cba3e6f5955634933","status":"終了","date":"2026-09-09","startTime":"20:20","endTime":"22:30","updatedAt":"2026-09-23T09:09:15+09:00","version":2},{"d":"9/11","dow":"金","t":"19:30-21:30","place":"","title":"経営者交流会","id":"evt_05680823989f4804b1977fc7ffd88894","status":"終了","date":"2026-09-11","startTime":"19:30","endTime":"21:30","updatedAt":"2026-09-23T09:54:40+09:00","version":2,"sheet":"https://docs.google.com/spreadsheets/d/19B0f6nlUDdB0I_Z3ysMybJadm_m9DYMpved_Ct3AQ94/edit?gid=1464281630#gid=1464281630"},{"d":"9/19","dow":"土","t":"19:00-21:00","place":"浜松町","title":"VELTイベント","id":"evt_06af5a983b064b33949a27ca70a42002","status":"公開","date":"2026-09-19","startTime":"19:00","endTime":"21:00","updatedAt":"2026-09-23T07:41:59+09:00","version":1,"theme":"交流飲み会"},{"d":"9/20","dow":"日","t":"15:20-17:30","place":"","title":"ライフデザイン講演会","id":"evt_8d0c2ef01f4e4e4cb57d91057b1c85d0","status":"終了","date":"2026-09-20","startTime":"15:20","endTime":"17:30","updatedAt":"2026-09-23T09:10:08+09:00","version":2,"theme":"100年時代を生き抜くために"},{"d":"10/16","dow":"金","t":"20:00-22:00","place":"","title":"情熱飲み会","id":"evt_e2f732d4e45849c897f332e3eec0da34","status":"公開","date":"2026-10-16","startTime":"20:00","endTime":"22:00","updatedAt":"2026-09-23T09:44:20+09:00","version":2,"theme":"人生について熱く語ろう","sheet":"https://docs.google.com/spreadsheets/d/14CI9w29iOY6HlGDcvXDcAbZpFOOnaQSRxZ5zRp3jzPc/edit?usp=sharing"},{"d":"9/21","dow":"月","t":"19:00-21:00","place":"麻布十番","title":"元料理人による料理イベント","id":"evt_5020572547ea4965a3f0eab272595f22","status":"公開","date":"2026-09-21","startTime":"19:00","endTime":"21:00","updatedAt":"2026-09-23T21:33:40+09:00","version":4,"theme":"BBQ","sheet":"https://docs.google.com/spreadsheets/d/1_XZUNZ2XNG22eCBX01_JAiaIxKfYjNhBgGPXsjObIhM/edit?gid=1585000073#gid=1585000073"},{"d":"9/22","dow":"火","t":"","place":"","title":"農業イベント","id":"evt_1ee6811700b047a5b2b5310e628ffb1d","status":"公開","date":"2026-09-22","startTime":"","endTime":"","updatedAt":"2026-09-23T07:42:03+09:00","version":1},{"d":"9/23","dow":"水","t":"","place":"","title":"農業イベント","id":"evt_c6ef3f7dfc9b49ea880b7f7990052279","status":"終了","date":"2026-09-23","startTime":"","endTime":"","updatedAt":"2026-09-23T09:56:58+09:00","version":2},{"d":"10/25","dow":"日","t":"19:00-21:30","place":"浜松町","title":"経済ボードゲーム","id":"evt_758cabcb4bb4455a895dc61f61927122","status":"公開","date":"2026-10-25","startTime":"19:00","endTime":"21:30","updatedAt":"2026-09-23T09:58:06+09:00","version":2,"sheet":"https://docs.google.com/spreadsheets/d/1t4pFIe7DIZp1CtOMpPC_4_c9l0C_T8aUfpwyxyYxR1A/edit?gid=1298988464#gid=1298988464"},{"d":"10/7","dow":"水","t":"20:20-22:30","place":"","title":"ライフデザイン講演会","id":"evt_de844eed247145679a39723c832162ff","status":"公開","date":"2026-10-07","startTime":"20:20","endTime":"22:30","updatedAt":"2026-09-23T07:42:07+09:00","version":1,"theme":"100年時代を生き抜くために"},{"d":"10/8","dow":"木","t":"19:30-21:30","place":"","title":"経営者交流会","id":"evt_30c6ef6e98df473ebb692473e1ab106a","status":"公開","date":"2026-10-08","startTime":"19:30","endTime":"21:30","updatedAt":"2026-09-23T07:42:08+09:00","version":1,"sheet":"https://docs.google.com/spreadsheets/d/19B0f6nlUDdB0I_Z3ysMybJadm_m9DYMpved_Ct3AQ94/edit?gid=1464281630#gid=1464281630"},{"d":"10/10","dow":"土","t":"20:00-22:00","place":"田町","title":"楽SAKEイベント","id":"evt_c66aab6e5a524d2f9ad774630f63161f","status":"公開","date":"2026-10-10","startTime":"20:00","endTime":"22:00","updatedAt":"2026-09-23T07:42:11+09:00","version":1,"theme":"運動会×飲み会","url":"https://ryupro202211-ops.github.io/rakusake/events/undoukai-2026-10-10","sheet":"https://docs.google.com/spreadsheets/d/130xD5b-IKs2UrLXuAZ1ATpnG_DO1qoVtbluDPmYxJ9s/edit?gid=1488195776#gid=1488195776"},{"d":"10/10","dow":"土","t":"19:00-21:00","place":"東陽町","title":"フットサル","id":"evt_5c0b128990f04b83b14c68855635c86c","status":"終了","date":"2026-10-10","startTime":"19:00","endTime":"21:00","updatedAt":"2026-09-23T09:55:16+09:00","version":2,"sheet":"https://docs.google.com/spreadsheets/d/1kJdxNzkMFhMDwwyq0bH3lTPmOfMh0oEUIMHS4OyKG04/edit?gid=271777000#gid=271777000"},{"d":"10/18","dow":"日","t":"15:20-17:30","place":"","title":"ライフデザイン講演会","id":"evt_ce3ec6f7acd8484b86af566d7909d313","status":"公開","date":"2026-10-18","startTime":"15:20","endTime":"17:30","updatedAt":"2026-09-23T07:42:13+09:00","version":1,"theme":"100年時代を生き抜くために"},{"d":"10/31","dow":"土","t":"11:00-18:00","place":"","title":"イタリア街ハロウィン","id":"evt_1699cecffba041c6aec4fda96d7da07d","status":"公開","date":"2026-10-31","startTime":"11:00","endTime":"18:00","updatedAt":"2026-09-23T07:42:14+09:00","version":1},{"d":"11/3","dow":"火","t":"15:00-20:00","place":"池尻大橋","title":"リプキャン","id":"evt_f8b071e355f4483aac380c2d95a7f065","status":"公開","date":"2026-11-03","startTime":"15:00","endTime":"20:00","updatedAt":"2026-09-25T22:35:53+09:00","version":4,"theme":"大人の学園祭","url":"https://www.instagram.com/re_campus_events_/"},{"d":"10/17","dow":"土","t":"19:00-22:00","place":"麻布十番","title":"元料理人による料理イベント","id":"evt_1123299fb3104ca18a1d0741f14c0fe7","status":"公開","date":"2026-10-17","startTime":"19:00","endTime":"22:00","updatedAt":"2026-09-25T09:34:45+09:00","version":2,"theme":"ピザ","sheet":"https://docs.google.com/spreadsheets/d/1_XZUNZ2XNG22eCBX01_JAiaIxKfYjNhBgGPXsjObIhM/edit?gid=1585000073#gid=1585000073"},{"d":"10/18","dow":"日","t":"19:00-21:00","place":"大井町","title":"バスケ","id":"evt_7c46de9a6f644685af73214f81da1be4","status":"公開","date":"2026-10-18","startTime":"19:00","endTime":"21:00","updatedAt":"2026-09-26T07:43:56+09:00","version":1,"sheet":"https://docs.google.com/spreadsheets/d/1l5kSQWDCXu-LOXqKFOI0asoCDAdNxIDdrixRkBDjmHI/edit?usp=sharing"}];

/* 🕒 空いてる1.5h枠（カレンダー下に表示）。毎朝のビルドでGoogleカレンダーから再計算して差し替える。
   平日=昼12:00-13:30／夜18:00-24:00、土日=8:00-24:00 の中で連続1.5h空いている枠を並べる。 */
const FREE_SLOTS = [{"d":"10/2","dow":"金","t":"12:00-13:30"},{"d":"10/2","dow":"金","t":"18:00-19:30"},{"d":"10/2","dow":"金","t":"21:00-22:30"},{"d":"10/2","dow":"金","t":"22:30-24:00"},{"d":"10/5","dow":"月","t":"12:00-13:30"},{"d":"10/5","dow":"月","t":"18:00-19:30"},{"d":"10/6","dow":"火","t":"12:00-13:30"},{"d":"10/6","dow":"火","t":"18:00-19:30"},{"d":"10/7","dow":"水","t":"12:00-13:30"},{"d":"10/7","dow":"水","t":"18:00-19:30"},{"d":"10/8","dow":"木","t":"12:00-13:30"},{"d":"10/8","dow":"木","t":"18:00-19:30"},{"d":"10/9","dow":"金","t":"12:00-13:30"},{"d":"10/9","dow":"金","t":"18:00-19:30"},{"d":"10/9","dow":"金","t":"19:30-21:00"},{"d":"10/9","dow":"金","t":"21:00-22:30"},{"d":"10/9","dow":"金","t":"22:30-24:00"},{"d":"10/10","dow":"土","t":"08:00-09:30"},{"d":"10/10","dow":"土","t":"09:30-11:00"},{"d":"10/10","dow":"土","t":"15:00-16:30"},{"d":"10/10","dow":"土","t":"16:30-18:00"},{"d":"10/10","dow":"土","t":"18:00-19:30"},{"d":"10/10","dow":"土","t":"21:30-23:00"},{"d":"10/11","dow":"日","t":"09:30-11:00"},{"d":"10/11","dow":"日","t":"17:00-18:30"},{"d":"10/11","dow":"日","t":"18:30-20:00"},{"d":"10/11","dow":"日","t":"20:00-21:30"},{"d":"10/11","dow":"日","t":"21:30-23:00"},{"d":"10/12","dow":"月","t":"12:00-13:30"},{"d":"10/12","dow":"月","t":"18:00-19:30"},{"d":"10/12","dow":"月","t":"19:30-21:00"},{"d":"10/12","dow":"月","t":"21:00-22:30"},{"d":"10/12","dow":"月","t":"22:30-24:00"},{"d":"10/13","dow":"火","t":"12:00-13:30"},{"d":"10/13","dow":"火","t":"18:00-19:30"},{"d":"10/13","dow":"火","t":"19:30-21:00"},{"d":"10/14","dow":"水","t":"12:00-13:30"},{"d":"10/14","dow":"水","t":"18:00-19:30"},{"d":"10/14","dow":"水","t":"19:30-21:00"},{"d":"10/14","dow":"水","t":"21:00-22:30"},{"d":"10/16","dow":"金","t":"12:00-13:30"},{"d":"10/16","dow":"金","t":"18:00-19:30"},{"d":"10/16","dow":"金","t":"22:00-23:30"},{"d":"10/17","dow":"土","t":"08:00-09:30"},{"d":"10/17","dow":"土","t":"13:00-14:30"},{"d":"10/17","dow":"土","t":"14:30-16:00"},{"d":"10/17","dow":"土","t":"16:00-17:30"},{"d":"10/17","dow":"土","t":"17:30-19:00"},{"d":"10/17","dow":"土","t":"19:00-20:30"},{"d":"10/17","dow":"土","t":"20:30-22:00"},{"d":"10/17","dow":"土","t":"22:00-23:30"},{"d":"10/18","dow":"日","t":"08:00-09:30"},{"d":"10/18","dow":"日","t":"13:45-15:15"},{"d":"10/18","dow":"日","t":"15:15-16:45"},{"d":"10/18","dow":"日","t":"16:45-18:15"},{"d":"10/18","dow":"日","t":"18:15-19:45"},{"d":"10/18","dow":"日","t":"19:45-21:15"},{"d":"10/18","dow":"日","t":"21:15-22:45"},{"d":"10/19","dow":"月","t":"12:00-13:30"},{"d":"10/19","dow":"月","t":"18:00-19:30"},{"d":"10/19","dow":"月","t":"19:30-21:00"},{"d":"10/19","dow":"月","t":"21:00-22:30"},{"d":"10/19","dow":"月","t":"22:30-24:00"},{"d":"10/20","dow":"火","t":"12:00-13:30"},{"d":"10/20","dow":"火","t":"18:00-19:30"},{"d":"10/20","dow":"火","t":"19:30-21:00"},{"d":"10/20","dow":"火","t":"21:00-22:30"},{"d":"10/20","dow":"火","t":"22:30-24:00"},{"d":"10/21","dow":"水","t":"12:00-13:30"},{"d":"10/21","dow":"水","t":"18:00-19:30"},{"d":"10/22","dow":"木","t":"12:00-13:30"},{"d":"10/22","dow":"木","t":"18:00-19:30"},{"d":"10/22","dow":"木","t":"19:30-21:00"},{"d":"10/22","dow":"木","t":"21:00-22:30"},{"d":"10/23","dow":"金","t":"12:00-13:30"},{"d":"10/23","dow":"金","t":"18:00-19:30"},{"d":"10/23","dow":"金","t":"19:30-21:00"},{"d":"10/23","dow":"金","t":"21:00-22:30"},{"d":"10/23","dow":"金","t":"22:30-24:00"},{"d":"10/24","dow":"土","t":"08:00-09:30"},{"d":"10/24","dow":"土","t":"13:00-14:30"},{"d":"10/24","dow":"土","t":"14:30-16:00"},{"d":"10/24","dow":"土","t":"16:00-17:30"},{"d":"10/24","dow":"土","t":"17:30-19:00"},{"d":"10/24","dow":"土","t":"19:00-20:30"},{"d":"10/24","dow":"土","t":"20:30-22:00"},{"d":"10/24","dow":"土","t":"22:00-23:30"},{"d":"10/25","dow":"日","t":"08:00-09:30"},{"d":"10/25","dow":"日","t":"13:00-14:30"},{"d":"10/26","dow":"月","t":"12:00-13:30"},{"d":"10/26","dow":"月","t":"18:00-19:30"},{"d":"10/26","dow":"月","t":"19:30-21:00"},{"d":"10/26","dow":"月","t":"21:00-22:30"},{"d":"10/26","dow":"月","t":"22:30-24:00"},{"d":"10/27","dow":"火","t":"12:00-13:30"},{"d":"10/27","dow":"火","t":"18:00-19:30"},{"d":"10/27","dow":"火","t":"19:30-21:00"},{"d":"10/27","dow":"火","t":"21:00-22:30"},{"d":"10/27","dow":"火","t":"22:30-24:00"},{"d":"10/28","dow":"水","t":"12:00-13:30"},{"d":"10/28","dow":"水","t":"18:00-19:30"},{"d":"10/28","dow":"水","t":"19:30-21:00"},{"d":"10/28","dow":"水","t":"21:00-22:30"},{"d":"10/29","dow":"木","t":"12:00-13:30"},{"d":"10/29","dow":"木","t":"18:00-19:30"},{"d":"10/29","dow":"木","t":"19:30-21:00"},{"d":"10/29","dow":"木","t":"21:00-22:30"},{"d":"10/29","dow":"木","t":"22:30-24:00"},{"d":"10/30","dow":"金","t":"12:00-13:30"},{"d":"10/30","dow":"金","t":"18:00-19:30"},{"d":"10/30","dow":"金","t":"19:30-21:00"},{"d":"10/30","dow":"金","t":"21:00-22:30"},{"d":"10/30","dow":"金","t":"22:30-24:00"},{"d":"10/31","dow":"土","t":"08:00-09:30"},{"d":"10/31","dow":"土","t":"09:30-11:00"},{"d":"10/31","dow":"土","t":"15:00-16:30"},{"d":"10/31","dow":"土","t":"16:30-18:00"},{"d":"10/31","dow":"土","t":"18:00-19:30"},{"d":"10/31","dow":"土","t":"19:30-21:00"},{"d":"10/31","dow":"土","t":"21:00-22:30"},{"d":"10/31","dow":"土","t":"22:30-24:00"},{"d":"11/1","dow":"日","t":"08:00-09:30"},{"d":"11/1","dow":"日","t":"09:30-11:00"},{"d":"11/1","dow":"日","t":"17:00-18:30"},{"d":"11/1","dow":"日","t":"18:30-20:00"},{"d":"11/1","dow":"日","t":"20:00-21:30"},{"d":"11/1","dow":"日","t":"21:30-23:00"}];

function eventById(id){
  return EVENTS.find(function(e){ return String(e.id || "") === String(id || ""); }) || null;
}

function eventDateParts(date){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  return m ? { year:+m[1], month:+m[2], day:+m[3] } : null;
}

function eventUiDate(e){
  if(e.date) return e.date;
  var m = /^(\d{1,2})\/(\d{1,2})/.exec(String(e.d || ""));
  if(!m) return "";
  return new Date().getFullYear() + "-" + ("0"+m[1]).slice(-2) + "-" + ("0"+m[2]).slice(-2);
}

function eventUiTime(e){
  if(e.t) return e.t;
  if(e.startTime && e.endTime) return e.startTime + "-" + e.endTime;
  return e.startTime || "";
}

function eventToUi(e){
  if(!e || typeof e !== "object") return null;
  var date = eventUiDate(e), parts = eventDateParts(date), day = "";
  if(parts){
    var dt = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    day = ["日","月","火","水","木","金","土"][dt.getUTCDay()];
  }
  var out = Object.assign({}, e, {
    d: e.d || (parts ? parts.month + "/" + parts.day : ""),
    dow: e.dow || day,
    t: eventUiTime(e),
    place: e.place || "",
    sheet: e.sheet || e.sheetUrl || ""
  });
  if(!out.status) out.status = "公開";
  return out;
}

function isValidStructuredEventDate(value){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if(!m) return false;
  var date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return date.getUTCFullYear() === +m[1] && date.getUTCMonth() === +m[2] - 1 && date.getUTCDate() === +m[3];
}

function isValidStructuredEventTime(value){ return !value || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value)); }

function isValidStructuredHttpsUrl(value){
  return typeof value === "string" && value.length > 0 && value.length <= 500 && !/\s/.test(value) && /^https:\/\/\S+$/.test(value);
}

function validateStructuredEvents(events){
  if(!Array.isArray(events) || !events.length) return null;
  var ids = {};
  var normalized = [];
  for(var i = 0; i < events.length; i++){
    var e = events[i];
    if(!e || typeof e !== "object") return null;
    var id = String(e.id || "");
    if(!/^evt_[A-Za-z0-9_-]{16,76}$/.test(id) || ids[id]) return null;
    if(e.status !== "公開" && e.status !== "終了") return null;
    var title = typeof e.title === "string" ? e.title.trim() : "";
    if(e.theme != null && typeof e.theme !== "string") return null;
    if(e.place != null && typeof e.place !== "string") return null;
    if(typeof e.theme === "string" && e.theme.length > 120) return null;
    if(typeof e.place === "string" && e.place.length > 200) return null;
    if(!isValidStructuredEventDate(e.date) || !title || title.length > 120) return null;
    if(!isValidStructuredEventTime(e.startTime) || !isValidStructuredEventTime(e.endTime)) return null;
    if(e.endTime && !e.startTime) return null;
    if(e.startTime && e.endTime && e.endTime <= e.startTime) return null;
    if(e.url != null && e.url !== "" && !isValidStructuredHttpsUrl(e.url)) return null;
    if(e.sheetUrl != null && e.sheetUrl !== "" && (!isValidStructuredHttpsUrl(e.sheetUrl) || !/^https:\/\/docs\.google\.com\/spreadsheets\/.+$/.test(e.sheetUrl))) return null;
    if(!Object.prototype.hasOwnProperty.call(e, "version") || typeof e.version !== "number" || !Number.isInteger(e.version) || e.version <= 0) return null;
    ids[id] = true;
    normalized.push(eventToUi(e));
  }
  return normalized.length ? normalized : null;
}

function buildInviteText(){
  var blocks = [];
  document.querySelectorAll(".evchk").forEach(function(chk){
    if(!chk.checked) return;
    var e = chk.dataset.id ? eventById(chk.dataset.id) : EVENTS[+chk.dataset.i];
    if(!e) return;
    var head = "■" + e.title + (e.theme ? "（テーマ：" + e.theme + "）" : "");
    var when = (e.d || eventUiDate(e)) + "(" + (e.dow || "") + ") " + (e.t || eventUiTime(e)) + (e.place ? " @" + e.place : "");
    blocks.push(head + "\n" + when + (e.url ? "\n" + e.url : ""));
  });
  return blocks.join("\n\n");
}

function renderInvitePreview(){
  var preview = document.getElementById("invitePreview");
  if(!preview) return;
  var rows = [];
  document.querySelectorAll(".evchk:checked").forEach(function(chk){
    var e = chk.dataset.id ? eventById(chk.dataset.id) : EVENTS[+chk.dataset.i];
    if(!e) return;
    var title = "■" + e.title + (e.theme ? "（テーマ：" + e.theme + "）" : "");
    var when = (e.d || eventUiDate(e)) + "(" + (e.dow || "") + ") " + (e.t || eventUiTime(e)) + (e.place ? " @" + e.place : "");
    rows.push('<div class="invite-preview-item"><div class="invite-preview-title">' + esc(title) + '</div>'
      + '<div class="invite-preview-meta">' + esc(when) + '</div>'
      + (e.url ? '<div class="invite-preview-url">' + esc(e.url) + '</div>' : '') + '</div>');
  });
  preview.innerHTML = rows.length ? rows.join("") : '<div class="today-empty">イベントを選択してください。</div>';
}

function updateInvite(){
  document.getElementById("evText").value = buildInviteText();
  renderInvitePreview();
  var n = document.querySelectorAll(".evchk:checked").length;
  document.getElementById("evStatus").textContent = n + " 件選択中";
}

function copyInvite(){
  var ta = document.getElementById("evText");
  if(!ta.value){ document.getElementById("evStatus").textContent = "イベントが選択されていません"; return; }
  function done(){ document.getElementById("evStatus").textContent = "コピーしました ✓"; }
  function fallback(){
    var raw = document.getElementById("inviteRawDetails");
    if(raw) raw.open = true;
    ta.removeAttribute("readonly"); ta.focus(); ta.select();
    try { document.execCommand("copy"); done(); } catch(err){ document.getElementById("evStatus").textContent = "コピーできませんでした。テキストを手動で選択してください"; }
    ta.setAttribute("readonly","readonly");
  }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(ta.value).then(done, fallback);
  } else { fallback(); }
}

/* イベントの開催日。EVENTS の d は "M/D"（年なし・"9/22、23" のような複合もある）なので
   先頭の M/D だけ見る。今日より半年以上前になる場合は年をまたいだ翌年の予定とみなす
   （例：12月に見ている 1/5 は来年）。 */
function eventDate(e){
  if(e.date){
    var iso = eventDateParts(e.date);
    if(iso) return new Date(iso.year, iso.month - 1, iso.day);
  }
  var m = /^(\d{1,2})\/(\d{1,2})/.exec(String(e.d || ""));
  if(!m) return null;
  var today = new Date(); today.setHours(0,0,0,0);
  var dt = new Date(today.getFullYear(), +m[1]-1, +m[2]);
  dt.setHours(0,0,0,0);
  if((today - dt)/86400000 > 182) dt.setFullYear(dt.getFullYear()+1);
  return dt;
}

/* 過去の開催日は出さない。日付が読めないものは残す（消して気づけないより安全）。 */
function isUpcomingEvent(e){
  if(e.status === "終了") return false;
  var dt = eventDate(e);
  if(!dt) return true;
  var today = new Date(); today.setHours(0,0,0,0);
  return dt >= today;
}

function isPastPublicEvent(e){
  if(e.status === "終了") return false;
  var dt = eventDate(e);
  if(!dt) return false;
  var today = new Date(); today.setHours(0,0,0,0);
  return dt < today;
}

function sortEventItems(items){
  return items.sort(function(a, b){
    var aDate = eventDate(a.e), bDate = eventDate(b.e);
    var aTime = aDate ? aDate.getTime() : Number.POSITIVE_INFINITY;
    var bTime = bDate ? bDate.getTime() : Number.POSITIVE_INFINITY;
    return aTime - bTime || a.i - b.i;
  });
}

function eventFormHTML(){
  return '<div class="event-editor" id="eventEditor" hidden>'
    + '<h3 id="eventEditorTitle">イベントを追加</h3>'
    + '<div class="event-editor-grid">'
    + '<label>開催日（必須）<input id="eventDate" type="date" required></label>'
    + '<label>タイトル（必須）<input id="eventTitle" maxlength="120" required></label>'
    + '<label>開始時刻<input id="eventStartTime" type="time"></label>'
    + '<label>終了時刻<input id="eventEndTime" type="time"></label>'
    + '<label>テーマ<input id="eventTheme" maxlength="120"></label>'
    + '<label>場所<input id="eventPlace" maxlength="200"></label>'
    + '<label class="wide">案内URL（https://）<input id="eventUrl" type="url" maxlength="500"></label>'
    + '<label class="wide">集計シートURL（Googleスプレッドシート）<input id="eventSheetUrl" type="url" maxlength="500"></label>'
    + '</div>'
    + '<div class="event-editor-actions">'
    + '<button type="button" class="btn btn-primary" id="eventSave">保存</button>'
    + '<button type="button" class="btn" id="eventCancel">キャンセル</button>'
    + '<button type="button" class="ev-status-btn" id="eventStatusAction" hidden></button>'
    + '<button type="button" class="ev-delete-btn" id="eventDeleteAction" hidden>削除する</button>'
    + '<span class="event-editor-error" id="eventError" role="status" aria-live="polite"></span>'
    + '</div></div>';
}

function renderEventRows(items, ended, selectable){
  if(selectable == null) selectable = !ended;
  var editButtonUsed = false;
  var rows = items.map(function(x){
    var e = x.e, i = x.i;
    var editId = (selectable && !editButtonUsed && e.id) ? ' id="eventEdit"' : '';
    if(editId) editButtonUsed = true;
    var theme = e.theme ? '<span class="ev-theme">' + esc(e.theme) + '</span>' : "";
    var link = e.url ? '<a class="ev-link" href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.url) + '</a>' : "";
    var sheet = e.sheet ? '<div><a class="ev-sheet" href="' + esc(e.sheet) + '" target="_blank" rel="noopener">📊 集計シートを開く</a></div>' : "";
    return '<div class="ev">'
      + (selectable ? '<input type="checkbox" class="evchk" aria-label="' + esc((e.d || '') + ' ' + (e.title || '') + 'を招待文に含める') + '" data-id="' + esc(e.id || '') + '" data-i="' + i + '" checked>' : '')
      + '<div class="ev-date"><div class="ev-d">' + esc(e.d) + '</div><div class="ev-dow">(' + esc(e.dow) + ')</div></div>'
      + '<div class="ev-body">'
      + '<div class="ev-title">' + esc(e.title) + theme + '</div>'
      + '<div class="ev-meta">' + esc(e.t) + (e.place ? ' ・ ' + esc(e.place) : '') + '</div>'
      + link + sheet
      + (e.id ? '<div class="ev-actions"><button type="button" class="ev-edit"' + editId + ' data-event-edit="' + esc(e.id) + '">編集</button>'
        + '<button type="button" class="ev-status-btn" data-event-status="' + esc(e.id) + '" data-status="' + (ended ? '公開' : '終了') + '">' + (ended ? '再表示' : '終了にする') + '</button>'
        + '<button type="button" class="ev-delete-btn" data-event-delete="' + esc(e.id) + '">削除する</button></div>' : '')
      + '</div></div>';
  }).join("");
  return rows;
}

function renderEvents(){
  var editorState = captureEventEditorState();
  var all = EVENTS.map(function(e, i){ return { e: eventToUi(e), i: i }; });
  var upcoming = sortEventItems(all.filter(function(x){ return isUpcomingEvent(x.e); }));
  var past = sortEventItems(all.filter(function(x){ return isPastPublicEvent(x.e); }));
  var ended = sortEventItems(all.filter(function(x){ return x.e.status === "終了"; }));
  document.getElementById("events").innerHTML =
    '<div class="events-box">'
    + '<div class="events-head"><span class="chev">▶</span><span class="events-title">📅 今後のイベント</span><span class="events-count">' + upcoming.length + ' 件</span><button type="button" class="btn btn-primary events-add" id="eventAdd">イベントを追加</button></div>'
    + '<div class="events-body">' + renderEventRows(upcoming, false, true)
    + '<div class="ev-tools">'
    + '<button class="btn" id="evAll">全選択</button>'
    + '<button class="btn" id="evNone">全解除</button>'
    + '<button class="btn btn-primary" id="evCopy">お誘い用をコピー</button>'
    + '<span class="ev-status" id="evStatus"></span>'
    + '</div>'
    + '<div class="invite-preview" id="invitePreview" role="region" aria-label="お誘い文プレビュー"></div>'
    + '<details class="invite-raw" id="inviteRawDetails"><summary>コピーする文章を確認</summary><textarea class="ev-text" id="evText" readonly></textarea></details>'
    + '<div class="event-sync-row"><span class="event-sync-status" id="eventSyncStatus" role="status" aria-live="polite"></span>'
    + '<button type="button" class="btn" id="eventRefresh">最新情報を取得</button></div>'
    + '<details class="ended-events" id="pastEvents"><summary>過去の公開イベント（' + past.length + ' 件）</summary>' + renderEventRows(past, false, false) + '</details>'
    + '<details class="ended-events" id="endedEvents"><summary>終了済み（' + ended.length + ' 件）</summary>' + renderEventRows(ended, true, false) + '</details>'
    + eventFormHTML()
    + '</div></div>';
  document.querySelector(".events-head").addEventListener("click", function(){
    this.parentElement.classList.toggle("collapsed");
  });
  document.querySelectorAll(".evchk").forEach(function(chk){ chk.addEventListener("change", updateInvite); });
  document.getElementById("evAll").addEventListener("click", function(){ document.querySelectorAll(".evchk").forEach(function(c){ c.checked = true; }); updateInvite(); });
  document.getElementById("evNone").addEventListener("click", function(){ document.querySelectorAll(".evchk").forEach(function(c){ c.checked = false; }); updateInvite(); });
  document.getElementById("evCopy").addEventListener("click", copyInvite);
  document.getElementById("eventRefresh").addEventListener("click", function(){
    if(!getWriteToken() && !askWriteToken()) return;
    refreshEventsFromApi();
  });
  document.getElementById("eventAdd").addEventListener("click", function(e){ e.stopPropagation(); openEventEditor(); });
  document.querySelectorAll("[data-event-edit]").forEach(function(btn){ btn.addEventListener("click", function(){ openEventEditor(this.dataset.eventEdit); }); });
  document.querySelectorAll("[data-event-status]").forEach(function(btn){ btn.addEventListener("click", function(){ setEventStatus(this.dataset.eventStatus, this.dataset.status); }); });
  document.querySelectorAll("[data-event-delete]").forEach(function(btn){ btn.addEventListener("click", function(){ deleteEvent(this.dataset.eventDelete); }); });
  document.getElementById("eventSave").addEventListener("click", saveEventEditor);
  document.getElementById("eventCancel").addEventListener("click", closeEventEditor);
  document.getElementById("eventStatusAction").addEventListener("click", function(){
    if(EVENT_EDITOR_EVENT) setEventStatus(EVENT_EDITOR_EVENT.id, EVENT_EDITOR_EVENT.status === "終了" ? "公開" : "終了");
  });
  document.getElementById("eventDeleteAction").addEventListener("click", function(){
    if(EVENT_EDITOR_EVENT) deleteEvent(EVENT_EDITOR_EVENT.id);
  });
  updateInvite();
  showEventSyncStatus();
  syncEventRefreshButton();
  restoreEventEditorState(editorState);
  applyEventBusyLabels();
}

function eventRequestId(){
  try { if(window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch(ignore){}
  return "req_" + Date.now() + "_" + Math.random().toString(36).slice(2);
}

function eventMutationBusy(){
  return !!(EVENT_MUTATION_BUSY || EVENT_SAVE_BUSY || EVENT_STATUS_BUSY || EVENT_DELETE_BUSY);
}

function setEventBusyAction(action, id, status){
  EVENT_BUSY_ACTION = action || "";
  EVENT_BUSY_EVENT_ID = id || "";
  EVENT_BUSY_STATUS = status || "";
  applyEventBusyLabels();
}

function applyEventBusyLabels(){
  var save = document.getElementById("eventSave");
  if(save) save.textContent = EVENT_BUSY_ACTION === "save" ? "保存中…" : "保存";
  document.querySelectorAll("[data-event-status]").forEach(function(btn){
    var active = EVENT_BUSY_ACTION === "status" && btn.dataset.eventStatus === EVENT_BUSY_EVENT_ID;
    btn.textContent = active ? (EVENT_BUSY_STATUS === "終了" ? "終了処理中…" : "再表示中…") : (btn.dataset.status === "終了" ? "終了にする" : "再表示");
  });
  document.querySelectorAll("[data-event-delete]").forEach(function(btn){
    btn.textContent = EVENT_BUSY_ACTION === "delete" && btn.dataset.eventDelete === EVENT_BUSY_EVENT_ID ? "削除中…" : "削除する";
  });
  var statusAction = document.getElementById("eventStatusAction");
  if(statusAction && EVENT_EDITOR_EVENT){
    statusAction.textContent = EVENT_BUSY_ACTION === "status" && EVENT_BUSY_EVENT_ID === EVENT_EDITOR_EVENT.id
      ? (EVENT_BUSY_STATUS === "終了" ? "終了処理中…" : "再表示中…")
      : (EVENT_EDITOR_EVENT.status === "終了" ? "再表示" : "終了にする");
  }
  var deleteAction = document.getElementById("eventDeleteAction");
  if(deleteAction) deleteAction.textContent = EVENT_BUSY_ACTION === "delete" && EVENT_EDITOR_EVENT && EVENT_BUSY_EVENT_ID === EVENT_EDITOR_EVENT.id ? "削除中…" : "削除する";
}

function captureEventEditorState(){
  if(!eventMutationBusy()) return null;
  var editor = document.getElementById("eventEditor");
  if(!editor) return null;
  var ids = ["eventDate", "eventStartTime", "eventEndTime", "eventTitle", "eventTheme", "eventPlace", "eventUrl", "eventSheetUrl"];
  var values = {};
  ids.forEach(function(id){
    var input = document.getElementById(id);
    if(input) values[id] = input.value;
  });
  var statusAction = document.getElementById("eventStatusAction");
  return {
    hidden: !!editor.hidden,
    title: (document.getElementById("eventEditorTitle") || {}).textContent || "",
    editingEventId: EVENT_EDITOR_EVENT ? EVENT_EDITOR_EVENT.id : "",
    pendingRequestId: EVENT_PENDING_REQUEST_ID || "",
    values: values,
    error: (document.getElementById("eventError") || {}).textContent || "",
    statusHidden: statusAction ? !!statusAction.hidden : true,
    statusText: statusAction ? statusAction.textContent : "",
    editorDisabled: !!(document.getElementById("eventSave") && document.getElementById("eventSave").disabled),
    controlsDisabled: !!(document.getElementById("eventAdd") && document.getElementById("eventAdd").disabled)
  };
}

function restoreEventEditorState(state){
  if(!state) return;
  var editor = document.getElementById("eventEditor");
  if(!editor) return;
  editor.hidden = state.hidden;
  if(state.pendingRequestId) EVENT_PENDING_REQUEST_ID = state.pendingRequestId;
  Object.keys(state.values || {}).forEach(function(id){
    var input = document.getElementById(id);
    if(input) input.value = state.values[id];
  });
  var statusAction = document.getElementById("eventStatusAction");
  if(statusAction){
    statusAction.hidden = state.statusHidden;
    statusAction.textContent = state.statusText;
  }
  var title = document.getElementById("eventEditorTitle");
  if(title) title.textContent = state.title || (state.editingEventId ? "イベントを編集" : "イベントを追加");
  showEventError(state.error);
  setEventControlsDisabled(state.controlsDisabled !== false);
  setEventEditorDisabled(state.editorDisabled !== false);
}

function setEventEditorDisabled(disabled){
  var editor = document.getElementById("eventEditor");
  if(!editor) return;
  editor.querySelectorAll("input,button").forEach(function(el){ el.disabled = !!disabled; });
}

function setEventControlsDisabled(disabled){
  var events = document.getElementById("events");
  if(!events) return;
  events.querySelectorAll("button,input").forEach(function(el){ el.disabled = !!disabled; });
}

function showEventError(message){
  var el = document.getElementById("eventError");
  if(el) el.textContent = message || "";
}

async function ensureEventsFresh(){
  if(EVENTS_FRESH) return true;
  if(!getWriteToken() && !askWriteToken()) return false;
  return await refreshEventsFromApi();
}

async function openEventEditor(id){
  if(id && !EVENTS_FRESH && !await ensureEventsFresh()) return;
  var event = id ? eventById(id) : null;
  if(id && !event) return;
  var editor = document.getElementById("eventEditor");
  var wasNewEditorOpen = !!(editor && !editor.hidden && !EVENT_EDITOR_EVENT);
  if(event) EVENT_PENDING_REQUEST_ID = null;
  else if(!wasNewEditorOpen || !EVENT_PENDING_REQUEST_ID) EVENT_PENDING_REQUEST_ID = eventRequestId();
  EVENT_EDITOR_EVENT = event ? eventToUi(event) : null;
  if(!editor){ renderEvents(); editor = document.getElementById("eventEditor"); }
  editor.hidden = false;
  document.getElementById("eventEditorTitle").textContent = event ? "イベントを編集" : "イベントを追加";
  document.getElementById("eventDate").value = event && event.date ? event.date : "";
  document.getElementById("eventStartTime").value = event && event.startTime ? event.startTime : "";
  document.getElementById("eventEndTime").value = event && event.endTime ? event.endTime : "";
  document.getElementById("eventTitle").value = event ? event.title || "" : "";
  document.getElementById("eventTheme").value = event ? event.theme || "" : "";
  document.getElementById("eventPlace").value = event ? event.place || "" : "";
  document.getElementById("eventUrl").value = event ? event.url || "" : "";
  document.getElementById("eventSheetUrl").value = event ? event.sheet || event.sheetUrl || "" : "";
  document.getElementById("eventStatusAction").hidden = !event;
  document.getElementById("eventStatusAction").textContent = event && event.status === "終了" ? "再表示" : "終了にする";
  document.getElementById("eventDeleteAction").hidden = !event;
  showEventError("");
  document.getElementById("eventTitle").focus();
}

function clearEventEditorState(){
  var editor = document.getElementById("eventEditor");
  if(editor) editor.hidden = true;
  EVENT_EDITOR_EVENT = null;
  EVENT_PENDING_REQUEST_ID = null;
  showEventError("");
}

function closeEventEditor(){
  if(eventMutationBusy()) return;
  clearEventEditorState();
}

function readEventForm(){
  return {
    id: EVENT_EDITOR_EVENT ? EVENT_EDITOR_EVENT.id : "",
    status: EVENT_EDITOR_EVENT ? EVENT_EDITOR_EVENT.status : "公開",
    date: document.getElementById("eventDate").value.trim(),
    startTime: document.getElementById("eventStartTime").value.trim(),
    endTime: document.getElementById("eventEndTime").value.trim(),
    title: document.getElementById("eventTitle").value.trim(),
    theme: document.getElementById("eventTheme").value.trim(),
    place: document.getElementById("eventPlace").value.trim(),
    url: document.getElementById("eventUrl").value.trim(),
    sheetUrl: document.getElementById("eventSheetUrl").value.trim(),
    updatedAt: EVENT_EDITOR_EVENT ? EVENT_EDITOR_EVENT.updatedAt || "" : "",
    version: EVENT_EDITOR_EVENT ? Number(EVENT_EDITOR_EVENT.version || 0) : 0
  };
}

function validateEventDraft(draft){
  if(!draft.date) return "開催日を入力してください。";
  if(!draft.title) return "タイトルを入力してください。";
  if(draft.title.length > 120) return "タイトルは120文字以内で入力してください。";
  if(draft.theme.length > 120) return "テーマは120文字以内で入力してください。";
  if(draft.place.length > 200) return "場所は200文字以内で入力してください。";
  if(draft.endTime && !draft.startTime) return "終了時刻を入力する場合は開始時刻も入力してください。";
  if(draft.startTime && draft.endTime && draft.endTime <= draft.startTime) return "終了時刻は開始時刻より後にしてください。";
  if(draft.url && (draft.url.length > 500 || !/^https:\/\/\S+$/.test(draft.url))) return "案内URLはhttps://で500文字以内に入力してください。";
  if(draft.sheetUrl && (draft.sheetUrl.length > 500 || !/^https:\/\/docs\.google\.com\/spreadsheets\/.+$/.test(draft.sheetUrl))) return "集計シートURLはGoogleスプレッドシートのURLを500文字以内で入力してください。";
  return "";
}

async function postEventAction(action, event, extra){
  var token = getWriteToken() || askWriteToken();
  if(!token) throw { error: "token", message: "書き込み用の合言葉を入力してください。" };
  var body = Object.assign({ action: action, token: token }, extra || {});
  if(action === "eventCreate") {
    body.requestId = body.requestId || EVENT_PENDING_REQUEST_ID || eventRequestId();
    EVENT_PENDING_REQUEST_ID = body.requestId;
    body.event = event;
    delete body.event.version;
  }
  if(action === "eventUpdate") body.event = event;
  var res = await fetch(API_URL, { method:"POST", headers:{"Content-Type":"text/plain;charset=utf-8"}, body:JSON.stringify(body), signal:AbortSignal.timeout(360000) });
  var result = await res.json();
  if(!result.ok && result.error === "unauthorized") setWriteToken("");
  return result;
}

function mergeEvent(event){
  var next = eventToUi(event), index = EVENTS.findIndex(function(item){ return String(item.id || "") === String(next.id || ""); });
  if(index < 0) EVENTS.push(next); else EVENTS.splice(index, 1, next);
}

async function saveEventEditor(){
  if(eventMutationBusy()) return;
  var draft = readEventForm(), error = validateEventDraft(draft);
  if(error){ showEventError(error); return; }
  EVENT_REVISION += 1;
  EVENT_MUTATION_BUSY = true;
  EVENT_SAVE_BUSY = true;
  setEventBusyAction("save");
  setEventControlsDisabled(true);
  setEventEditorDisabled(true);
  EVENT_SYNC_MESSAGE = "保存中（シートと公開データを更新しています）";
  showEventSyncStatus();
  try {
    var action = draft.id ? "eventUpdate" : "eventCreate";
    var result = await postEventAction(action, draft);
    if(!result.ok) throw result;
    EVENT_SYNC_MESSAGE = "シートに保存済み・画面を更新中…";
    showEventSyncStatus();
    await new Promise(function(resolve){ setTimeout(resolve, 0); });
    mergeEvent(result.event);
    await persistSavedState();
    if(action === "eventCreate") EVENT_PENDING_REQUEST_ID = null;
    EVENT_SYNC_MESSAGE = result.warning
      ? "シートに保存済み。" + result.warning
      : "シートに保存済み・画面更新完了";
    clearEventEditorState();
    renderEvents();
  } catch(err) {
    EVENT_SYNC_MESSAGE = err && err.error === "conflict"
      ? "保存されていません。最新情報を取得してください。"
      : "保存結果を確認できませんでした。最新情報を取得してください。";
    showEventSyncStatus();
    showEventError(err && err.error === "conflict"
      ? "別の画面で更新されています。最新内容を読み込んでからやり直してください"
      : (err && err.message === "書き込み用の合言葉を入力してください。" ? err.message : "保存できませんでした。入力内容を残しています。"));
  } finally {
    EVENT_SAVE_BUSY = false;
    EVENT_MUTATION_BUSY = false;
    setEventBusyAction("");
    setEventControlsDisabled(false);
    setEventEditorDisabled(false);
  }
}

async function setEventStatus(id, status){
  if(eventMutationBusy()) return;
  if(!EVENTS_FRESH && !await ensureEventsFresh()) return;
  var event = eventById(id);
  if(!event || (status !== "終了" && status !== "公開")) return;
  if(status === "終了" && !window.confirm("このイベントを終了にしますか？")) return;
  EVENT_REVISION += 1;
  EVENT_MUTATION_BUSY = true;
  EVENT_STATUS_BUSY = true;
  setEventBusyAction("status", id, status);
  setEventControlsDisabled(true);
  setEventEditorDisabled(true);
  try {
    var result = await postEventAction("eventStatus", null, { id:id, version:Number(event.version || 0), status:status });
    if(!result.ok) throw result;
    mergeEvent(result.event);
    await persistSavedState();
    EVENT_SYNC_MESSAGE = result.warning || "イベントの状態を更新しました。";
    clearEventEditorState();
    renderEvents();
  } catch(err) {
    if(document.getElementById("eventEditor") && document.getElementById("eventEditor").hidden) openEventEditor(id);
    showEventError(err && err.error === "conflict"
      ? "別の画面で更新されています。最新内容を読み込んでからやり直してください"
      : "保存できませんでした。入力内容を残しています。");
  } finally {
    EVENT_STATUS_BUSY = false;
    EVENT_MUTATION_BUSY = false;
    setEventBusyAction("");
    setEventControlsDisabled(false);
    setEventEditorDisabled(false);
  }
}

async function deleteEvent(id){
  if(eventMutationBusy()) return;
  if(!EVENTS_FRESH && !await ensureEventsFresh()) return;
  var event = eventById(id);
  if(!event) return;
  if(!window.confirm("このイベントを完全に削除します。元に戻せません。削除しますか？")) return;
  EVENT_REVISION += 1;
  EVENT_MUTATION_BUSY = true;
  EVENT_DELETE_BUSY = true;
  setEventBusyAction("delete", id);
  setEventControlsDisabled(true);
  setEventEditorDisabled(true);
  try {
    var result = await postEventAction("eventDelete", null, { id:id, version:Number(event.version || 0) });
    if(!result.ok) throw result;
    var index = EVENTS.findIndex(function(item){ return String(item.id || "") === String(id); });
    if(index >= 0) EVENTS.splice(index, 1);
    await persistSavedState();
    EVENT_SYNC_MESSAGE = result.warning || "イベントを削除しました。";
    clearEventEditorState();
    renderEvents();
  } catch(err) {
    if(document.getElementById("eventEditor") && document.getElementById("eventEditor").hidden) openEventEditor(id);
    showEventError(err && err.error === "conflict"
      ? "別の画面で更新されています。最新内容を読み込んでからやり直してください"
      : "削除できませんでした。もう一度お試しください。");
  } finally {
    EVENT_DELETE_BUSY = false;
    EVENT_MUTATION_BUSY = false;
    setEventBusyAction("");
    setEventControlsDisabled(false);
    setEventEditorDisabled(false);
  }
}

function refreshEventsFromApi(){
  if(EVENT_REFRESH_BUSY) return EVENT_REFRESH_PROMISE;
  EVENT_REFRESH_BUSY = true;
  syncEventRefreshButton();
  EVENT_REFRESH_PROMISE = performEventRefresh().finally(function(){
    EVENT_REFRESH_BUSY = false;
    EVENT_REFRESH_PROMISE = null;
    syncEventRefreshButton();
  });
  return EVENT_REFRESH_PROMISE;
}

async function performEventRefresh(){
  var token = getWriteToken();
  if(!token || !API_URL){ EVENT_SYNC_MESSAGE = "公開時点のイベントを表示しています。"; showEventSyncStatus(); return false; }
  if(EVENT_MUTATION_BUSY){ EVENT_SYNC_MESSAGE = "イベントの保存中のため、最新取得を待機しています。"; showEventSyncStatus(); return false; }
  var revisionAtStart = EVENT_REVISION;
  var editingAtStart = !!EVENT_EDITOR_EVENT || !!(document.getElementById("eventEditor") && !document.getElementById("eventEditor").hidden);
  EVENT_SYNC_MESSAGE = "イベントの最新データを取得中…";
  showEventSyncStatus();
  try {
    var res = await fetch(API_URL, { method:"POST", headers:{"Content-Type":"text/plain;charset=utf-8"}, body:JSON.stringify({action:"read", what:"structuredEvents", token:token}), signal:AbortSignal.timeout(30000) });
    var result = await res.json();
    var latestEvents = result.ok ? validateStructuredEvents(result.events) : null;
    if(!latestEvents) throw new Error("invalid events");
    if(revisionAtStart !== EVENT_REVISION || EVENT_MUTATION_BUSY){
      showEventSyncStatus();
      return false;
    }
    var editingAtCompletion = !!EVENT_EDITOR_EVENT || !!(document.getElementById("eventEditor") && !document.getElementById("eventEditor").hidden);
    if(editingAtStart || editingAtCompletion){
      EVENT_SYNC_MESSAGE = "編集中のため最新データを反映しませんでした。保存後に再取得してください。";
      showEventSyncStatus();
      return false;
    }
    EVENTS.splice(0, EVENTS.length, ...latestEvents);
    await persistSavedState();
    EVENTS_FRESH = true;
    EVENT_LAST_FETCHED_AT = new Date();
    EVENT_SYNC_MESSAGE = "スプレッドシートの最新イベントを表示しています。";
    renderEvents();
    return true;
  } catch(ignore) {
    if(revisionAtStart === EVENT_REVISION) {
      EVENT_SYNC_MESSAGE = "最新データを取得できませんでした。表示内容が古い可能性があります。";
      showEventSyncStatus();
    }
    return false;
  }
}

function showEventSyncStatus(){
  var status = document.getElementById("eventSyncStatus");
  if(status) status.textContent = EVENT_SYNC_MESSAGE
    + (EVENT_LAST_FETCHED_AT ? (EVENT_SYNC_MESSAGE ? "・" : "") + "最終取得 "
      + EVENT_LAST_FETCHED_AT.toLocaleTimeString("ja-JP", { timeZone:"Asia/Tokyo", hour:"2-digit", minute:"2-digit" }) : "");
}

function syncEventRefreshButton(){
  var button = document.getElementById("eventRefresh");
  if(button){
    button.disabled = EVENT_REFRESH_BUSY || EVENT_MUTATION_BUSY;
    button.textContent = EVENT_REFRESH_BUSY ? "取得中…" : "最新情報を取得";
  }
}
const FULL_DETAIL = [
  ["履歴","履歴", true, false],
  ["最寄駅","最寄駅", false, false],
  ["一人暮らしor実家","一人暮らしor実家", false, false],
  ["土日休みorシフト","土日休みorシフト", false, false],
  ["仕事(O)","仕事（O）", false, false],
  ["趣味・部活(R)","趣味・部活（R）", false, false],
  ["お金の価値観(M)","お金の価値観（M）", false, false],
  ["目標(D)","目標（D）", false, false],
  ["出身地・家族(F)","出身地・家族（F）", true, false],
  ["出会い(どこで)","出会い（どこで）", false, false],
  ["出会い(誰と)","出会い（誰と）", false, false],
  ["出会った日","出会った日", false, false],
  ["出会った時の年齢","出会った時の年齢", false, false],
  ["現在の年齢","現在の年齢", false, false],
  ["誕生日","誕生日", false, false],
  ["LINE/Insta名","LINE/Insta名", false, true],
  ["Insta URL","Insta URL", false, true]
];

/* ============ 土の栄養（プロフィールの埋まり具合） ============
   水＝連絡頻度、栄養＝その人について知っている情報量、という切り分け。
   履歴と現在の年齢は自動で埋まるので対象外（勝手に増えると指標にならない）。
   LINE/Insta名・Insta URL は任意項目なので対象外。 */
var NUTRIENT_SKIP = { "履歴":1, "現在の年齢":1 };
var NUTRIENT_FIELDS = FULL_DETAIL.filter(function(f){ return !f[3] && !NUTRIENT_SKIP[f[0]]; });

/* アプリから書き込める項目（sheet-api.gs の EDITABLE と必ず揃えること） */
var EDITABLE_FIELDS = {
  "アクション日":1, "アクション内容":1, "次会う日":1, "次会う日にする事":1,
  "出会った日":1, "出会った時の年齢":1, "誕生日":1, "出会い(どこで)":1, "出会い(誰と)":1,
  "最寄駅":1, "一人暮らしor実家":1, "土日休みorシフト":1, "出身地・家族(F)":1,
  "仕事(O)":1, "趣味・部活(R)":1, "お金の価値観(M)":1, "目標(D)":1
};
var DATE_FIELDS = { "出会った日":1, "誕生日":1 };

/* プロフィール編集フォームの項目（＝EDITABLEのうち予定4項目を除いた13項目）。表示順とラベル。 */
var PROFILE_FIELDS = [
  ["仕事(O)","仕事"],
  ["趣味・部活(R)","趣味・部活"],
  ["出身地・家族(F)","出身地・家族"],
  ["最寄駅","最寄駅"],
  ["一人暮らしor実家","一人暮らしor実家"],
  ["土日休みorシフト","土日休みorシフト"],
  ["出会い(どこで)","出会い（どこで）"],
  ["出会い(誰と)","出会い（誰と）"],
  ["出会った日","出会った日"],
  ["出会った時の年齢","出会った時の年齢"],
  ["誕生日","誕生日"],
  ["お金の価値観(M)","お金の価値観"],
  ["目標(D)","目標"]
];
var PROF_EDIT = false; // プロフィール編集モードか

