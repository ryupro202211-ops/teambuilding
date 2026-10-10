
let CREATE_REQUEST_ID = "";
let CREATE_BUSY = false;
let CONTACT_REVISION = 0;
let BULK_SAVE_BUSY = false;
let CONTACT_EDIT_BUSY = false;
function contactWriteStatus(text){var box=document.getElementById('contact-write-status');if(box)box.textContent=text;}
function openCreatePerson(cat){
  if(CREATE_BUSY) return;
  document.getElementById("person-form").reset();
  document.getElementById("person-category").value = cat;
  document.getElementById("person-title").textContent = "カテゴリ " + cat + " に登録";
  document.getElementById("person-message").textContent = "";
  document.getElementById("person-token").placeholder = getWriteToken() ? "保存済み（変更するときだけ入力）" : "書き込み用の合言葉を入力";
  CREATE_REQUEST_ID = crypto.randomUUID();
  document.getElementById("person-dialog").showModal();
  document.getElementById("person-name").focus();
}
document.getElementById("person-cancel").addEventListener("click",function(){ if(!CREATE_BUSY) document.getElementById("person-dialog").close(); });
document.getElementById("person-dialog").addEventListener("cancel",function(e){ if(CREATE_BUSY) e.preventDefault(); });
document.getElementById("person-form").addEventListener("submit",async function(e){
  e.preventDefault();
  if(CREATE_BUSY) return;
  var msg=document.getElementById("person-message"), name=document.getElementById("person-name").value.trim();
  if(!name){msg.textContent="名前を入力してください。";return;}
  var tokenInput=document.getElementById("person-token");
  var token=tokenInput.value.trim() || getWriteToken();
  if(!token){msg.textContent="書き込み用の合言葉を入力してください。";tokenInput.focus();return;}
  var values={"カテゴリー":document.getElementById("person-category").value,"名前(あだ名)":name,
    "仕事(O)":document.getElementById("person-job").value.trim(),"出会い(どこで)":document.getElementById("person-place").value.trim(),
    "アクション日":document.getElementById("person-action").value,"メモ":document.getElementById("person-memo").value.trim()};
  CREATE_BUSY=true;
  CONTACT_REVISION++;
  var controls=Array.from(this.querySelectorAll("input,textarea,button"));
  controls.forEach(function(x){x.disabled=true;}); msg.textContent="登録中…";
  try {
    var res=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"create",token:token,requestId:CREATE_REQUEST_ID,values:values}),signal:AbortSignal.timeout(30000)});
    var j=await res.json();
    if(!j.ok){
      if(j.error==="unauthorized"){setWriteToken("");tokenInput.value="";tokenInput.placeholder="書き込み用の合言葉を入力";throw new Error("合言葉が違います。入力し直して登録してください。");}
      if(j.error==="invalid row") throw new Error("登録機能のサーバー更新が必要です。");
      throw new Error(j.message || "登録できませんでした。");
    }
    if(!j.record || !Number.isInteger(j.record._row) || j.record._row<2) throw new Error("登録結果を確認できませんでした。同じ画面からもう一度お試しください。");
    setWriteToken(token);
    tokenInput.value="";
    CONTACT_REVISION++;
    var existing=DATA.findIndex(function(x){return x._row===j.record._row;});
    if(existing<0) DATA.push(j.record); else DATA[existing]=j.record;
    document.getElementById("search").value="";
    SEARCH="";
    GARDEN_DETAIL_HIDDEN=false;
    document.querySelectorAll("#catfilter input").forEach(function(x){if(x.value===j.record["カテゴリー"])x.checked=true;});
    SELECTED=plantKey(j.record); await persistSavedState(); render();
    document.getElementById("person-dialog").close();
    document.getElementById("gdpanel").scrollIntoView({block:"nearest"});
  } catch(err){msg.textContent=(err.name==="TimeoutError" || err.name==="TypeError") ? "通信結果を確認できませんでした。同じ画面で再度登録を押してください（二重登録は防止されます）。" : err.message;}
  finally {CREATE_BUSY=false;controls.forEach(function(x){x.disabled=false;});}
});

// The sheet is authoritative, including updates and cleared fields on existing people.
document.getElementById("contact-sync-retry").addEventListener("click",refreshRegisteredPeople);
async function refreshRegisteredPeople(){
  var status=document.getElementById("contact-sync-status"), retry=document.getElementById("contact-sync-retry");
  var token=getWriteToken();
  if(!token || !API_URL){status.textContent="公開時点のデータを表示しています。";return;}
  var revision=CONTACT_REVISION;
  retry.hidden=true;status.textContent="スプレッドシートの最新データを取得中…";
  try {
    var res=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"read",what:"contacts",token:token}),signal:AbortSignal.timeout(30000)});
    var j=await res.json();
    if(!j.ok || !Array.isArray(j.records) || !j.records.length || j.records.some(function(x){return !Number.isInteger(x._row) || x._row<2 || !/^[ABCD]$/.test(x["カテゴリー"]);}) || new Set(j.records.map(function(x){return x._row;})).size!==j.records.length) throw new Error("invalid contacts");
    if(revision!==CONTACT_REVISION || PANEL_EDIT || PROF_EDIT || CREATE_BUSY || BULK_SAVE_BUSY || CONTACT_EDIT_BUSY || CONTACT_ACTION_PENDING || CONTACT_ACTION_BUSY || document.getElementById("bulk-dialog").open){status.textContent="編集中の内容を保護しました。編集後に最新データを再取得してください。";retry.hidden=false;return;}
    DATA.splice(0,DATA.length,...j.records);
    await persistSavedState();
    render();
    status.textContent="スプレッドシートの最新データを表示しています。";
    if(typeof renderContactSuggestions==='function')renderContactSuggestions();
  } catch(ignore) { status.textContent="最新データを取得できませんでした。表示内容が古い可能性があります。";retry.hidden=false; }
}

function hasVal(o, key){ var v = o[key]; return v != null && String(v).trim() !== ""; }

function nutritionOf(o){
  var filled = 0, missing = [];
  NUTRIENT_FIELDS.forEach(function(f){
    if(hasVal(o, f[0])) filled++; else missing.push(f[0]);
  });
  var total = NUTRIENT_FIELDS.length;
  return { filled: filled, total: total, missing: missing, pct: total ? Math.round(filled/total*100) : 100 };
}

