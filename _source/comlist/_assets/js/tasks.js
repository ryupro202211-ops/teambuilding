function todayData(){
  var data = window.DAILY_TASKS && Array.isArray(window.DAILY_TASKS.tasks)
    ? window.DAILY_TASKS
    : (typeof DAILY_TASKS !== "undefined" ? DAILY_TASKS : null);
  return data && Array.isArray(data.tasks) ? data : { date:"", tasks:[] };
}

function todayStorageKey(){ return "daily-task:" + todayData().date; }

function localTaskState(){ return readTaskObject(todayStorageKey(), TASK_MEMORY); }

function isLocalTask(task){ return task && task.type !== "contact"; }

function briefIcon(index, label){
  return '<span class="brief-icon bi-' + index + '" role="img" aria-label="' + esc(label) + '"></span>';
}

// Text content only: IDs, URLs and other attributes continue to use esc().
function briefText(value){
  var symbols = ['🌅','🔥','⚡','✅','⚠','📅','👀','📭','💡','🔗','🐛','🐝','🦈','👹','💀','🔴','🟡','🟢','🔒','🎉','↗','🚨','⭐','📋','🛡'];
  var labels = ['朝','期限切れ','自分タスク','完了','注意','予定','先回り','期限なし','ヒント','リンク','幼虫','蜂','鮫','鬼','骸骨','高優先度','中優先度','低優先度','ロック','達成','開く','アラート','星','タスク','保護'];
  var segments = new Intl.Segmenter('ja', { granularity:'grapheme' }).segment(String(value == null ? '' : value));
  return Array.from(segments, function(item){
    var text = item.segment;
    var index = symbols.indexOf(text.replace(/[\uFE0E\uFE0F]/g, ''));
    if(index >= 0) return briefIcon(index, labels[index]);
    // Drop unsupported emoji as a whole, including flags, modifiers and ZWJ sequences.
    if(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\p{Emoji_Modifier}\u20E3\uFE0F\u200D\u{E0020}-\u{E007F}]/u.test(text)) return '';
    return esc(text);
  }).join('');
}

function tasksIn(section){
  return todayData().tasks.filter(function(task){ return isLocalTask(task) && (task.section || "other") === section; });
}
function upcomingSoon(){
  var date = todayData().date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  var today = Date.parse(date + "T00:00:00Z");
  if(!Number.isFinite(today)) return [];
  return tasksIn("upcoming").filter(function(task){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(task.due || "")) return false;
    var due = Date.parse(task.due + "T00:00:00Z");
    var days = (due - today) / 86400000;
    return Number.isInteger(days) && days >= 1 && days <= 3;
  });
}
function nextActionTask(saved){
  var unfinished = function(section){ return tasksIn(section).filter(function(task){ return saved[String(task.id || "")] !== true; }); };
  var byOverdue = function(a, b){ return (Number(b.overdueDays) || 0) - (Number(a.overdueDays) || 0); };
  var groups = [
    unfinished("selfOverdue").sort(byOverdue),
    unfinished("today"),
    unfinished("todo").sort(function(a,b){ return priorityIndex(a.priority) - priorityIndex(b.priority); }),
    unfinished("memberOverdue").sort(byOverdue),
    upcomingSoon().filter(function(task){ return saved[String(task.id || "")] !== true; }),
    unfinished("other")
  ];
  return groups.find(function(group){ return group.length; })?.[0] || null;
}
function nextActionHTML(saved){
  var task = nextActionTask(saved);
  if(!task) return '<div><div class="today-next-label">次にやること</div><div class="today-next-title">今日の対象はありません。</div></div>';
  var section = { selfOverdue:"自分の期限切れ", today:"今日中の期限", todo:"今日のToDo", memberOverdue:"メンバーの期限切れ", upcoming:"3日先までの準備", other:"その他ToDo" }[task.section || "other"] || "今日のタスク";
  return '<div><div class="today-next-label">次にやること</div><div class="today-next-title">' + briefText(task.title || "") + '</div>'
    + '<div class="today-next-note">' + esc(section) + '</div></div>'
    + '<button type="button" class="btn" data-next-task="' + esc(String(task.id || "")) + '">タスクを見る</button>';
}
function updateNextAction(saved){
  var box = document.getElementById("todayNextAction");
  if(box) box.innerHTML = nextActionHTML(saved);
}
function monsterIndex(days){ return days >= 9 ? 14 : days >= 7 ? 13 : days >= 5 ? 12 : days >= 3 ? 11 : 10; }
function monsterLevel(days){ return Math.max(1, Number(days) || 0); }
function priorityIndex(priority){ return priority === "high" ? 15 : priority === "medium" ? 16 : 17; }
function overdueTask(task){ return task.section === "selfOverdue" || task.section === "memberOverdue"; }
function monsterBadge(task){
  if(!overdueTask(task) || !Number.isInteger(task.overdueDays) || task.overdueDays < 1) return "";
  var index = monsterIndex(task.overdueDays);
  return '<span class="today-monster">' + briefIcon(index, ["幼虫","蜂","鮫","鬼","骸骨"][index - 10])
    + 'Lv.' + monsterLevel(task.overdueDays) + '</span>';
}
/* スマホ幅では、朝いちばんに見る区分（戦果・期限切れ・ToDo）だけを開いて他は畳んでおく。
   見出しを押せば開閉できる。 */
