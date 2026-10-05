
'use strict';
var FIELD_MISSION_CELEBRATED={};
var FIELD_MISSION_REDUCE_MOTION=null;
var FIELD_MISSION_EFFECT_PENDING=false;
function fieldReducedMotion(){return FIELD_MISSION_REDUCE_MOTION===null?!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches):FIELD_MISSION_REDUCE_MOTION;}

var FIELD_PROGRESS_NOTICE=null;
function fieldQuestIcon(index){
  var marks=['M8 6h8v2H8zM6 10h12v2H6zM8 14h8v2H8z','M6 8h6v6H6zM12 10h6v6h-6z','M7 7h10v8H9v2H7z','M7 6h10v2H7zM6 10h12v2H6zM10 14h4v4h-4z','M9 5h6v4h4v6h-4v4H9v-4H5V9h4z'];
  return '<svg class="field-quest-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><path fill="#5b4937" d="M4 2h16v2h2v16h-2v2H4v-2H2V4h2z"/><path fill="#e5d2a6" d="M4 4h16v16H4z"/><path fill="#315c49" d="M6 5h12v14H6z"/><path fill="#f8edce" d="'+marks[index%marks.length]+'"/></svg>';
}
function fieldConfirmedProgress(before,after){
  var today=fieldGoalsToday(),m=today.slice(0,7),report=fieldGoalsReport(m),old=FieldGoalsModel.summarize(before,report,m,today),next=FieldGoalsModel.summarize(after,report,m,today);
  var kinds=FieldGoalsModel.keys.filter(function(k){return old.metrics[k].actual!==null&&next.metrics[k].actual>old.metrics[k].actual;});
  if(next.prospects>old.prospects)kinds.push('prospects');
  FIELD_PROGRESS_NOTICE=kinds.length?{month:m,kinds:kinds}:null;
  var notice=FIELD_PROGRESS_NOTICE;if(!notice)return;
  window.setTimeout(function(){if(FIELD_PROGRESS_NOTICE!==notice)return;FIELD_PROGRESS_NOTICE=null;document.querySelectorAll('#fieldwrap .is-gained').forEach(function(e){e.classList.remove('is-gained');});var live=document.getElementById('field-progress-notice');if(live)live.textContent='';},1200);
}
function fieldMissionBoardHTML(m,s){
  var data=fieldGoalsData(),today=fieldGoalsToday(),missions=data.missions||[],weekStart=FieldGoalsModel.weekStart(today),mission=missions.find(function(w){return w.id===weekStart+'@'+m;}),progress=mission?FieldGoalsModel.missionSummary(data,mission,today):null;
  var blocked=fieldGoalsEditingBlocked(),known=FIELD_GOALS_VERSION!==null&&!FIELD_GOALS_PENDING,notice=FIELD_PROGRESS_NOTICE&&FIELD_PROGRESS_NOTICE.month===m?FIELD_PROGRESS_NOTICE:null;
  var achievedItems=progress?progress.required.filter(function(k){return progress.actual[k]>=mission.targets[k];}).length:0;
  var html='<section id="field-mission-board" data-month="'+esc(m)+'" class="field-mission-board'+(fieldReducedMotion()?' reduced-motion':'')+'" aria-labelledby="field-mission-title">';
  html+='<div class="field-quest-head'+(notice&&notice.kinds.includes('prospects')?' is-gained':'')+'"><div class="field-quest-emblem" aria-hidden="true">'+fieldQuestIcon(4)+'</div><div><p class="field-quest-eyebrow">FIELD QUEST / '+esc(m)+'</p><h3 id="field-mission-title">今週のクエスト</h3><p>今日の一歩を記録して、次の行動へ。</p></div><span class="field-quest-week">'+esc(weekStart.slice(5).replace('-','/'))+' — '+esc(FieldGoalsModel.weekEnd(weekStart).slice(5).replace('-','/'))+'</span></div>';
  html+='<div class="field-week-quest"><div class="field-quest-stage"><h4>'+(mission?'今週の達成状況':'今週のクエストを決めよう')+'</h4><span class="field-quest-stage-count">'+(progress?achievedItems+' / '+progress.required.length+' 項目達成':'自分のペースで開始')+'</span></div>';
  if(mission){
    html+='<div class="field-quest-track" role="progressbar" aria-label="今週の達成項目" aria-valuemin="0" aria-valuemax="'+Math.max(1,progress.required.length)+'" aria-valuenow="'+achievedItems+'"><span style="width:'+(progress.required.length?achievedItems/progress.required.length*100:0)+'%"></span></div><ul class="field-week-missions">';
    ['prospects'].concat(FieldGoalsModel.keys).forEach(function(k){var target=mission.targets[k],n=progress.actual[k],unit=k==='prospects'?'人':fieldUnit(k),done=target>0&&n>=target;
      html+='<li class="'+(done?'quest-cleared':target>0?'quest-active':'quest-unset')+'"><span class="field-quest-check" aria-hidden="true">'+(done?'✓':'·')+'</span><div><strong>'+(k==='prospects'?'見込み':FIELD_KIND_LABELS[k])+'</strong><span>'+(target===null?'未報告・目標未設定':target===0?'追加ミッションなし':n+' / '+target+unit)+'</span></div><small>'+(done?'達成':target>0?'残り '+Math.max(0,target-n)+unit:'対象外')+'</small></li>';});
    html+='</ul>'+(progress.achieved?'<p class="field-week-stamp" aria-label="設定した今週ミッション達成">今週ミッション達成 ★</p>':'<p class="field-quest-reassure">未達成でも記録は残ります。休んでも過去の記録は失われません。</p>')+'<details class="field-quest-rules"><summary>このクエストの集計条件</summary><p>開始日 '+mission.startDate+'。開始時の必要数を固定し、日付のある実施確認記録だけを数えます。開始前の実績や累計の変化だけでは週スタンプは出ません。未報告・未設定の項目は対象外です。</p></details>';
  }else{
    var prospectPace=!fieldGoalsKnown()||s.remaining===null?null:s.remainingDays?Math.ceil(s.remaining*s.weekDays/s.remainingDays):null;
    html+='<ul class="field-week-missions field-quest-preview"><li><strong>見込み</strong><span>'+fieldNumber(prospectPace,'未計算')+'人</span></li>'+FieldGoalsModel.keys.map(function(k){return '<li><strong>'+FIELD_KIND_LABELS[k]+'</strong><span>'+fieldNumber(s.metrics[k].weekly,'未計算')+fieldUnit(k)+'</span></li>';}).join('')+'</ul><button class="btn field-quest-start" id="field-mission-start"'+(blocked||!fieldGoalsKnown()||m!==today.slice(0,7)?' disabled':'')+'>この必要数で今週ミッションを始める</button><p class="field-quest-reassure">必要ペースを本人が確認して決めます。未報告・未設定の項目は週ミッションの対象外です。</p>';
  }
  html+='</div>';
  var actions=s.actions.slice().sort(function(a,b){return a.dueDate.localeCompare(b.dueDate)||a.id.localeCompare(b.id);}),next=m===today.slice(0,7)&&fieldGoalsKnown()?actions[0]:null;
  html+='<div class="field-quest-next"><span class="field-quest-next-label">NEXT / 次の1件</span>'+(next?'<div><strong>'+FIELD_KIND_LABELS[next.kind]+'</strong><p>'+esc(next.purpose)+'</p><small>行動期限 '+esc(next.dueDate)+' ・ '+FIELD_STATUS_LABELS[next.status]+'</small></div><button class="btn" data-field-edit="'+esc(next.id)+'"'+(blocked?' disabled':'')+'>この行動を確認</button>':'<div><strong>今日は何を進める？</strong><p>下の5つから記録する活動を選べます。予定のままでは達成になりません。</p></div><a href="#field-quest-metrics">記録を選ぶ ↓</a>')+'</div>';
  html+='<div class="field-quest-metrics-head" id="field-quest-metrics"><h4>今月の5つの活動</h4><span>実績は濃色 / 予定は薄色</span></div><div class="field-mission-gauges">';
  FieldGoalsModel.keys.forEach(function(k,index){
    var v=s.metrics[k],unit=fieldUnit(k),actual=v.actual===null?0:v.actual,max=v.goal||1,done=Math.min(100,actual/max*100),planned=v.actual===null?0:Math.min(100,(actual+v.secured)/max*100),label=v.actual===null?'実績未報告':v.goal===null?'目標未設定':'実績'+v.actual+unit+'、目標'+v.goal+unit+'、確定予定'+v.confirmed+unit;
    html+='<article class="field-quest-metric'+(notice&&notice.kinds.includes(k)?' is-gained':'')+'" data-field-quest-kind="'+k+'"><div class="field-quest-metric-head">'+fieldQuestIcon(index)+'<h4>'+FIELD_KIND_LABELS[k]+'</h4><span>'+unit+'</span></div><div class="field-quest-stat"><strong>'+fieldNumber(v.actual,'未報告')+'</strong><span> / '+fieldNumber(v.goal,'未設定')+unit+'<small>実績 / 目標</small></span></div><div class="field-mission-gauge" role="progressbar" aria-label="'+FIELD_KIND_LABELS[k]+'の進捗" aria-valuemin="0" aria-valuemax="'+max+'"'+(v.actual===null?'':' aria-valuenow="'+Math.min(actual,max)+'"')+' aria-valuetext="'+esc(label)+'"><span class="field-gauge-planned" style="width:'+planned+'%" aria-hidden="true"></span><span class="field-gauge-done" style="width:'+done+'%" aria-hidden="true"></span></div><div class="field-quest-metric-counts"><span>残り <b>'+fieldNumber(v.gap,'未計算')+unit+'</b></span><span>確定予定 <b>'+v.confirmed+unit+'</b></span></div><p class="field-quest-metric-label">'+esc(label)+'</p><button class="btn field-record-today" data-field-record-today="'+k+'"'+(blocked||m!==today.slice(0,7)?' disabled':'')+'>今日の記録 ＋</button></article>';
  });
  html+='</div><p id="field-progress-notice" role="status" aria-live="polite">'+(notice?'確認済みの実績を更新しました。次の一歩へ。':'')+'</p>';
  html+='<div class="field-quest-main"><h4>メインミッション：見込み '+fieldNumber(s.target,'未設定')+'人</h4><p>紹介につながった確認記録でマスが埋まります。同じ人は月内1人、予定は達成に含めません。</p>';
  if(s.target!==null){html+='<ol class="field-outcome-cells" aria-label="見込みの達成マス">';for(var i=0;i<Math.min(s.target,12);i++){var cellDone=fieldGoalsKnown()&&i<s.prospects,cellPlanned=fieldGoalsKnown()&&!cellDone&&i<s.conditionalProspects;html+='<li class="'+(cellDone?'is-done':cellPlanned?'is-planned':'is-open')+'">'+(i+1)+'人目<br><span>'+(cellDone?'確認済み':cellPlanned?'予定・未達成':fieldGoalsKnown()?'未確認':'記録未取得')+'</span></li>';}html+='</ol>'+(s.target>12?'<p>残りのマスを含め、目標は'+s.target+'人です。</p>':'');}
  else html+='<p>人数目標は未設定です。</p>';
  html+='<p class="field-mission-legend"><span class="field-legend-done"></span>濃色：実施確認 <span class="field-legend-plan"></span>薄色：確定予定（成果外）</p></div>';
  var achieved=s.target!==null&&s.prospects>=s.target;
  html+=(achieved?'<p id="field-month-celebration" class="field-month-celebration">今月の見込み目標を達成しました。おめでとうございます！'+(known?'':'（端末の未送信記録を含みます）')+'</p>':'')+'<p id="field-mission-announcement" aria-live="polite"></p></section>';
  var stamps=missions.filter(function(w){return w.month===m&&w.id!==weekStart+'@'+m;}).sort(function(a,b){return b.weekStart.localeCompare(a.weekStart);});
  if(stamps.length)html+='<details class="field-past-missions"><summary>これまでの週ミッション</summary>'+stamps.map(function(w){var summary=FieldGoalsModel.missionSummary(data,w,today);return '<p>'+esc(w.weekStart)+'：'+(summary.achieved?'達成スタンプ ★':'記録を保持・未達成／実施日の確認中')+'</p>';}).join('')+'</details>';
  return html;
}
function wireFieldMissions(m){
  var start=document.getElementById('field-mission-start');if(start)start.onclick=async function(){if(fieldGoalsEditingBlocked()||!window.confirm('表示された必要数で今週のミッションを決めます。開始前の実績は週の達成数に加えません。続けますか？'))return;try{await saveFieldGoals(FieldGoalsModel.createMission(fieldGoalsData(),fieldGoalsReport(m),m,fieldGoalsToday()));}catch(e){FIELD_GOALS_PHASE=e.message;renderFieldProgress();}};
  maybeCelebrateFieldMission(m);
}
async function maybeCelebrateFieldMission(m){
  if(FIELD_MISSION_EFFECT_PENDING||FIELD_GOALS_PENDING||FIELD_GOALS_VERSION===null||FIELD_GOALS_PHASE!=='同期済み')return;
  var data=fieldGoalsData(),today=fieldGoalsToday(),s=FieldGoalsModel.summarize(data,fieldGoalsReport(m),m,today),keys=[];
  if(s.target!==null&&s.prospects>=s.target)keys.push('month:'+m);
  var w=(data.missions||[]).find(function(x){return x.id===FieldGoalsModel.weekStart(today)+'@'+m;});if(w&&FieldGoalsModel.missionSummary(data,w,today).achieved)keys.push('week:'+w.id);
  keys=keys.filter(function(k){return !FIELD_MISSION_CELEBRATED[k];});if(!keys.length)return;
  FIELD_MISSION_EFFECT_PENDING=true;keys.forEach(function(k){FIELD_MISSION_CELEBRATED[k]=true;});
  try{if(!await persistSavedState())return;var board=document.getElementById('field-mission-board');if(!board||board.dataset.month!==m||FIELD_GOALS_PENDING)return;var announcement=document.getElementById('field-mission-announcement');if(announcement)announcement.textContent=keys.map(function(k){return k.startsWith('month:')?'今月の見込み目標達成。おめでとうございます。':'今週の設定したミッションを達成しました。';}).join(' ');if(!fieldReducedMotion()){board.classList.add('field-celebrate-once');board.addEventListener('animationend',function(){board.classList.remove('field-celebrate-once');},{once:true});}}
  finally{FIELD_MISSION_EFFECT_PENDING=false;}
}