function esc(s){
  return String(s==null?"":s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function parseDate(str){
  if(!str) return null;
  var s = String(str).trim().replace(/[.\-]/g,"/");
  var m = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if(m){ return new Date(+m[1], +m[2]-1, +m[3]); }
  m = s.match(/(\d{1,2})\/(\d{1,2})/);
  if(m){
    var now = new Date();
    return new Date(now.getFullYear(), +m[1]-1, +m[2]);
  }
  return null;
}

function daysUntil(str){
  var d = parseDate(str);
  if(!d) return null;
  var today = new Date();
  today.setHours(0,0,0,0);
  d.setHours(0,0,0,0);
  return Math.round((d - today) / 86400000);
}

/* 次会う日までの残り日数（当日〜7日前のみ） */
function meetInfo(str){
  var n = daysUntil(str);
  if(n===null || n<0 || n>7) return null;
  var label = (n===0) ? "今日会う" : (n===1 ? "明日" : "あと"+n+"日");
  var cls = (n===0) ? "nb0" : (n===1 ? "nb1" : (n<=3 ? "nb3" : "nb7"));
  return { n:n, label:label, cls:cls };
}

function nextBadge(str){
  var mi = meetInfo(str);
  if(!mi) return "";
  return '<span class="nb '+mi.cls+'">'+mi.label+'</span>';
}

var SEARCH_KEYS = ["名前(あだ名)","仕事(O)","出会い(どこで)","出会い(誰と)","メモ","履歴","ステータス","最寄駅","出身地・家族(F)","趣味・部活(R)","目標(D)","お金の価値観(M)"];

function matchSearch(o){
  if(!SEARCH) return true;
  var hay = SEARCH_KEYS.map(function(k){ return o[k]||""; }).join(" ").toLowerCase();
  return hay.indexOf(SEARCH) !== -1;
}

function sexPill(v){
  if(!v) return "";
  if(v.indexOf("男")!==-1) return '<span class="pill p-sex-m">'+esc(v)+'</span>';
  if(v.indexOf("女")!==-1) return '<span class="pill p-sex-f">'+esc(v)+'</span>';
  return '<span class="pill">'+esc(v)+'</span>';
}

function detailHTML(o,showAdvice){
  var rows = FULL_DETAIL.map(function(f){
    var key=f[0], label=f[1], wide=f[2], hideEmpty=f[3];
    var val = o[key];
    var has = val!=null && String(val).trim()!=="";
    if(!has && hideEmpty) return "";
    var cls = "f" + (wide?" wide":"") + (has?"":" miss");
    var inner;
    if(has){
      if(key==="Insta URL"){
        inner = '<a href="'+esc(val)+'" target="_blank" rel="noopener">'+esc(val)+'</a>';
      } else {
        inner = esc(val);
      }
    } else {
      inner = '<span class="blank">空欄</span>';
    }
    return '<div class="'+cls+'"><span class="k">'+esc(label)+'</span>'+inner+'</div>';
  }).join("");
  var missCount = FULL_DETAIL.filter(function(f){
    if(f[3]) return false;
    var v=o[f[0]]; return !(v!=null && String(v).trim()!=="");
  }).length;
  var missBadge = missCount ? '<span class="miss-badge">空欄 '+missCount+'</span>' : "";
  return '<details class="det"><summary>詳細を表示'+missBadge+'</summary>'
    + '<div class="det-body"><div class="fields">'+rows+'</div>'+(showAdvice===false?'':friendAdviceHTML(o))+'</div></details>';
}

function friendAdviceHTML(o){
  var advice=String(o['仲間づくりアドバイス']||'').trim();
  if(!advice)return '';
  return '<section class="friend-advice" aria-label="仲間づくりアドバイス"><h3>仲間づくりのヒント</h3><p class="friend-advice-note">本人の希望を確かめるための会話メモ</p><div class="friend-advice-text">'+esc(advice)+'</div></section>';
}

function cardHTML(o,suppressAdvice){
  var cat = o["カテゴリー"]||"";
  var name = o["名前(あだ名)"]||"(名前なし)";
  var key = plantKey(o);
  var pick = BULK_MODE
    ? '<input type="checkbox" class="bulk-check" data-key="'+esc(key)+'"'+(BULK_PICKED[key] ? ' checked' : '')
      + ' aria-label="'+esc(name)+' をまとめて編集に含める">'
    : "";
  var top = '<div class="card-top">'
    + pick
    + '<span class="cbadge '+esc(cat)+'">'+esc(cat)+'</span>'
    + '<span class="name">'+esc(name)+'</span>'
    + (o["ステータス"] ? '<span class="pill p-status">'+esc(o["ステータス"])+'</span>' : "")
    + sexPill(o["性別"])
    + nextBadge(o["次会う日"])
    + '</div>';

  var action = "";
  if(o["アクション日"] || o["アクション内容"]){
    action = '<div class="hl hl-action">'
      + '<span class="hl-label">アクション</span>'
      + (o["アクション日"] ? '<span class="hl-date">'+esc(o["アクション日"])+'</span>' : "")
      + (o["アクション内容"] ? '<span class="hl-what">'+esc(o["アクション内容"])+'</span>' : "")
      + '</div>';
  }
  var next = "";
  if(o["次会う日"] || o["次会う日にする事"]){
    next = '<div class="hl hl-next">'
      + '<span class="hl-label">次会う</span>'
      + (o["次会う日"] ? '<span class="hl-date">'+esc(o["次会う日"])+'</span>' : "")
      + (o["次会う日にする事"] ? '<span class="hl-what">'+esc(o["次会う日にする事"])+'</span>' : "")
      + '</div>';
  }
  var memo = o["メモ"] ? '<details class="memo"><summary>メモ・報連相</summary><div class="memo-body">'+esc(o["メモ"])+'</div></details>' : "";

  return '<div class="card">'+top+action+next+memo+detailHTML(o,!suppressAdvice)+'</div>';
}

function checkedCats(){
  var s = {};
  document.querySelectorAll("#catfilter input:checked").forEach(function(c){ s[c.value]=true; });
  return s;
}

function sortByDate(list, key){
  return list.slice().sort(function(a,b){
    var da=daysUntil(a[key]), db=daysUntil(b[key]);
    var va = (da===null)?Infinity:da;
    var vb = (db===null)?Infinity:db;
    return va-vb;
  });
}

function render(){
  if(typeof updateTodayBadges==='function')updateTodayBadges();
  if(typeof renderMeetingReminders==='function')renderMeetingReminders();
  if(typeof syncMeetingReminders==='function'&&SAVED_SESSION&&MEETING_REMINDER_SYNC_SESSION!==SAVED_SESSION){MEETING_REMINDER_SYNC_SESSION=SAVED_SESSION;syncMeetingReminders();}
  renderList();
  if(VIEW === "garden") renderGarden();
}

function renderList(){
  var app = document.getElementById("app");
  var cats = checkedCats();
  var list = DATA.filter(function(o){ return cats[o["カテゴリー"]] && matchSearch(o); });

  if(list.length===0){
    app.innerHTML = '<div class="empty">該当する人がいません</div>';
    updateFoot(0);
    return;
  }

  if(SORT==="action" || SORT==="next"){
    var key = SORT==="action" ? "アクション日" : "次会う日";
    var sorted = sortByDate(list, key);
    app.innerHTML = '<div class="cat"><div class="cat-body">'
      + sorted.map(cardHTML).join("") + '</div></div>';
  } else {
    var html = "";
    CATS.forEach(function(c){
      if(!cats[c]) return;
      var group = list.filter(function(o){ return o["カテゴリー"]===c; });
      if(group.length===0) return;
      var meta = CAT_META[c] || { label:c, desc:"" };
      html += '<div class="cat '+c+'">'
        + '<div class="cat-head">'
        + (BULK_MODE ? '<label class="bulk-cat-wrap"><input type="checkbox" class="bulk-cat" data-cat="'+esc(c)+'"'
            + (group.every(function(o){ return BULK_PICKED[plantKey(o)]; }) ? ' checked' : '')
            + ' aria-label="カテゴリ '+esc(c)+' の全員を選ぶ"></label>' : '')
        + '<span class="chev">▶</span>'
        + '<span class="cbadge '+c+'">'+esc(meta.label||c)+'</span>'
        + '<span class="cat-title">'+esc(meta.desc||("カテゴリ "+c))+'</span>'
        + '<span class="cat-count">'+group.length+' 人</span>'
        + '</div>'
        + '<div class="cat-body">'+group.map(cardHTML).join("")+'</div>'
        + '</div>';
    });
    app.innerHTML = html;
    document.querySelectorAll(".cat-head").forEach(function(h){
      h.addEventListener("click", function(e){
        if(e.target.closest("a") || e.target.closest(".bulk-cat-wrap")) return;
        this.parentElement.classList.toggle("collapsed");
      });
    });
  }
  wireBulkChecks();
  updateFoot(list.length);
}

function updateFoot(n){
  document.getElementById("foot").textContent = "表示中 " + n + " 件 ／ 全 " + DATA.length + " 件";
}

/* ===================== まとめて編集 =====================
   リストに出ている人を複数選び、予定4項目を1リクエストで書き戻す。
   1人1リクエストにするとGAS側のロックを取り合って後続が busy で落ちるため、
   選んだ人ぶんを items にまとめて action:"bulk" で送る。 */
var BULK_MODE = false;
var BULK_PICKED = {};   // plantKey → true。カードは再描画で作り直されるので、並び順に依存しないキーで持つ。

function bulkPicked(){
  return DATA.filter(function(o){ return BULK_PICKED[plantKey(o)]; });
}
var BULK_MAX = 50;      // sheet-api.gs の BULK_MAX と揃えること

function syncBulkBar(){
  var n = bulkPicked().length;
  var over = n > BULK_MAX;
  document.getElementById("bulk-bar").hidden = !BULK_MODE;
  document.getElementById("bulk-count").textContent = n + " 人を選択中"
    + (over ? "（一度に更新できるのは " + BULK_MAX + " 人まで）" : "");
  document.getElementById("bulk-open").disabled = (n === 0 || over);
  document.getElementById("bulk-start").textContent = BULK_MODE ? "選択をやめる" : "まとめて編集";
}
function setBulkMode(on){
  BULK_MODE = on;
  if(!on) BULK_PICKED = {};
  render();
  syncBulkBar();
}
function wireBulkChecks(){
  document.querySelectorAll(".bulk-check").forEach(function(c){
    c.addEventListener("change", function(){
      if(this.checked) BULK_PICKED[this.dataset.key] = true;
      else delete BULK_PICKED[this.dataset.key];
      syncBulkBar();
    });
  });
  // カテゴリ見出しの全選択。再描画すると押した要素が入れ替わってしまうので、
  // ここでは各チェックを直接切り替えるだけにして render() は呼ばない。
  document.querySelectorAll(".bulk-cat").forEach(function(c){
    c.addEventListener("change", function(){
      var on = this.checked, cat = this.closest(".cat");
      if(!cat) return;
      cat.querySelectorAll(".bulk-check").forEach(function(x){
        x.checked = on;
        if(on) BULK_PICKED[x.dataset.key] = true; else delete BULK_PICKED[x.dataset.key];
      });
      syncBulkBar();
    });
  });
}
document.getElementById("bulk-start").addEventListener("click", function(){ setBulkMode(!BULK_MODE); });
document.getElementById("bulk-cancel").addEventListener("click", function(){ setBulkMode(false); });

/* 編集シート。選んだ人が1行ずつ並び、各行はいまの値で埋まっている。
   上段の「全員に同じ値を入れる」は、入れた項目だけを全行にコピーする。 */
var BULK_LIST = [];               // シートに並んでいる人（DATA の要素そのもの）
var BULK_FIELDS = { ad:"アクション日", ac:"アクション内容", nd:"次会う日", nw:"次会う日にする事" };

function actionOptionsHTML(cur){
  return ACTION_OPTIONS.map(function(x){
    return '<option value="'+esc(x)+'"'+(((cur||"") === x) ? " selected" : "")+'>'+(x ? esc(x) : "（なし）")+'</option>';
  }).join("");
}

function bulkRowHTML(o, i){
  var cat = o["カテゴリー"]||"";
  return '<div class="bulk-row" data-i="'+i+'">'
    + '<div class="bulk-row-name"><span class="cbadge '+esc(cat)+'">'+esc(cat)+'</span>'+esc(o["名前(あだ名)"]||"(名前なし)")+'</div>'
    + '<div class="bulk-row-grid">'
    + '<label>アクション日'+dateInputHTML("br"+i+"-ad", o["アクション日"]||"")+'</label>'
    + '<label>アクション内容<select id="br'+i+'-ac">'+actionOptionsHTML(o["アクション内容"])+'</select></label>'
    + '<label>次会う日'+dateInputHTML("br"+i+"-nd", o["次会う日"]||"")+'</label>'
    + '<label>次会う日にする事<input id="br'+i+'-nw" type="text" maxlength="2000" value="'+esc(o["次会う日にする事"]||"")+'"></label>'
    + '</div>'
    + '<div class="bulk-row-warn" id="br'+i+'-warn"></div>'
    + '<div class="bulk-row-msg" id="br'+i+'-msg"></div>'
    + '</div>';
}

/* 表記ゆれ（"8/20" と "2026-08-20"）で誤検知しないよう、日付として読めるものは ISO で比べる。
   GAS 側の normDate_ と同じ判定をクライアントでも行い、履歴が積まれる人を先に数える。 */
function sameDate(a, b){
  var ia = toISO(a), ib = toISO(b);
  if(ia && ib) return ia === ib;
  return String(a==null?"":a).trim() === String(b==null?"":b).trim();
}
/* 「次会う日」の日付が実際に変わり、かついまの予定が空でないときだけ履歴が積まれる。 */
function willAppendHistory(o, values){
  var old = o["次会う日"] || "";
  return !!old && !sameDate(old, values["次会う日"] || "");
}
function refreshBulkWarnings(){
  BULK_LIST.forEach(function(o, i){
    var el = document.getElementById("br"+i+"-warn");
    if(!el) return;
    var entry = [o["次会う日"]||"", o["次会う日にする事"]||""].filter(Boolean).join(" ");
    el.textContent = willAppendHistory(o, bulkRowValues(i))
      ? "履歴に「" + entry + "」が積まれます"
      : "";
  });
}

function openBulkSheet(){
  BULK_LIST = bulkPicked();
  if(!BULK_LIST.length) return;
  document.getElementById("ba-ac").innerHTML = actionOptionsHTML("");
  ["ba-ad","ba-nd","ba-nw","ba-ac"].forEach(function(id){ document.getElementById(id).value = ""; });
  document.getElementById("bulk-rows").innerHTML = BULK_LIST.map(bulkRowHTML).join("");
  document.getElementById("bulk-message").textContent = "";
  var save = document.getElementById("bulk-save");
  save.textContent = BULK_LIST.length + " 人をまとめて保存";
  save.disabled = false;
  refreshBulkWarnings();
  document.getElementById("bulk-dialog").showModal();
}

function applyToAll(){
  Object.keys(BULK_FIELDS).forEach(function(k){
    var from = document.getElementById("ba-"+k);
    var v = (from.type === "date") ? from.value : from.value.trim();
    if(!v) return;                       // 空欄の項目は各行の値のまま
    BULK_LIST.forEach(function(o, i){
      var to = document.getElementById("br"+i+"-"+k);
      if(!to) return;
      // 日付として読めない値が入っていた行はテキスト入力になっている。表記を合わせてから入れる。
      to.value = (from.type === "date" && to.type !== "date") ? fromISO(v) : v;
    });
  });
  refreshBulkWarnings();
}

/* 1行ぶんの入力値。単票の編集と同じく、変更の有無にかかわらず4項目を送る。
   同じ値の書き戻しは無害で（次会う日が実質同じなら履歴も積まれない）、差分を持たずに済む。 */
function bulkRowValues(i){
  return {
    "アクション日": readDateInput("br"+i+"-ad"),
    "アクション内容": document.getElementById("br"+i+"-ac").value,
    "次会う日": readDateInput("br"+i+"-nd"),
    "次会う日にする事": document.getElementById("br"+i+"-nw").value.trim()
  };
}

/* 送った値を行に戻す。行を作り直すと DATA から埋め直されるので、
   保存できなかった人の入力がそのまま消えてしまう。 */
function setBulkRowValues(i, v){
  ["ad","nd"].forEach(function(k, n){
    var el = document.getElementById("br"+i+"-"+k);
    var raw = v[n === 0 ? "アクション日" : "次会う日"] || "";
    if(el) el.value = (el.type === "date") ? toISO(raw) : raw;
  });
  document.getElementById("br"+i+"-ac").value = v["アクション内容"] || "";
  document.getElementById("br"+i+"-nw").value = v["次会う日にする事"] || "";
}

/* 保存できなかった人だけをシートに残し、理由を各行に出す。
   もう一度「まとめて保存」を押すと、残った人だけが再送される。 */
function showBulkFailures(failed){
  BULK_LIST = failed.map(function(f){ return f.o; });
  document.getElementById("bulk-rows").innerHTML = BULK_LIST.map(bulkRowHTML).join("");
  failed.forEach(function(f, i){
    setBulkRowValues(i, f.values);
    var el = document.getElementById("br"+i+"-msg");
    if(el){
      el.textContent = f.r ? contactWriteError(f.r) : "保存できませんでした";
      el.className = "bulk-row-msg err";
    }
  });
  var save = document.getElementById("bulk-save");
  save.textContent = BULK_LIST.length + " 人をまとめて保存";
  save.disabled = false;
  document.getElementById("bulk-message").textContent =
    failed.length + " 人が保存できませんでした。内容を直して、もう一度保存してください。";
  // 成功した人は選択から外す。やめて選び直したときに、残っているのが未保存の人だけになる。
  BULK_PICKED = {};
  BULK_LIST.forEach(function(o){ BULK_PICKED[plantKey(o)] = true; });
  render();
  syncBulkBar();
}

function saveBulk(){
  if(CONTACT_EDIT_BUSY)return;
  var token = getWriteToken() || askWriteToken();
  var msg = document.getElementById("bulk-message");
  if(!token){ msg.textContent = "合言葉が必要です"; return; }
  var save = document.getElementById("bulk-save");
  if(save.disabled) return;
  var items;
  try{items = BULK_LIST.map(function(o, i){
    return { row: o._row, name: o["名前(あだ名)"], version:requireContactVersion(o), values: bulkRowValues(i) };
  });}catch(e){msg.textContent=e.message;return;}
  var withHistory = BULK_LIST.filter(function(o, i){ return willAppendHistory(o, items[i].values); }).length;
  if(!confirm(items.length + " 人の予定を更新します。"
      + (withHistory ? "うち " + withHistory + " 人は、いまの予定が履歴に追記されます。" : "履歴に追記される人はいません。"))) return;
  save.disabled = true;
  BULK_SAVE_BUSY = true;
  msg.textContent = "保存中…";
  contactWriteStatus('保存中…（シートへの保存を確認中）');
  CONTACT_REVISION++;   // 保存中に届いた古い再取得結果で巻き戻されないようにする
  fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: token, action: "bulk", items: items }),signal:AbortSignal.timeout(30000)
  })
  .then(function(res){ return res.json(); })
  .then(async function(j){
    if(!j.ok){
      if(String(j.error||"").indexOf("unauthorized") >= 0){
        setWriteToken("");   // 違う合言葉は覚えさせない
        throw new Error("合言葉が違います。保存をもう一度押して入れ直してください");
      }
      throw new Error(j.message || j.error || "unknown");
    }
    CONTACT_REVISION++;
    var results = j.results || [];
    var failed = [];
    BULK_LIST.forEach(function(o, i){
      var r = results[i];
      if(!r || !r.ok){ failed.push({ o:o, r:r, values: items[i].values }); return; }
      o = DATA.find(function(current){return current._row===o._row;}) || o;
      if(r.row && r.row !== o._row) o._row = r.row;   // サーバーが直した行番号に追従する
      var applied = r.updated || items[i].values;
      if(r.version)o._version=r.version;
      Object.keys(applied).forEach(function(k){ if(applied[k]) o[k] = applied[k]; else delete o[k]; });
    });
    var cached=await persistSavedState();contactWriteStatus(failed.length?'一部の保存に失敗しました。入力を保持しています。':'同期済み'+(cached?'':'（端末保存なし）'));
    if(failed.length) return showBulkFailures(failed);
    document.getElementById("bulk-dialog").close();
    setBulkMode(false);
  })
  .catch(function(err){
    save.disabled = false;
    msg.textContent = "保存に失敗：" + (err.message || err);
    contactWriteStatus('同期失敗・編集画面で再試行してください。');
  }).finally(function(){BULK_SAVE_BUSY=false;});
}