var BRIEF_OPEN_ON_MOBILE = { victory:1, selfOverdue:1, memberOverdue:1, todo:1 };
function briefIsMobile(){
  try { return !!(window.matchMedia && window.matchMedia("(max-width: 640px)").matches); } catch(e){ return false; }
}
function briefSection(section, title, icon, content, extraClass){
  var collapsed = briefIsMobile() && !BRIEF_OPEN_ON_MOBILE[section];
  return '<section class="today-card' + (extraClass ? ' ' + extraClass : '') + (collapsed ? ' collapsed' : '') + '" data-section="' + section + '"><h2>'
    + briefIcon(icon, title) + title + '</h2><div class="today-card-body">' + content + '</div></section>';
}

/* 撃破数の履歴（build.js が victoryLog に積む）を今週・先週の合計にする。週は月曜始まり。 */
function victoryHistoryHTML(){
  var daily = todayData();
  var log = Array.isArray(daily.victoryLog) ? daily.victoryLog : [];
  if(!log.length || !/^\d{4}-\d{2}-\d{2}$/.test(String(daily.date || ""))) return "";
  var base = new Date(daily.date + "T00:00:00Z");
  var monday = new Date(base); monday.setUTCDate(base.getUTCDate() - ((base.getUTCDay() + 6) % 7));
  var prevMonday = new Date(monday); prevMonday.setUTCDate(monday.getUTCDate() - 7);
  var iso = function(d){ return d.toISOString().slice(0, 10); };
  var thisWeek = 0, lastWeek = 0;
  log.forEach(function(row){
    var n = Number(row && row.count) || 0, d = String(row && row.date || "");
    if(d >= iso(monday) && d <= daily.date) thisWeek += n;
    else if(d >= iso(prevMonday) && d < iso(monday)) lastWeek += n;
  });
  return '<div class="victory-history"><span>今週<b>' + esc(thisWeek) + '</b></span><span>先週<b>' + esc(lastWeek) + '</b></span></div>';
}

