'use strict';

// Only authenticated, encrypted snapshots are persisted; the sheet remains authoritative.
var SAVED_SESSION = null;
var SAVED_QUEUE = Promise.resolve();
var TASK_MEMORY = Object.create(null);
var TASK_PENDING_MEMORY = Object.create(null);
var TASK_PUSH_QUEUE = Object.create(null);
var TASK_OPERATION = 0;

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
    if (saved.date < dataDate) return false;
    // Never mix a cache from a later daily generation into an older published page.
    if (saved.date !== dataDate) return false;
    DATA.splice(0,DATA.length,...saved.contacts);
    EVENTS.splice(0,EVENTS.length,...events);
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
  var snapshot=JSON.stringify({version:1,date:session.date,savedAt:Date.now(),contacts:DATA,events:EVENTS});
  SAVED_QUEUE=SAVED_QUEUE.catch(function(){}).then(async function(){
    try {
      var iv=crypto.getRandomValues(new Uint8Array(12));
      var bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},session.key,new TextEncoder().encode(snapshot));
      localStorage.setItem(cacheKey(),JSON.stringify({version:1,salt:session.salt,iv:encodeBytes(iv),ct:encodeBytes(bytes)}));
      return true;
    } catch(error) {
      storageNotice('シートへの保存は完了していますが、この端末への保存に失敗しました。再読み込み時は通信が必要です。');
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
  try {localStorage.setItem(key,JSON.stringify(value));return true;}catch(error){storageNotice('この端末に保存できませんでした。ページを閉じる前に同期結果を確認してください。');return false;}
}
function pendingTaskKey(date) {return 'daily-task-pending:'+date;}
function pendingTaskState(date) {return readTaskObject(pendingTaskKey(date),TASK_PENDING_MEMORY);}
function savePendingTasks(date, state) {return writeTaskObject(pendingTaskKey(date),state,TASK_PENDING_MEMORY);}