document.getElementById("bulk-rows").addEventListener("change", refreshBulkWarnings);
document.getElementById("bulk-rows").addEventListener("input", refreshBulkWarnings);
document.getElementById("bulk-open").addEventListener("click", openBulkSheet);
document.getElementById("bulk-save").addEventListener("click", saveBulk);
document.getElementById("bulk-apply").addEventListener("click", applyToAll);
document.getElementById("bulk-close").addEventListener("click", function(){ if(!BULK_SAVE_BUSY)document.getElementById("bulk-dialog").close(); });
document.getElementById('bulk-dialog').addEventListener('cancel',function(e){if(BULK_SAVE_BUSY)e.preventDefault();});

/* ===================== 人脈ガーデン ===================== */

var PLANT_META = {
  A: { kind:"手のかかる花", cycle:14,  emo:"🌻", wilt:"🥀" },
  B: { kind:"つぼみ",       cycle:30,  emo:"🌷", wilt:"🥀" },
  C: { kind:"季節の花",     cycle:90,  emo:"🌼", wilt:"🥀" },
  D: { kind:"野草",         cycle:120, emo:"🌿", wilt:"🍂" }
};
var VIEW = "garden";
var SELECTED = null;
var GARDEN_DETAIL_HIDDEN = false;

/* 日次でデータが再生成されても壊れないキー（並び順に依存しない） */
function plantKey(o){
  return [o["名前(あだ名)"]||"", o["カテゴリー"]||"", o["出会った日"]||""].join("|");
}
function todayISO(){
  var d = new Date();
  return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
}
function isoToDate(s){
  var m = String(s||"").match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2]-1, +m[3]) : null;
}
function daysBetween(a, b){
  a = new Date(a); b = new Date(b);
  a.setHours(0,0,0,0); b.setHours(0,0,0,0);
  return Math.round((b - a) / 86400000);
}

