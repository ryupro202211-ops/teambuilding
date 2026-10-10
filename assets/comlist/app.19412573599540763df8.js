
function setView(v){
  if(v === "garden") GARDEN_DETAIL_HIDDEN = false;
  VIEW = v;
  document.body.className = "view-" + v;
  document.querySelectorAll(".tab").forEach(function(t){
    t.classList.toggle("active", t.getAttribute("data-view") === v);
  });
  document.getElementById("sort").style.display = (v==="list") ? "" : "none";
  if(v === "analytics") renderAnalytics();
  if(v === "field") { renderFieldProgress(); if(typeof refreshFieldGoals==='function')refreshFieldGoals(); }
  if(v === "calendar") loadCalendar();
  if(v === "events") { renderEvents(); refreshEventsFromApi(); }
  if(v === "today") {
    loadToday();
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }
  render();
}

/* カレンダーは開いたときに初めて読み込む（遅延ロード） */
function loadCalendar(){
  renderSlots();
}

/* 空いてる1.5h枠を日付ごとにまとめて描画。 */
function renderLegacySlots(){
  var box = document.getElementById("slots");
  if(!box) return;
  if(!(typeof FREE_SLOTS !== "undefined") || !FREE_SLOTS || !FREE_SLOTS.length){
    box.innerHTML = '<div class="slots-empty">空き枠は毎朝のビルド時にカレンダーから計算されます。</div>';
    return;
  }
  var groups = [], last = null;
  FREE_SLOTS.forEach(function(s){
    if(!last || last.d !== s.d){ last = { d:s.d, dow:s.dow, items:[] }; groups.push(last); }
    last.items.push(s.t);
  });
  var html = '<div class="slots-head">'
    + '<span class="slots-title">🕒 空いてる1.5h枠（1ヶ月先まで）</span>'
    + '<button class="slots-copy" id="slots-copy">📋 一覧をコピー</button>'
    + '</div>'
    + '<div class="slots-note">平日＝昼 12:00-13:30 ／ 夜 18:00以降　土日＝8:00以降　※各1.5時間・毎朝更新</div>';
  html += groups.map(function(g){
    return '<div class="slot-day"><div class="slot-date">' + esc(g.d) + '(' + esc(g.dow) + ')</div>'
      + '<div class="slot-chips">' + g.items.map(function(t){ return '<span class="slot-chip">' + esc(t) + '</span>'; }).join("") + '</div></div>';
  }).join("");
  box.innerHTML = html;
  var cp = document.getElementById("slots-copy");
  if(cp) cp.addEventListener("click", function(){
    var txt = groups.map(function(g){
      return g.d + "(" + g.dow + ")\n" + g.items.map(function(t){ return "・" + t; }).join("\n");
    }).join("\n\n");
    navigator.clipboard.writeText(txt).then(function(){
      cp.textContent = "✅ コピーしました"; setTimeout(function(){ cp.textContent = "📋 一覧をコピー"; }, 1500);
    });
  });
}
/* カレンダーURLが未設定ならタブを隠す */
if(!CALENDAR_EMBED_URL){ var _ct = document.getElementById("tab-cal"); if(_ct) _ct.style.display = "none"; }

document.querySelectorAll(".tab").forEach(function(t){
  t.addEventListener("click", function(){ setView(this.getAttribute("data-view")); });
});

document.getElementById("search").addEventListener("input", function(){
  SEARCH = this.value.trim().toLowerCase();
  GARDEN_DETAIL_HIDDEN = !!SEARCH;
  render();
});
document.getElementById("sort").addEventListener("change", function(){
  SORT = this.value; render();
});
document.querySelectorAll("#catfilter input").forEach(function(c){
  c.addEventListener("change", render);
});

/* 描画は復号後に行う */