/* 次会う日が3日以内の人を、今日のToDoに「会う準備」として並べる。チェック対象ではなく表示だけ。 */
function meetPrepHTML(){
  var people = (typeof DATA !== "undefined" && Array.isArray(DATA)) ? DATA : [];
  var rows = people.map(function(o){ return { o:o, m:meetInfo(o && o["次会う日"]) }; })
    .filter(function(x){ return x.m && x.m.n <= 3; })
    .sort(function(a, b){ return a.m.n - b.m.n; });
  if(!rows.length) return "";
  return '<div class="meet-prep"><h3>' + briefIcon(5, "予定") + '近く会う人の準備</h3>' + rows.map(function(x){
    var o = x.o;
    var insta = /^https:\/\//.test(String(o["Insta URL"] || "")) ? o["Insta URL"] : "";
    var hints = [["趣味", o["趣味・部活(R)"]], ["目標", o["目標(D)"]]].filter(function(h){ return h[1]; })
      .map(function(h){ return h[0] + ": " + meetPrepClip(h[1], 40); }).join(" ／ ");
    return '<div class="meet-prep-row"><div class="meet-head"><span class="nb ' + x.m.cls + '">' + esc(x.m.label) + '</span>'
      + '<b>' + esc(o["名前(あだ名)"] || "") + '</b>'
      + (o["次会う日にする事"] ? '<span class="meet-what">' + esc(o["次会う日にする事"]) + '</span>' : '')
      + '<button type="button" class="meet-open" data-meet-open="' + esc(plantKey(o)) + '">カードを開く</button></div>'
      + ((o["LINE/Insta名"] || insta) ? '<div class="meet-sub">連絡先: ' + esc(o["LINE/Insta名"] || "")
        + (insta ? ' <a href="' + esc(insta) + '" target="_blank" rel="noopener">Instagram</a>' : '') + '</div>' : '')
      + (lastHistory(o) ? '<div class="meet-sub">前回: ' + esc(meetPrepClip(lastHistory(o), 60)) + '</div>' : '')
      + (hints ? '<div class="meet-sub">話題: ' + esc(hints) + '</div>' : '')
      + '</div>';
  }).join("") + '</div>';
}
function meetPrepClip(s, n){ s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; }
/* 履歴は「7/22 夢マップ 8/5 飲み」のように末尾へ追記される（sheet-api.gs の HISTORY_SEP は半角スペース）。
   最後の「月/日」から末尾までを「前回」とする。日付が無ければ最後の行をそのまま使う。 */
function lastHistory(o){
  var text = String(o["履歴"] || "").trim();
  if(!text) return "";
  var re = /(^|\s)(\d{1,2}\/\d{1,2})(?=\s|$)/g, m, at = -1;
  while((m = re.exec(text))) at = m.index + m[1].length;
  if(at >= 0) return text.slice(at).trim();
  var lines = text.split(/\r?\n/).filter(function(l){ return l.trim(); });
  return lines[lines.length - 1].trim();
}
/* 「カードを開く」は人脈ガーデンに切り替え、その人の詳細パネルを開く */
function openPersonFromBrief(key){
  if(typeof setView === "function") setView("garden");
  SELECTED = key;
  if(typeof renderGarden === "function") renderGarden();
  var p = document.getElementById("gdpanel");
  if(p && p.scrollIntoView) p.scrollIntoView({ block:"nearest" });
}
function sourceRows(sources){
  sources = sources || {};
  return ["calendar", "notion", "gmail"].map(function(key){
    var source = sources[key] || {};
    var ok = source.ok === true;
    var note = "";
    if(key === "gmail"){
      var valid = Number.isInteger(source.checkedThreads) && source.checkedThreads >= 0
        && Number.isInteger(source.uniqueThreads) && source.uniqueThreads >= 0;
      ok = valid && source.checkedThreads === source.uniqueThreads && source.ok !== false;
      if(valid) note = ' / 確認 ' + source.checkedThreads + '件・重複排除後 ' + source.uniqueThreads + '件';
    }
    var name = {calendar:"Calendar", notion:"Notion", gmail:"Gmail"}[key];
    return '<div class="today-source">' + briefIcon(ok ? 3 : 4, ok ? "確認済み" : "注意")
      + name + '：' + (ok ? "確認済み" : source.ok === false ? "未取得" : "未確認") + note + '</div>';
  }).join("");
}

/* 担当者は owner を正とし、無い場合だけ詳細の先頭（日付・時刻）を外した残りを使う。
   文が続くものは担当者名ではないとみなして出さない。 */