/* 株の状態を計算。
   期日 = アクション日（次に連絡すべき予定日）。
   overdue = 今日 − 期日（プラスなら水切れ＝要連絡） */
function plantState(o){
  var cat = o["カテゴリー"] || "D";
  var meta = PLANT_META[cat] || PLANT_META.D;
  var today = new Date(); today.setHours(0,0,0,0);
  var due = parseDate(o["アクション日"]);
  var basis = "action";
  var overdue = due ? daysBetween(due, today) : 0;
  var grace = Math.ceil(meta.cycle / 3);
  var r = overdue / grace;
  var st, label, msg;
  if(overdue < 0){ st="st-fresh"; label="元気"; msg="いきいきしています。次の水やりは "+fmtDate(due)+" ごろ。"; }
  else if(overdue === 0){ st="st-ok"; label="水やり日"; msg="今日が水やりの日です。"; }
  else if(r <= 1){ st="st-thirsty"; label="のどが渇いた"; msg=overdue+"日 水をもらえていません。そろそろ声をかけて。"; }
  else if(r <= 2){ st="st-wilting"; label="しおれてきた"; msg=overdue+"日 放置ぎみ。葉が垂れてきました。"; }
  else { st="st-dying"; label="枯れかけ"; msg=overdue+"日 も水切れ。今すぐ水やりを。"; }
  /* 土の残り水分（0〜100%） */
  var moist;
  if(overdue < 0) moist = 100;
  else moist = Math.max(0, Math.round(100 - (overdue / (grace*3)) * 100));
  return { cat:cat, meta:meta, st:st, label:label, msg:msg, overdue:overdue, moist:moist,
           due:due, basis:basis, watered:null, thirsty:(overdue > 0) };
}
function fmtDate(d){
  return d ? (d.getMonth()+1)+"/"+d.getDate() : "—";
}
function plantEmoji(s){
  var cat = /^[ABCD]$/.test(s.cat) ? s.cat : "D";
  return '<span class="garden-icon icon-' + cat + '" role="img" aria-label="' + esc(s.meta.kind + (s.label ? '：' + s.label : '')) + '"></span>';
}

