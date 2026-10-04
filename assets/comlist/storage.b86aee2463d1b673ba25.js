
'use strict';

// Only authenticated, encrypted snapshots are persisted; the sheet remains authoritative.
var SAVED_SESSION = null;
var SAVED_QUEUE = Promise.resolve();
var TASK_MEMORY = Object.create(null);
var TASK_PENDING_MEMORY = Object.create(null);
var TASK_PUSH_QUEUE = Object.create(null);
var TASK_OPERATION = 0;
var TASK_SAVE_ERRORS = Object.create(null);
var CONTACT_ACTION_PENDING = null;

function storageNotice(message) {
  var box = document.getElementById('comlist-storage-status');
  if (!box) {
    box = document.createElement('p'); box.id = 'comlist-storage-status';
    box.setAttribute('role', 'status');
    box.style.cssText = 'margin:12px 20px;padding:10px;background:#fff3d6;color:#624600;border-radius:8px';
    document.body.appendChild(box);
  }
  box.textContent = message;
}
function validCachedContacts(rows) {
  return Array.isArray(rows) && new Set(rows.map(function(r){return r && r._row;})).size === rows.length && rows.every(function(r){
    return r && Number.isInteger(r._row) && r._row >= 2 && /^[ABCD]$/.test(r['カテゴリー']) && typeof r['名前(あだ名)'] === 'string';
  });
}
function cacheKey() { return 'comlist-cache:v1:' + location.pathname; }
function encodeBytes(bytes) { var s=''; new Uint8Array(bytes).forEach(function(b){s+=String.fromCharCode(b);}); return btoa(s); }
function decodeBytes(s) { return Uint8Array.from(atob(s), function(c){return c.charCodeAt(0);}); }
async function cacheCryptoKey(pass, salt) {
  var material=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:salt,iterations:250000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function initializeSavedState(pass, dataDate) {
  await SAVED_QUEUE;
  SAVED_SESSION=null;
  try {
    var salt=crypto.getRandomValues(new Uint8Array(16));
    var key=await cacheCryptoKey(pass,salt);
    SAVED_SESSION={key:key,salt:encodeBytes(salt),date:dataDate};
    var raw=localStorage.getItem(cacheKey());
    if (!raw) return false;
    var envelope=JSON.parse(raw);
    if (!envelope || envelope.version!==1 || typeof envelope.salt!=='string' || typeof envelope.iv!=='string' || typeof envelope.ct!=='string') throw Error('invalid cache envelope');
    var oldKey=await cacheCryptoKey(pass,decodeBytes(envelope.salt));
    var plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decodeBytes(envelope.iv)},oldKey,decodeBytes(envelope.ct));
    var saved=JSON.parse(new TextDecoder().decode(plain));
    var events=Array.isArray(saved.events)&&saved.events.length===0?[]:validateStructuredEvents(saved.events);
    if(saved.version!==1 || !/^\d{4}-\d{2}-\d{2}$/.test(saved.date) || !Number.isFinite(saved.savedAt) || saved.savedAt>Date.now()+300000 || !validCachedContacts(saved.contacts) || !events) throw Error('invalid cache data');
    if(saved.date<=dataDate&&saved.contactAction&&typeof saved.contactAction.requestId==='string')CONTACT_ACTION_PENDING=saved.contactAction;
    if(saved.date<=dataDate&&saved.fieldGoals&&typeof FieldGoalsModel!=='undefined'){
      FIELD_GOALS_STATE=FieldGoalsModel.validate(saved.fieldGoals.state);
      FIELD_GOALS_VERSION=typeof saved.fieldGoals.version==='string'?saved.fieldGoals.version:null;
      var pending=saved.fieldGoals.pending;
      if(pending){
        if(typeof pending.requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(pending.requestId)||(pending.version!==null&&typeof pending.version!=='string'))throw Error('invalid goal cache');
        FIELD_GOALS_PENDING={state:FieldGoalsModel.validate(pending.state),version:pending.version,requestId:pending.requestId,sent:pending.sent!==false};
      }else FIELD_GOALS_PENDING=null;
      FIELD_GOALS_PHASE=FIELD_GOALS_PENDING?'未同期の変更を暗号化保存から復元しました。':'端末の保存内容を復元しました。最新を確認してください。';
      var celebrated=saved.fieldGoals.celebrated;if(celebrated&&typeof celebrated==='object'&&!Array.isArray(celebrated))Object.keys(celebrated).filter(function(k){return /^(month:20\d{2}-(0[1-9]|1[0-2])|week:20\d{2}-\d{2}-\d{2}@20\d{2}-(0[1-9]|1[0-2]))$/.test(k)&&celebrated[k]===true;}).slice(-240).forEach(function(k){FIELD_MISSION_CELEBRATED[k]=true;});
      if(typeof saved.fieldGoals.reduceMotion==='boolean')FIELD_MISSION_REDUCE_MOTION=saved.fieldGoals.reduceMotion;
    }
    try {if(saved.date<=dataDate&&typeof CalendarAvailability!=='undefined'){
      if(saved.calendarPrefs)CALENDAR_SLOT_PREFS=CalendarAvailability.settings(saved.calendarPrefs);
      if(saved.calendarAvailability){var cacheAvailability=CalendarAvailability.validate(saved.calendarAvailability);if(!CALENDAR_AVAILABILITY||Date.parse(cacheAvailability.info.fetchedAt)>=Date.parse(CALENDAR_AVAILABILITY.info.fetchedAt))CALENDAR_AVAILABILITY=cacheAvailability;}
    }
    }catch(calendarCacheError){storageNotice('空き候補の端末設定を読み込めませんでした。設定と再取得を確認してください。');}
    if (saved.date < dataDate) return false;
    // Never mix a cache from a later daily generation into an older published page.
    if (saved.date !== dataDate) return false;
    // Same-day cache can predate a new read-only advice import. Keep cached edits, refresh only that source field.
    var publishedAdvice=new Map(DATA.filter(function(o){return typeof o['仲間づくりアドバイス']==='string';}).map(function(o){return [o._row,o];}));
    var restoredContacts=saved.contacts.map(function(o){var source=publishedAdvice.get(o._row);return source&&source['名前(あだ名)']===o['名前(あだ名)']?Object.assign({},o,{'仲間づくりアドバイス':source['仲間づくりアドバイス']}):o;});
    DATA.splice(0,DATA.length,...restoredContacts);
    EVENTS.splice(0,EVENTS.length,...events);
    CONTACT_ACTION_PENDING = saved.contactAction || null;
    storageNotice('この端末に保存した内容を復元しました。最新データを確認中です。');
    return true;
  } catch(error) {
    storageNotice('端末の保存データを読み込めなかったため、公開時点のデータを表示しています。');
    return false;
  }
}
function persistSavedState() {
  if(!SAVED_SESSION) return Promise.resolve(false);
  var session=SAVED_SESSION;
  var goals=typeof FIELD_GOALS_STATE==='undefined'?null:{state:FIELD_GOALS_STATE,version:FIELD_GOALS_VERSION,pending:FIELD_GOALS_PENDING,celebrated:typeof FIELD_MISSION_CELEBRATED==='undefined'?{}:FIELD_MISSION_CELEBRATED,reduceMotion:typeof FIELD_MISSION_REDUCE_MOTION==='undefined'?null:FIELD_MISSION_REDUCE_MOTION};
  var snapshot=JSON.stringify({version:1,date:session.date,savedAt:Date.now(),contacts:DATA,events:EVENTS,contactAction:CONTACT_ACTION_PENDING,fieldGoals:goals,calendarAvailability:typeof CALENDAR_AVAILABILITY==='undefined'?null:CALENDAR_AVAILABILITY,calendarPrefs:typeof CALENDAR_SLOT_PREFS==='undefined'?null:CALENDAR_SLOT_PREFS});
  SAVED_QUEUE=SAVED_QUEUE.catch(function(){}).then(async function(){
    try {
      var iv=crypto.getRandomValues(new Uint8Array(12));
      var bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},session.key,new TextEncoder().encode(snapshot));
      localStorage.setItem(cacheKey(),JSON.stringify({version:1,salt:session.salt,iv:encodeBytes(iv),ct:encodeBytes(bytes)}));
      return true;
    } catch(error) {
      storageNotice('この端末への保存に失敗しました。ページを閉じる前に同期結果を確認してください。');
      return false;
    }
  });
  return SAVED_QUEUE;
}
function readTaskObject(key, memory) {
  if(Object.prototype.hasOwnProperty.call(memory,key)) return memory[key];
  try {var value=JSON.parse(localStorage.getItem(key)||'{}');return value && typeof value==='object' && !Array.isArray(value) ? value : {};}catch(error){return {};}
}
function writeTaskObject(key, value, memory) {
  memory[key]=value;
  try {localStorage.setItem(key,JSON.stringify(value));delete TASK_SAVE_ERRORS[key];return true;}catch(error){TASK_SAVE_ERRORS[key]=true;storageNotice('この端末に保存できませんでした。ページを閉じる前に同期結果を確認してください。');return false;}
}
function pendingTaskKey(date) {return 'daily-task-pending:'+date;}
function pendingTaskState(date) {return readTaskObject(pendingTaskKey(date),TASK_PENDING_MEMORY);}
function savePendingTasks(date, state) {return writeTaskObject(pendingTaskKey(date),state,TASK_PENDING_MEMORY);}