function ownerOf(task){
  if(task.owner) return String(task.owner).trim();
  var m = String(task.detail || "").trim()
    .match(/^(?:本日|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})(?:\s+\d{1,2}:\d{2})?\s+(.+)$/);
  if(!m) return "";
  var rest = m[1].split("。")[0].trim();
  if(rest === "自分") return "";  // 自分の枠では言うまでもないので出さない
  return rest && rest.length <= 24 && !/[、]/.test(rest) ? rest : "";
}
function overdueTier(days){
  days = Number(days) || 0;
  return days <= 0 ? 0 : days <= 2 ? 1 : days <= 4 ? 2 : days <= 6 ? 3 : days <= 8 ? 4 : 5;
}

function victoryIcon(index, label){
  return '<span class="victory-icon vi-' + index + '" role="img" aria-label="' + esc(label) + '"></span>';
}

function notionUrl(value){
  if(!value) return "";
  try{
    var u = new URL(String(value), location.href);
    var host = u.hostname.toLowerCase();
    return u.protocol === "https:" && (host === "app.notion.com" || host === "notion.so" || host.endsWith(".notion.so") || host === "notion.site" || host.endsWith(".notion.site")) ? u.href : "";
  }catch(e){ return ""; }
}

function taskRows(tasks, saved){
  if(!tasks.length) return '<div class="today-empty">該当する項目はありません。</div>';
  return '<div class="today-task-list">' + tasks.map(function(task){
    var id = String(task.id || "");
    var done = saved[id] === true;
    var url = task.type === "notion" ? notionUrl(task.url) : "";
    var tier = overdueTask(task) ? overdueTier(task.overdueDays) : 0;
    var owner = ownerOf(task);
    return '<div class="today-task' + (done ? ' done' : '') + (tier ? ' ov-' + tier : '') + '" data-task-id="' + esc(id) + '" tabindex="-1">'
      + '<input class="today-task-check" type="checkbox" data-task-id="' + esc(id) + '"' + (done ? ' checked' : '') + ' aria-label="完了">'
      + (tier ? '<div class="today-overdue-mark">' + briefIcon(monsterIndex(task.overdueDays), ["幼虫","蜂","鮫","鬼","骸骨"][monsterIndex(task.overdueDays) - 10])
        + '<span class="today-overdue-days">' + esc(task.overdueDays) + '<small>日超過</small></span>'
        + '<span class="today-overdue-lv">Lv.' + esc(monsterLevel(task.overdueDays)) + '</span></div>' : '')
      + '<div class="today-task-body"><div class="today-task-title">'
      + (owner ? '<span class="today-owner">' + esc(owner) + '</span>' : '') + briefText(task.title || "") + '</div>'
      + '<span class="today-task-complete">' + briefIcon(3, "完了") + '</span>'
      + (tier ? '' : monsterBadge(task))
      + (task.priority ? '<span class="today-priority">' + briefIcon(priorityIndex(task.priority), "優先度") + '優先度：' + ({high:"高",medium:"中",low:"低"}[task.priority] || "低") + '</span>' : '')
      + (task.detail ? '<div class="today-task-detail">' + briefText(task.detail) + '</div>' : '')
      + (task.due ? '<div class="today-task-detail">期限 ' + briefText(task.due) + '</div>' : '')
      + (url ? '<a class="task-notion-link" href="' + esc(url) + '" target="_blank" rel="noopener">Notionで開く ' + briefIcon(20, "開く") + '</a>' : '')
      + '</div></div>';
  }).join("") + '</div>';
}