function gardenList(){
  var cats = checkedCats();
  return DATA.filter(function(o){ return cats[o["カテゴリー"]] && matchSearch(o); });
}

function renderGarden(){
  if(typeof renderContactSuggestions==='function')renderContactSuggestions();
  var list = gardenList();
  var states = list.map(function(o){ return { o:o, s:plantState(o), m:meetInfo(o["次会う日"]), n:nutritionOf(o) }; });

  /* 乾いている株を優先、その中で放置日数が多い順 */
  var thirsty = states.filter(function(x){ return x.s.thirsty; })
                      .sort(function(a,b){ return b.s.overdue - a.s.overdue; });
  var dying = states.filter(function(x){ return x.s.st==="st-dying"; });

  /* 庭の充実度＝各株の栄養%の平均。「あと1項目」の株は埋めに行きやすいので別枠で出す。 */
  var nutPct = states.length
    ? Math.round(states.reduce(function(a, x){ return a + x.n.pct; }, 0) / states.length) : 100;
  var almostList = states.filter(function(x){ return x.n.missing.length === 1; });

  var stats = document.getElementById("gdstats");
  stats.innerHTML =
      '<div class="gd-stat"><b>' + states.length + '</b>庭の株</div>'
    + '<div class="gd-stat"><b>' + (states.length - thirsty.length) + '</b>元気</div>'
    + '<div class="gd-stat thirsty"><b>' + thirsty.length + '</b>水やり待ち</div>'
    + '<div class="gd-stat warn"><b>' + dying.length + '</b>枯れかけ</div>'
    + '<div class="gd-stat nut"><b>' + nutPct + '%</b>庭の充実度</div>'
    + (almostList.length ? '<div class="gd-stat last"><b>' + almostList.length + '</b>あと1項目</div>' : "");

  /* 1週間以内に会う予定（当日〜7日前） */
  var meets = states.filter(function(x){ return x.m; })
                    .sort(function(a,b){ return a.m.n - b.m.n; });
  var meetBox = document.getElementById("gdmeet");
  if(meets.length){
    meetBox.innerHTML = '<div class="gd-meet">'
      + '<div class="gd-meet-t">📅 まもなく会う人（1週間以内 ' + meets.length + '人）</div>'
      + '<div class="gd-meet-list">'
      + meets.map(function(x){
          return '<button class="gd-mchip ' + x.m.cls + '" data-k="' + esc(plantKey(x.o)) + '">'
               + '<span class="gd-mday">' + esc(x.m.label) + '</span>'
               + esc(x.o["名前(あだ名)"]||"(名前なし)")
               + '<span class="gd-mdate">' + esc(x.o["次会う日"]) + '</span>'
               + (x.o["次会う日にする事"] ? '<span class="gd-mwhat">' + esc(x.o["次会う日にする事"]) + '</span>' : "")
               + '</button>';
        }).join("")
      + '</div></div>';
  } else {
    meetBox.innerHTML = "";
  }

  var call = document.getElementById("gdcall");
  if(thirsty.length){
    call.innerHTML = '<div class="gd-call">'
      + '<div class="gd-call-t">💧 「水をちょうだい」と言っています（' + thirsty.length + '株）</div>'
      + '<div class="gd-call-list">'
      + thirsty.slice(0,12).map(function(x){
          return '<button class="gd-chip" data-k="' + esc(plantKey(x.o)) + '">'
               + plantEmoji(x.s) + ' ' + esc(x.o["名前(あだ名)"]||"(名前なし)")
               + ' <span style="opacity:.65">' + x.s.overdue + '日</span></button>';
        }).join("")
      + (thirsty.length > 12 ? '<span class="gd-none">ほか ' + (thirsty.length-12) + '株</span>' : "")
      + '</div></div>';
  } else {
    call.innerHTML = '<div class="gd-call"><div class="gd-none">🎉 いま水やり待ちの株はありません。庭はいい状態です。</div></div>';
  }

  /* 株のタイル1枚分のHTML */
  function plantTile(x){
    var k = plantKey(x.o);
    /* 充実度が高いほど背景を明るく（＝日の当たる肥えた土）。
       0%は背景なし、100%で白に近づける。彩度は少し残して土の温かみを保つ。 */
    var lum = 0.10 + (x.n.pct / 100) * 0.80;
    return '<button class="plant ' + x.s.st + (SELECTED===k ? ' sel' : '')
      + (BULK_MODE && BULK_PICKED[k] ? ' picked' : '') + '" data-k="' + esc(k) + '" '
      + 'style="background: rgba(255,252,242,' + lum.toFixed(2) + ')" '
      + 'title="' + esc((x.o["名前(あだ名)"]||"") + " / " + x.s.label + " / 充実度 " + x.n.pct + "%") + '">'
      + (x.s.thirsty ? '<span class="plant-drop">💧</span>' : "")
      + '<span class="plant-emoji">' + plantEmoji(x.s) + '</span>'
      + '<span class="plant-name">' + esc(x.o["名前(あだ名)"]||"(名前なし)") + '</span>'
      + '<span class="plant-soil"><i style="width:' + x.s.moist + '%"></i></span>'
      + (x.n.missing.length === 1 ? '<span class="plant-last">あと1</span>' : "")
      + (x.m ? '<span class="plant-meet ' + x.m.cls + '">📅' + esc(x.m.label) + '</span>' : "")
      + '</button>';
  }

  /* 庭の並び：カテゴリごとに A→B→C→D の順で区切って並べる。
     各カテゴリの中は「水やり待ちを先に、放置日数の多い順」。 */
  var byCat = {};
  CATS.forEach(function(c){ byCat[c] = []; });
  states.forEach(function(x){
    var c = (byCat[x.s.cat] ? x.s.cat : "D");
    byCat[c].push(x);
  });
  var groups = CATS.map(function(c){
    var arr = byCat[c].sort(function(a,b){
      if(a.s.thirsty !== b.s.thirsty) return a.s.thirsty ? -1 : 1;
      return b.s.overdue - a.s.overdue;
    });
    if(!arr.length && !document.querySelector('#catfilter input[value="'+c+'"]').checked) return "";
    var meta = PLANT_META[c] || PLANT_META.D;
    var need = arr.filter(function(x){ return x.s.thirsty; }).length;
    return '<div class="gd-group">'
      + '<div class="gd-group-h">'
      + (BULK_MODE ? '<label class="bulk-gcat-wrap"><input type="checkbox" class="bulk-gcat" data-cat="'+c+'"'
          + (arr.length && arr.every(function(x){ return BULK_PICKED[plantKey(x.o)]; }) ? ' checked' : '')
          + ' aria-label="カテゴリ '+c+' の株を全部選ぶ"></label>' : '')
      + '<span class="cbadge ' + c + '">' + c + '</span>'
      + '<span>' + plantEmoji({cat:c,meta:meta}) + ' ' + esc(meta.kind) + '（' + meta.cycle + '日周期）</span>'
      + '<span class="gd-gcount">' + arr.length + '株'
      + (need ? ' ／ 水やり待ち ' + need : '') + '</span>'
      + '<button type="button" class="gd-add" data-category="'+c+'" aria-label="カテゴリ '+c+' に新しい人を登録" title="新しい人を登録">＋</button>'
      + '</div>'
      + '<div class="gd-grid">' + arr.map(plantTile).join("") + '</div>'
      + '</div>';
  }).join("");
  document.getElementById("garden").innerHTML =
    groups || '<div class="gd-none">該当する株がありません</div>';
  document.querySelectorAll(".gd-add").forEach(function(el){el.addEventListener("click",function(){openCreatePerson(this.dataset.category);});});
  document.querySelectorAll(".bulk-gcat").forEach(function(el){
    el.addEventListener("change", function(){
      var on = this.checked, group = this.closest(".gd-group");
      if(!group) return;
      group.querySelectorAll(".plant").forEach(function(p){
        var k = p.getAttribute("data-k");
        if(on) BULK_PICKED[k] = true; else delete BULK_PICKED[k];
      });
      renderGarden();
      syncBulkBar();
    });
  });

  document.querySelectorAll(".plant, .gd-chip, .gd-mchip").forEach(function(el){
    el.addEventListener("click", function(e){
      var k = this.getAttribute("data-k");
      // Ctrl（Macは⌘）+クリックは、ボタンを押さずにその場で選択を始める合図。
      // 既に選択中なら何も足さず、下のトグルにそのまま流す（二重に反応させない）。
      if(!BULK_MODE && (e.ctrlKey || e.metaKey)) BULK_MODE = true;
      // まとめて編集中は、株を押す＝選ぶ。詳細パネルは開かない（やめれば元どおり開く）。
      if(BULK_MODE){
        if(BULK_PICKED[k]) delete BULK_PICKED[k]; else BULK_PICKED[k] = true;
        renderGarden();
        syncBulkBar();
        return;
      }
      SELECTED = k;
      GARDEN_DETAIL_HIDDEN = false;
      renderGarden();
      var p = document.getElementById("gdpanel");
      if(p && p.scrollIntoView) p.scrollIntoView({ block:"nearest" });
    });
  });

  renderPanel();
  updateFoot(states.length);
}

