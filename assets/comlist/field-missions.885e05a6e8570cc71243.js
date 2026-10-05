
'use strict';
var FIELD_MISSION_CELEBRATED={};
var FIELD_MISSION_REDUCE_MOTION=null;
var FIELD_MISSION_EFFECT_PENDING=false;
function fieldReducedMotion(){return FIELD_MISSION_REDUCE_MOTION===null?!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches):FIELD_MISSION_REDUCE_MOTION;}
function fieldMissionBoardHTML(m,s){
  var data=fieldGoalsData(),today=fieldGoalsToday(),missions=data.missions||[],weekStart=FieldGoalsModel.weekStart(today),mission=missions.find(function(w){return w.id===weekStart+'@'+m;}),progress=mission?FieldGoalsModel.missionSummary(data,mission,today):null;
  var blocked=fieldGoalsEditingBlocked(),known=FIELD_GOALS_VERSION!==null&&!FIELD_GOALS_PENDING;
  var html='<section id="field-mission-board" data-month="'+esc(m)+'" class="field-mission-board'+(fieldReducedMotion()?' reduced-motion':'')+'" aria-labelledby="field-mission-title"><h3 id="field-mission-title">今月のミッションボード</h3><p>メインミッション：見込み '+fieldNumber(s.target,'未設定')+'人。紹介につながった確認記録でマスが埋まります。</p>';
  if(s.target!==null){html+='<ol class="field-outcome-cells" aria-label="見込みの達成マス">';for(var i=0;i<Math.min(s.target,12);i++){var done=fieldGoalsKnown()&&i<s.prospects,planned=fieldGoalsKnown()&&!done&&i<s.conditionalProspects;html+='<li class="'+(done?'is-done':planned?'is-planned':'is-open')+'">'+(i+1)+'人目<br><span>'+(done?'確認済み':planned?'予定・未達成':fieldGoalsKnown()?'未確認':'記録未取得')+'</span></li>';}html+='</ol>'+(s.target>12?'<p>残りのマスも含め、目標は'+s.target+'人です。</p>':'');}else html+='<p>人数目標は未設定です。</p>';
  html+='<p class="field-mission-legend"><span class="field-legend-done"></span>濃い色＝実施確認 <span class="field-legend-plan"></span>薄い色＝確定予定（実績外）</p><div class="field-mission-gauges">';
  FieldGoalsModel.keys.forEach(function(k){var v=s.metrics[k],unit=fieldUnit(k),actual=v.actual===null?0:v.actual,max=v.goal||1,done=Math.min(100,actual/max*100),planned=v.actual===null?0:Math.min(100,(actual+v.secured)/max*100),label=v.actual===null?'実績未報告':v.goal===null?'目標未設定':'実績'+v.actual+unit+'、目標'+v.goal+unit+'、確定予定'+v.confirmed+unit;html+='<article><h4>'+FIELD_KIND_LABELS[k]+'</h4><div class="field-mission-gauge" role="progressbar" aria-label="'+FIELD_KIND_LABELS[k]+'の進捗" aria-valuemin="0" aria-valuemax="'+max+'"'+(v.actual===null?'':' aria-valuenow="'+Math.min(actual,max)+'"')+' aria-valuetext="'+esc(label)+'"><span class="field-gauge-planned" style="width:'+planned+'%" aria-hidden="true"></span><span class="field-gauge-done" style="width:'+done+'%" aria-hidden="true"></span></div><p>'+esc(label)+'</p></article>';});
  html+='</div><h4>今週のミッション</h4><p>'+weekStart+'〜'+FieldGoalsModel.weekEnd(weekStart)+'。必要ペースを本人が確認して決めます。開始前の実績や日報累計の変化だけでは週スタンプを作りません。</p>';
  if(mission){html+='<p>開始日 '+mission.startDate+'。開始時の必要数を固定し、日付のある実施確認記録だけを数えます。</p><ul class="field-week-missions">';['prospects'].concat(FieldGoalsModel.keys).forEach(function(k){var target=mission.targets[k],n=progress.actual[k],unit=k==='prospects'?'人':fieldUnit(k);html+='<li>'+ (k==='prospects'?'見込み':FIELD_KIND_LABELS[k])+'：'+(target===null?'未報告・目標未設定':target===0?'追加ミッションなし':n+' / '+target+unit+(n>=target?'・達成':'・残り'+(target-n)+unit))+'</li>';});html+='</ul>'+(progress.achieved?'<p class="field-week-stamp" aria-label="設定した今週ミッション達成">今週ミッション達成 ✓</p>':'<p>未達成の記録も残ります。休んでも罰や記録消失はありません。</p>');}
  else{html+='<ul class="field-week-missions">';var prospectPace=!fieldGoalsKnown()||s.remaining===null?null:s.remainingDays?Math.ceil(s.remaining*s.weekDays/s.remainingDays):null;html+='<li>見込み：'+fieldNumber(prospectPace,'未計算')+'人</li>';FieldGoalsModel.keys.forEach(function(k){html+='<li>'+FIELD_KIND_LABELS[k]+'：'+fieldNumber(s.metrics[k].weekly,'未計算')+fieldUnit(k)+'</li>';});html+='</ul><button class="btn" id="field-mission-start"'+(blocked||!fieldGoalsKnown()||m!==today.slice(0,7)?' disabled':'')+'>この必要数で今週ミッションを決める</button>';}
  html+='<p>未報告・未設定の項目は週ミッションの対象外です。スタンプは、必要数を決めた項目の達成だけを表します。</p>';
  var achieved=s.target!==null&&s.prospects>=s.target;
  html+=(achieved?'<p id="field-month-celebration" class="field-month-celebration">今月の見込み目標を達成しました。おめでとうございます！'+(known?'':'（端末の未同期記録を含みます）')+'</p>':'')+'<p id="field-mission-announcement" aria-live="polite"></p></section>';
  var stamps=missions.filter(function(w){return w.month===m&&w.id!==weekStart+'@'+m;}).sort(function(a,b){return b.weekStart.localeCompare(a.weekStart);});if(stamps.length)html+='<details class="field-past-missions"><summary>これまでの週ミッション</summary>'+stamps.map(function(w){var p=FieldGoalsModel.missionSummary(data,w,today);return '<p>'+esc(w.weekStart)+'：'+(p.achieved?'達成スタンプ ✓':'記録を保持・未達成／訂正後の確認中')+'</p>';}).join('')+'</details>';
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