/* 前回の期限切れが消えた分を戦果として最上部に出す。0件の日は最大Lvの相手を標的として名指しする。 */
function victorySection(resolved, self, members){
  var history = victoryHistoryHTML();
  if(resolved.length){
    return briefSection("victory", "昨日からの戦果", 19, resolved.map(function(item){
      return '<div class="victory-row">' + victoryIcon(item.section === "memberOverdue" ? 0 : 1, "撃破")
        + '<div class="victory-body"><div class="today-task-title">' + briefText(item.title || "") + '</div>'
        + (item.detail ? '<div class="today-task-detail">' + briefText(item.detail) + '</div>' : '') + '</div>'
        + '<span class="victory-lv">Lv.' + esc(Math.max(1, Number(item.overdueDays) || 1)) + ' 撃破</span></div>';
    }).join("") + history, "today-victory");
  }
  var target = members.concat(self).filter(function(task){ return Number(task.overdueDays) > 0; })
    .sort(function(a, b){ return b.overdueDays - a.overdueDays; })[0];
  if(!target) return history ? briefSection("victory", "撃破の記録", 19, history, "today-victory") : "";
  return briefSection("victory", "今日の標的", 21,
    '<div class="victory-row">' + victoryIcon(2, "標的")
    + '<div class="victory-body"><div class="today-task-title">' + briefText(target.title || "") + '</div>'
    + (target.detail ? '<div class="today-task-detail">' + briefText(target.detail) + '</div>' : '') + '</div>'
    + '<span class="victory-lv">Lv.' + esc(Math.max(1, Number(target.overdueDays) || 1)) + '</span></div>' + history, "today-victory");
}

function renderTodayTasks(){
  var box = document.getElementById("today-dashboard");
  if(!box) return;
  var daily = todayData();
  var saved = localTaskState();
  var byOverdue = function(a, b){ return (Number(b.overdueDays) || 0) - (Number(a.overdueDays) || 0); };
  var self = tasksIn("selfOverdue").sort(byOverdue);
  var members = tasksIn("memberOverdue").sort(byOverdue);
  var todo = tasksIn("todo").sort(function(a,b){ return priorityIndex(a.priority) - priorityIndex(b.priority); });
  var boss = self.concat(members).filter(function(task){ return Number.isInteger(task.overdueDays) && task.overdueDays >= 7; })
    .sort(function(a,b){ return b.overdueDays - a.overdueDays; })[0];
  var calendar = (Array.isArray(daily.calendar) ? daily.calendar : []).filter(function(event){ return event && event.type !== "contact"; });
  var schedule = '<h3>' + briefIcon(5, "予定") + '今日の予定</h3>'
    + (calendar.length ? calendar.map(function(event){ return '<div class="today-task-detail">' + briefText(event.time || "") + ' ' + briefText(event.title || "") + '</div>'; }).join("")
      : '<div class="today-empty">予定はありません。</div>');
  var hpSource = daily.hp;
  var hpValue = hpSource && typeof hpSource === "object"
    ? 100 - Number(hpSource.selfOverdue || 0) * 10 - Number(hpSource.memberOverdue || 0) * 5
    : typeof hpSource === "number" ? hpSource : 100 - self.length * 10 - members.length * 5;
  var hp = Number.isFinite(hpValue) ? Math.max(0, Math.min(100, hpValue)) : 100;
  var quote = daily.quote && typeof daily.quote === "object" ? daily.quote.text : daily.quote;
  var source = daily.quote && typeof daily.quote === "object" ? daily.quote.source : daily.quoteSource;
  var resolved = Array.isArray(daily.resolved) ? daily.resolved : [];
  var memberResolved = resolved.filter(function(item){ return item.section === "memberOverdue"; });
  var teamHp = Math.max(0, Math.min(100, 100 - members.length * 5));
  box.innerHTML = '<section class="today-hero"><div class="today-hero-title">' + briefIcon(0, "朝") + '今日のタスク</div></section>'
    + victorySection(resolved, self, members)
    + '<div class="today-next" id="todayNextAction">' + nextActionHTML(saved) + '</div>'
    + '<section class="today-card"><div class="today-card-title">' + briefIcon(24, "HP") + 'HP</div><div class="today-hp-value">' + esc(hp) + ' / 100</div>'
    + (daily.hpNote ? '<div class="today-hp-note">' + briefText(daily.hpNote) + '</div>' : '') + '</section>'
    + (boss ? '<aside class="today-card today-boss"><div class="today-card-title">' + briefIcon(21, "アラート") + '今日のボス</div>' + monsterBadge(boss) + '<div class="today-task-title">' + briefText(boss.title) + '</div></aside>' : '')
    + briefSection("quote", "今日の格言", 0, '<p class="today-quote">' + briefText(quote || "—") + '</p>' + (source ? '<div class="today-quote-source">' + briefText(source) + '</div>' : ''))
    + briefSection("selfOverdue", "自分の期限切れ", 2, taskRows(self, saved), "today-self")
    + briefSection("memberOverdue", "メンバーの期限切れ", 1,
      '<div class="today-teamhp">' + victoryIcon(3, "チームHP")
      + '<span class="today-teamhp-value">チームHP ' + esc(teamHp) + ' / 100</span>'
      + (memberResolved.length ? '<span class="today-teamhp-delta">+' + esc(memberResolved.length * 5) + '</span>' : '')
      + '</div>' + taskRows(members, saved), "today-member")
    + briefSection("todo", "今日のToDo", 23, taskRows(todo, saved) + schedule + meetPrepHTML())
    + briefSection("today", "今日中の期限タスク", 4, taskRows(tasksIn("today"), saved))
    + briefSection("upcoming", "3日先までの先回り準備", 6, taskRows(upcomingSoon(), saved))
    + briefSection("other", "その他ToDo", 7, taskRows(tasksIn("other"), saved))
    + briefSection("comment", "参謀コメント", 8, '<div class="today-comment">' + briefText(daily.comment || "コメントはまだありません。") + '</div>')
    + briefSection("sources", "情報ソース", 9, sourceRows(daily.sources));
  var st = document.getElementById("todaystatus");
  if(st) st.textContent = daily.date ? daily.date + " のタスク" : "今日のタスクはまだありません。";
}