/* --- 日付ピッカー用の変換 ---
   シートは "7/20"（年省略）や "2026/05/23" 形式、<input type="date"> は "YYYY-MM-DD" 固定。
   保存時はシートの書式に合わせて戻す（今年なら M/D、他の年は YYYY/M/D）。 */
function toISO(str){
  var d = parseDate(str);
  if(!d) return "";
  var p = function(n){ return (n < 10 ? "0" : "") + n; };
  return d.getFullYear() + "-" + p(d.getMonth()+1) + "-" + p(d.getDate());
}
function fromISO(iso){
  if(!iso) return "";
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return String(iso).trim();
  var y = +m[1], mo = +m[2], da = +m[3];
  return (y === new Date().getFullYear()) ? (mo + "/" + da) : (y + "/" + mo + "/" + da);
}
// 日付として読めない値をピッカーに載せると消えてしまうので、その場合だけテキスト入力にする
function dateInputHTML(id, val){
  var iso = toISO(val);
  if(!val || iso) return '<input id="' + id + '" type="date" value="' + esc(iso) + '">';
  return '<input id="' + id + '" type="text" value="' + esc(val) + '">';
}
function readDateInput(id){
  var el = document.getElementById(id);
  if(!el) return "";
  return (el.type === "date") ? fromISO(el.value) : el.value.trim();
}

