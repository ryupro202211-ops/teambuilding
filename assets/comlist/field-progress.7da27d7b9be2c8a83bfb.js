
var FIELD_METRICS = [
  ["orientation", "オリエン"], ["introductions", "紹介"], ["individual", "個別"],
  ["first_individual", "初個別"], ["new_friends", "新友達"]
];
var fieldMonthSelection = "";
var fieldMetricSelection = "individual";

function fieldDateLabel(date) {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? (+date.slice(5,7)) + "月" + (+date.slice(8,10)) + "日" : "—";
}

function renderFieldProgress() {
  var box = document.getElementById("fieldwrap");
  if (!box) return;
  var months = window.FIELD_PROGRESS && Array.isArray(window.FIELD_PROGRESS.months)
    ? window.FIELD_PROGRESS.months.slice().filter(function(m){ return /^20\d{2}-(0[1-9]|1[0-2])$/.test(m.month); }).sort(function(a,b){ return a.month.localeCompare(b.month); }) : [];
  var currentMonth = new Date().toLocaleDateString("sv-SE", {timeZone:"Asia/Tokyo"}).slice(0,7);
  if(typeof fieldGoalsData==='function'){
    var plan=fieldGoalsData(),extra=[currentMonth].concat(/^20\d{2}-(0[1-9]|1[0-2])$/.test(fieldMonthSelection)?[fieldMonthSelection]:[]).concat(Object.keys(plan.goals),plan.records.map(function(r){return r.date.slice(0,7);}));
    extra.forEach(function(m){if(!months.some(function(x){return x.month===m;}))months.push({month:m,values:{},goals:{},partial:true});});
    months.sort(function(a,b){return a.month.localeCompare(b.month);});
  }
  if (!months.length) {
    box.innerHTML = '<h2>現場数</h2><p>Notionの月別データはまだありません。</p>';
    return;
  }
  if (!fieldMonthSelection || !months.some(function(m){return m.month === fieldMonthSelection;})) {
    fieldMonthSelection = months.some(function(m){return m.month === currentMonth;}) ? currentMonth : months[months.length-1].month;
  }
  var selected = months.find(function(m){return m.month === fieldMonthSelection;});
  var latest = months[months.length-1];
  var title = selected.month === currentMonth ? "今月の進捗" : selected.month.slice(0,4) + "年" + (+selected.month.slice(5)) + "月の記録";
  var options = months.slice().reverse().map(function(m){
    return '<option value="' + esc(m.month) + '"' + (m.month === selected.month ? ' selected' : '') + '>'
      + esc(m.month.slice(0,4) + '年' + (+m.month.slice(5)) + '月') + '</option>';
  }).join("");
  var cards = FIELD_METRICS.map(function(pair){
    var value = selected.values && selected.values[pair[0]], goal = selected.goals && selected.goals[pair[0]];
    var validValue = Number.isInteger(value) && value >= 0, validGoal = Number.isInteger(goal) && goal > 0;
    var percent = validValue && validGoal ? Math.round(value / goal * 100) : null;
    return '<div class="field-card"><div class="field-card-top"><strong>' + pair[1] + '</strong><span>'
      + (validValue ? value : '未報告') + ' / ' + (validGoal ? goal : '未設定') + (typeof fieldUnit==='function'?fieldUnit(pair[0]):'件') + '</span></div>'
      + '<progress max="100" value="' + (percent === null ? 0 : Math.min(percent,100)) + '" aria-label="' + pair[1] + 'の目標達成率"></progress>'
      + '<small>' + (percent === null ? '達成率は計算できません' : percent + '%達成') + '</small></div>';
  }).join("");
  if (!FIELD_METRICS.some(function(p){return p[0] === fieldMetricSelection;})) fieldMetricSelection = "individual";
  var metricName = FIELD_METRICS.find(function(p){return p[0] === fieldMetricSelection;})[1];
  var metricUnit=typeof fieldUnit==='function'?fieldUnit(fieldMetricSelection):'件';
  var scale = Math.max(1, ...months.map(function(m){ return Math.max(m.values?.[fieldMetricSelection] || 0, m.goals?.[fieldMetricSelection] || 0); }));
  var chart = months.slice().reverse().map(function(m){
    var value = m.values && m.values[fieldMetricSelection], goal = m.goals && m.goals[fieldMetricSelection];
    var actual = Number.isInteger(value) && value >= 0 ? value : null;
    var target = Number.isInteger(goal) && goal > 0 ? goal : null;
    return '<div class="field-chart-row" role="listitem" aria-label="' + esc(m.month) + ' ' + metricName + ' 実績' + (actual === null ? '未記録' : actual + metricUnit) + ' 目標' + (target === null ? '未設定' : target + metricUnit) + '">'
      + '<span class="field-chart-month">' + esc(m.month.slice(0,4) + '/' + m.month.slice(5)) + (m.partial ? '※' : '') + '</span>'
      + '<div class="field-chart-bars"><span class="field-bar-actual" style="width:' + (actual === null ? 0 : actual / scale * 100) + '%"></span><span class="field-bar-goal" style="width:' + (target === null ? 0 : target / scale * 100) + '%"></span></div>'
      + '<span class="field-chart-count">' + (actual === null ? '—' : actual) + ' / ' + (target === null ? '—' : target) + '</span></div>';
  }).join("");
  var sourceUrl = /^https:\/\/app\.notion\.com\/[a-zA-Z0-9/?=&-]+$/.test(selected.url || "") ? selected.url : "";
  box.innerHTML = '<div class="field-head"><div><h2>現場数</h2><p>Notionの日別報告から、活動月ごとの最新の累計を表示しています。日ごとの数字は合算していません。</p></div>'
    + '<label>表示する月 <select id="field-month">' + options + '</select></label></div>'
    + (typeof fieldCalendarHTML==='function'?fieldCalendarHTML(selected.month):'')
    + (typeof fieldGoalsHTML==='function'?fieldGoalsHTML(selected.month):'')
    + '<section class="field-section"><h3>' + title + '</h3>'
    + '<p class="field-asof">活動日 ' + fieldDateLabel(selected.activityDate) + '時点（報告日 ' + fieldDateLabel(selected.reportDate) + '）'
    + (selected.partial ? '・月途中の記録' : '') + '</p>'
    + (typeof fieldGoalsHTML==='function'?'':'<div class="field-cards">' + cards + '</div>')
    + (sourceUrl ? '<p class="field-source"><a href="' + esc(sourceUrl) + '" target="_blank" rel="noopener noreferrer">この月の元データをNotionで開く ↗</a></p>' : '') + '</section>'
    + '<section class="field-section"><div class="field-chart-head"><h3>月ごとの推移</h3><label>項目 <select id="field-metric">'
    + FIELD_METRICS.map(function(pair){return '<option value="' + pair[0] + '"' + (pair[0] === fieldMetricSelection ? ' selected' : '') + '>' + pair[1] + '</option>';}).join('')
    + '</select></label></div><p class="field-legend"><span class="field-legend-actual"></span>実績 <span class="field-legend-goal"></span>目標</p>'
    + '<div class="field-chart" role="list" aria-label="' + metricName + 'の月別実績と目標">' + chart + '</div><p class="field-note">※ 月末の報告がない月は、最後に確認できた月途中の累計です。</p></section>'
    + (latest.month < currentMonth ? '<p class="field-note">今月の記録はまだありません。最新の活動月は' + esc(latest.month) + 'です。</p>' : '');
  document.getElementById("field-month").addEventListener("change", function(){fieldMonthSelection=this.value;renderFieldProgress();});
  document.getElementById("field-metric").addEventListener("change", function(){fieldMetricSelection=this.value;renderFieldProgress();});
  if(typeof wireFieldGoals==='function')wireFieldGoals(selected.month);
  if(typeof wireFieldCalendar==='function')wireFieldCalendar();
}