function setLocalTaskDone(id, done){
  var daily = todayData();
  var task = daily.tasks.filter(function(item){ return String(item.id) === String(id); })[0];
  if(!isLocalTask(task) || !daily.date) return;
  var saved = localTaskState();
  if(done) saved[String(id)] = true; else delete saved[String(id)];
  writeTaskObject(todayStorageKey(), saved, TASK_MEMORY);
  var date=daily.date, pending=pendingTaskState(date);
  writeTaskObject("daily-task-schema:"+date,{version:2},TASK_PENDING_MEMORY);
  pending[String(id)]={done:!!done,version:Date.now()+":"+(++TASK_OPERATION)};
  savePendingTasks(date,pending);
  var row = Array.prototype.filter.call(document.querySelectorAll(".today-task"), function(item){
    return item.getAttribute("data-task-id") === String(id);
  })[0];
  if(row){row.classList.toggle("done", !!done);var box=row.querySelector(".today-task-check");if(box)box.checked=!!done;}
  updateNextAction(saved);
  pushTaskState(String(id), !!done);
}

/* 完了チェックを Apps Script 経由で端末間に共有する（taskState）。
   書き込み用の合言葉がある端末だけが同期し、無い端末・通信失敗時は今までどおり端末内だけで動く。
   送るのはタスクIDと完了フラグだけ。 */
function taskStateRequest(body){
  var token = getWriteToken();
  var date = body.date || todayData().date;
  if(!token || !date || typeof fetch !== "function") return Promise.resolve(null);
  body.action = "taskState"; body.token = token; body.date = date;
  return fetch(API_URL, { method:"POST", headers:{"Content-Type":"text/plain;charset=utf-8"}, body:JSON.stringify(body) })
    .then(function(res){ return res.json(); })
    .then(function(data){ return data && data.ok ? data : null; })
    .catch(function(){ return null; });
}
function pushTaskState(id, done, dateOverride){
  var date=dateOverride||todayData().date, queueKey=date+'|'+id;
  var operation=pendingTaskState(date)[id];
  // Serialize writes for one task, so a slow check cannot arrive after an uncheck.
  var next=(TASK_PUSH_QUEUE[queueKey]||Promise.resolve()).then(function(){
    return taskStateRequest({op:'set',id:id,done:done,date:date});
  }).then(function(result){
    if(result){
      // A GET started while this write was in flight may still contain the old state.
      TASK_OPERATION++;
      var pending=pendingTaskState(date);if(operation&&pending[id]&&pending[id].version===operation.version){delete pending[id];savePendingTasks(date,pending);}
    }
    return result;
  });
  TASK_PUSH_QUEUE[queueKey]=next.catch(function(){return null;});
  return next;
}