function panelEditorHTML(o){
  var opts = ACTION_OPTIONS.map(function(x){
    return '<option value="' + esc(x) + '"' + (((o["アクション内容"]||"") === x) ? " selected" : "") + '>' + (x ? esc(x) : "（なし）") + '</option>';
  }).join("");
  var cur = [o["次会う日"]||"", o["次会う日にする事"]||""].filter(Boolean).join(" ") || "なし";
  return '<div class="gd-edit">'
    + '<div class="gd-edit-grid">'
    + '<label>アクション日' + dateInputHTML("ge-ad", o["アクション日"]||"") + '</label>'
    + '<label>アクション内容<select id="ge-ac">' + opts + '</select></label>'
    + '<label>次会う日' + dateInputHTML("ge-nd", o["次会う日"]||"") + '</label>'
    + '<label>次会う日にする事<input id="ge-nw" type="text" value="' + esc(o["次会う日にする事"]||"") + '" placeholder="例: サシ"></label>'
    + '</div>'
    + '<div class="gd-edit-note">※「次会う日」を変えたときだけ、いまの予定（' + esc(cur) + '）が履歴に追記されます（する事だけの修正では追記しません）。</div>'
    + '<div class="gd-edit-tools">'
    + '<button class="gd-save" id="ge-save">保存</button>'
    + '<button class="gd-cancel" id="ge-cancel">キャンセル</button>'
    + '<span class="gd-edit-msg" id="ge-msg"></span>'
    + '</div></div>';
}

function saveEdit(o){
  if(CONTACT_EDIT_BUSY||BULK_SAVE_BUSY)return;
  var msg = document.getElementById("ge-msg");
  var token = getWriteToken() || askWriteToken();
  try{requireContactVersion(o);}catch(e){msg.textContent=e.message;msg.className='gd-edit-msg err';return;}
  if(!token){ msg.textContent = "合言葉が必要です"; msg.className = "gd-edit-msg err"; return; }
  var values = {
    "アクション日": readDateInput("ge-ad"),
    "アクション内容": document.getElementById("ge-ac").value,
    "次会う日": readDateInput("ge-nd"),
    "次会う日にする事": document.getElementById("ge-nw").value.trim()
  };
  msg.textContent = "保存中…"; msg.className = "gd-edit-msg";
  /* 連打による二重送信を止める。同じ保存が2回届くと、どちらも変更前の「次会う日」を
     読んでしまい、履歴に同じ予定が二重に追記される。 */
  var saveBtn = document.getElementById("ge-save");
  if(saveBtn){ if(saveBtn.disabled) return; saveBtn.disabled = true; }
  var reenable = function(){ if(saveBtn) saveBtn.disabled = false; };
  CONTACT_REVISION++;
  CONTACT_EDIT_BUSY=true;contactWriteStatus('保存中…（シートへの保存を確認中）');
  return fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: token, row: o._row, name: o["名前(あだ名)"], version:o._version, values: values }),signal:AbortSignal.timeout(30000)
  })
  .then(function(res){ return res.json(); })
  .then(async function(j){
    if(!j.ok){
      if(String(j.error||"").indexOf("unauthorized") >= 0){
        setWriteToken(""); // 違う合言葉は覚えさせない
        throw new Error("合言葉が違います。保存をもう一度押して入れ直してください");
      }
      throw new Error(contactWriteError(j));
    }
    // サーバー側で行ズレを直した場合、その行番号に追従する（同じ画面での次の保存に効く）
    if(j.row && j.row !== o._row) o._row = j.row;
    // サーバーが返した更新後の値を反映（履歴への自動追記を含む）
    var applied = j.updated || values;
    if(j.version)o._version=j.version;
    CONTACT_REVISION++;
    Object.keys(applied).forEach(function(k){ if(applied[k]) o[k] = applied[k]; else delete o[k]; });
    var cached=await persistSavedState();contactWriteStatus('同期済み'+(cached?'':'（端末保存なし）'));
    PANEL_EDIT = false;
    renderGarden();
  })
  .catch(function(err){
    reenable();
    var m = document.getElementById("ge-msg");
    if(m){ m.textContent = "保存に失敗：" + (err.message || err); m.className = "gd-edit-msg err"; }
    contactWriteStatus('同期失敗・編集画面で再試行してください。');
  }).finally(function(){CONTACT_EDIT_BUSY=false;});
}

/* プロフィール編集フォーム（13項目まとめて）。保存ボタンは1つで、変更した項目だけ一括送信する。 */
function profEditorHTML(o){
  var rows = PROFILE_FIELDS.map(function(f, i){
    var key = f[0], label = f[1];
    var cur = o[key] == null ? "" : String(o[key]);
    var input = DATE_FIELDS[key]
      ? dateInputHTML("pe-" + i, cur)
      : '<input id="pe-' + i + '" type="text" value="' + esc(cur) + '">';
    return '<label' + (hasVal(o, key) ? '' : ' class="pe-empty"') + '><span>' + esc(label) + '</span>' + input + '</label>';
  }).join("");
  return '<div class="gd-prof">'
    + '<div class="gd-prof-grid">' + rows + '</div>'
    + '<div class="gd-prof-tools">'
    + '<button class="gd-save" id="pe-save">まとめて保存</button>'
    + '<button class="gd-cancel" id="pe-cancel">キャンセル</button>'
    + '<span class="gd-edit-msg" id="pe-msg"></span>'
    + '</div></div>';
}

function saveProfile(o){
  if(CONTACT_EDIT_BUSY||BULK_SAVE_BUSY)return;
  var msg = document.getElementById("pe-msg");
  function fail(t){ var m = document.getElementById("pe-msg"); if(m){ m.textContent = t; m.className = "gd-edit-msg err"; } }
  var token = getWriteToken() || askWriteToken();
  try{requireContactVersion(o);}catch(e){fail(e.message);return;}
  if(!token){ fail("合言葉が必要です"); return; }

  // 変更のあった項目だけ集める（空にした場合も "" を送ってクリア）
  var values = {};
  PROFILE_FIELDS.forEach(function(f, i){
    var key = f[0];
    var el = document.getElementById("pe-" + i);
    if(!el) return;
    var nv = (el.type === "date") ? fromISO(el.value) : el.value.trim();
    var cv = o[key] == null ? "" : String(o[key]).trim();
    if(nv !== cv) values[key] = nv;
  });
  var changed = Object.keys(values);
  if(!changed.length){ if(msg){ msg.textContent = "変更はありません"; msg.className = "gd-edit-msg"; } return; }
  var saveBtn=document.getElementById('pe-save');if(saveBtn&&saveBtn.disabled)return;if(saveBtn)saveBtn.disabled=true;

  if(msg){ msg.textContent = "保存中…（" + changed.length + "項目）"; msg.className = "gd-edit-msg"; }
  CONTACT_REVISION++;
  CONTACT_EDIT_BUSY=true;contactWriteStatus('保存中…（シートへの保存を確認中）');
  return fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: token, row: o._row, name: o["名前(あだ名)"], version:o._version, values: values }),signal:AbortSignal.timeout(30000)
  })
  .then(function(r){ return r.json(); })
  .then(async function(j){
    if(!j.ok){
      if(String(j.error||"").indexOf("unauthorized") >= 0){ setWriteToken(""); throw new Error("合言葉が違います。保存を押して入れ直してください"); }
      throw new Error(contactWriteError(j));
    }
    var applied = j.updated || values;
    if(j.version)o._version=j.version;
    if(j.row)o._row=j.row;
    CONTACT_REVISION++;
    Object.keys(applied).forEach(function(k){ if(applied[k]) o[k] = applied[k]; else delete o[k]; });
    var cached=await persistSavedState();contactWriteStatus('同期済み'+(cached?'':'（端末保存なし）'));
    PROF_EDIT = false;
    renderGarden();
  })
  .catch(function(err){ fail("失敗：" + (err.message || err));contactWriteStatus('同期失敗・編集画面で再試行してください。'); }).finally(function(){CONTACT_EDIT_BUSY=false;if(saveBtn)saveBtn.disabled=false;});
}

function renderPanel(){
  var panel = document.getElementById("gdpanel");
  var wasHidden = panel.hidden;
  panel.hidden = GARDEN_DETAIL_HIDDEN;
  if(panel.hidden) return;
  // Keep the editor DOM and its unsaved inputs when clearing a search.
  if(wasHidden && PANEL_EDIT_KEY === SELECTED && (PANEL_EDIT || PROF_EDIT)) return;
  if(!SELECTED){ panel.innerHTML = ""; return; }
  if(PANEL_EDIT_KEY !== SELECTED){ PANEL_EDIT = false; PROF_EDIT = false; PANEL_EDIT_KEY = SELECTED; } // 別の株を開いたら編集を閉じる
  var o = DATA.filter(function(x){ return plantKey(x)===SELECTED; })[0];
  if(!o){ panel.innerHTML = ""; SELECTED = null; return; }
  var s = plantState(o);
  panel.innerHTML = '<div class="gd-panel">'
    + '<div class="gd-panel-head">'
    + '<span class="gd-big">' + plantEmoji(s) + '</span>'
    + '<span class="gd-panel-name">' + esc(o["名前(あだ名)"]||"(名前なし)") + '</span>'
    + '<span class="gd-kind">' + esc(s.cat) + '・' + esc(s.meta.kind) + '</span>'
    + '<span class="gd-state ' + s.st + '">' + esc(s.label) + '</span>'
    + '</div>'
    + (function(){
        var mi = meetInfo(o["次会う日"]);
        if(!mi) return "";
        return '<div class="gd-meetline ' + mi.cls + '">'
          + '<span class="gd-mday">' + esc(mi.label) + '</span>'
          + '📅 次に会う ' + esc(o["次会う日"])
          + (o["次会う日にする事"] ? ' — ' + esc(o["次会う日にする事"]) : "")
          + '</div>';
      })()
    + cardHTML(o,true)
    + (canEdit(o) ? '<div class="gd-editrow">'
        + (PANEL_EDIT ? panelEditorHTML(o) : '<button class="gd-editbtn" id="ge-open">✏️ 予定を編集</button>')
        + (PROF_EDIT ? profEditorHTML(o) : '<button class="gd-editbtn" id="pe-open">📝 プロフィールを編集</button>')
        + '</div>' : "")
    + friendAdviceHTML(o)
    + '</div>';

  var peO = document.getElementById("pe-open");
  if(typeof wireContactSuggestions==='function')wireContactSuggestions(panel);
  if(peO) peO.addEventListener("click", function(){ PROF_EDIT = true; PANEL_EDIT = false; renderGarden(); });
  var peC = document.getElementById("pe-cancel");
  if(peC) peC.addEventListener("click", function(){ var b=document.getElementById('pe-save');if(b&&b.disabled)return;PROF_EDIT = false; renderGarden(); });
  var peS = document.getElementById("pe-save");
  if(peS) peS.addEventListener("click", function(){ saveProfile(o); });

  var eo = document.getElementById("ge-open");
  if(eo) eo.addEventListener("click", function(){ PANEL_EDIT = true; PROF_EDIT = false; renderGarden(); });
  var ec = document.getElementById("ge-cancel");
  if(ec) ec.addEventListener("click", function(){ var b=document.getElementById('ge-save');if(b&&b.disabled)return;PANEL_EDIT = false; renderGarden(); });
  var es = document.getElementById("ge-save");
  if(es) es.addEventListener("click", function(){ saveEdit(o); });
}