function syncTaskState(){
  var date=todayData().date, operationAtStart=TASK_OPERATION;
  return taskStateRequest({op:'get',date:date}).then(function(data){
    if(!data||data.date!==date||todayData().date!==date||TASK_OPERATION!==operationAtStart)return;
    var remote=data.done&&typeof data.done==='object'&&!Array.isArray(data.done)?data.done:{};
    var local=localTaskState(),pending=pendingTaskState(date),merged={};
    // Migrate legacy local-only checks as pending writes. Explicit unchecks take precedence.
    if(readTaskObject('daily-task-schema:'+date,TASK_PENDING_MEMORY).version!==2){
      Object.keys(local).forEach(function(id){if(local[id]===true&&remote[id]!==true&&!pending[id])pending[id]={done:true,version:Date.now()+':'+(++TASK_OPERATION)};});
      writeTaskObject('daily-task-schema:'+date,{version:2},TASK_PENDING_MEMORY);
    }
    savePendingTasks(date,pending);
    Object.keys(remote).forEach(function(id){if(remote[id]===true)merged[id]=true;});
    Object.keys(pending).forEach(function(id){var op=pending[id];if(!op||typeof op.done!=='boolean')return;if(op.done)merged[id]=true;else delete merged[id];});
    writeTaskObject('daily-task:'+date,merged,TASK_MEMORY);
    document.querySelectorAll('.today-task').forEach(function(row){var on=merged[row.getAttribute('data-task-id')]===true;row.classList.toggle('done',on);var box=row.querySelector('.today-task-check');if(box)box.checked=on;});
    updateNextAction(merged);
    return Promise.all(Object.keys(pending).filter(function(id){return pending[id]&&typeof pending[id].done==='boolean';}).map(function(id){return pushTaskState(id,pending[id].done,date);}));
  });
}

function wireTodayTasks(){
  var dash = document.getElementById("today-dashboard");
  if(dash && !dash.dataset.collapseWired){
    dash.dataset.collapseWired = "1";
    dash.addEventListener("click", function(event){
      var open = event.target.closest("[data-meet-open]");
      if(open){ openPersonFromBrief(open.getAttribute("data-meet-open")); return; }
      var h = event.target.closest(".today-card > h2");
      if(h && h.parentNode) h.parentNode.classList.toggle("collapsed");
    });
  }
  var next = document.getElementById("todayNextAction");
  if(next && !next.dataset.todayWired){
    next.dataset.todayWired = "1";
    next.addEventListener("click", function(event){
      var button = event.target.closest("[data-next-task]");
      if(!button) return;
      var id = button.getAttribute("data-next-task");
      var row = Array.prototype.find.call(document.querySelectorAll(".today-task"), function(item){
        return item.getAttribute("data-task-id") === id;
      });
      if(row){ if(row.scrollIntoView) row.scrollIntoView({ behavior:"smooth", block:"center" }); row.focus(); }
    });
  }
  document.querySelectorAll(".today-task-check").forEach(function(input){
    if(input.dataset.todayWired) return;
    input.dataset.todayWired = "1";
    input.addEventListener("change", function(){
      var id = this.getAttribute("data-task-id");
      setLocalTaskDone(id, this.checked);
    });
  });
}

function loadToday(){ renderTodayTasks(); wireTodayTasks(); syncTaskState(); }
