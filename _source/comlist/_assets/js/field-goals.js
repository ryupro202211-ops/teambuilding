'use strict';
var FIELD_GOALS_STATE={goals:{},persons:[],records:[]};
var FIELD_GOALS_VERSION=null;
var FIELD_GOALS_PENDING=null;
var FIELD_GOALS_BUSY=false;
var FIELD_GOALS_READ_BUSY=false;
var FIELD_GOALS_REVISION=0;
var FIELD_GOALS_PHASE='未取得';
var FIELD_GOALS_EDITING=false;
var FIELD_KIND_LABELS={orientation:'オリエン',introductions:'紹介',individual:'個別',first_individual:'初個別',new_friends:'新友達'};
var FIELD_STATUS_LABELS={proposed:'打診中',confirmed:'確定',completed:'実施',postponed:'延期',cancelled:'取消'};
function fieldGoalsData(){return FIELD_GOALS_PENDING?FIELD_GOALS_PENDING.state:FIELD_GOALS_STATE;}
function fieldGoalsEditingBlocked(){return FIELD_GOALS_BUSY||!!(FIELD_GOALS_PENDING&&FIELD_GOALS_PENDING.sent!==false);}
function fieldGoalsKnown(){return FIELD_GOALS_VERSION!==null||!!FIELD_GOALS_PENDING;}
function fieldGoalsToday(){return new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});}
function fieldUnit(k){return FieldGoalsModel.personMetrics.includes(k)?'人':'件';}
function fieldNumber(n,unknown){return n===null?unknown:String(n);}
function fieldPerson(p){var rows=DATA.filter(function(x){return x['名前(あだ名)']===p.name;});return rows.length===1?rows[0]:null;}
function fieldGoalsReport(m){return window.FIELD_PROGRESS&&Array.isArray(window.FIELD_PROGRESS.months)?window.FIELD_PROGRESS.months.find(function(r){return r.month===m;})||null:null;}
function fieldGoalsHTML(m){
  var data=fieldGoalsData(),today=fieldGoalsToday(),report=fieldGoalsReport(m),s=FieldGoalsModel.summarize(data,report,m,today);
  var people=Object.fromEntries(data.persons.map(function(p){return [p.id,p];}));
  var blocked=fieldGoalsEditingBlocked();
  var board=typeof fieldMissionBoardHTML==='function'?fieldMissionBoardHTML(m,s):'';
  var html='<section class="field-section field-outcome"><h3>成果目標：見込み（紹介につながった人）</h3><p><strong>'+(fieldGoalsKnown()?s.prospects+'人確認済み':'確認記録は未取得')+'</strong> ／ 目標 '+fieldNumber(s.target,'未設定')+'人・残り '+(fieldGoalsKnown()?fieldNumber(s.remaining,'未設定')+'人':'未計算')+'</p><p>同じ人物は月内1人。紹介の発生件数とは別に、実施後の確認記録だけを数えます。未記録の成果は含みません。同期状態：'+esc(FIELD_GOALS_PHASE)+'。</p><button class="btn" id="field-goal-edit"'+(blocked?' disabled':'')+'>月の目標を設定</button></section>';
  html+='<p id="field-goals-status" role="status">'+esc(FIELD_GOALS_PHASE)+'</p><div class="field-sync-controls"><button class="btn" id="field-goals-refresh"'+(FIELD_GOALS_BUSY?' disabled':'')+'>最新を確認</button><button class="btn" id="field-goals-retry"'+(FIELD_GOALS_BUSY||!FIELD_GOALS_PENDING?' disabled':'')+'>再試行</button><button class="btn" id="field-goals-discard"'+(FIELD_GOALS_BUSY||!FIELD_GOALS_PENDING?' disabled':'')+'>未同期の変更を取り消す</button></div>';
  return board+html;
}
function wireFieldGoals(m){
  var box=document.getElementById('fieldwrap');
  document.getElementById('field-goal-edit').onclick=function(){openFieldGoalEditor(m);};
  box.querySelectorAll('[data-field-edit]').forEach(function(b){b.onclick=function(){openFieldRecordEditor(m,b.dataset.fieldEdit);};});
  box.querySelectorAll('[data-field-plan-kind]').forEach(function(b){b.onclick=function(){openFieldRecordEditor(m,null,b.dataset.fieldPlanKind);};});
  box.querySelectorAll('[data-field-candidate]').forEach(function(b){b.onclick=function(){openFieldRecordEditor(m,null,b.dataset.kind,Number(b.dataset.fieldCandidate));};});
  box.querySelectorAll('[data-field-person]').forEach(function(b){b.onclick=function(){var p=fieldGoalsData().persons.find(function(x){return x.id===b.dataset.fieldPerson;}),contact=p&&fieldPerson(p);if(!contact){FIELD_GOALS_PHASE='人脈の人物を一意に特定できません。最新データと名前を確認してください。';renderFieldProgress();return;}openPersonFromBrief(plantKey(contact));};});
  document.getElementById('field-goals-refresh').onclick=refreshFieldGoals;
  document.getElementById('field-goals-retry').onclick=function(){if(!getWriteToken()&&!askWriteToken())return;retryFieldGoals();};
  document.getElementById('field-goals-discard').onclick=async function(){if(FIELD_GOALS_BUSY||!window.confirm('未同期の変更を取り消します。通信先で保存済みの場合、その記録は削除しません。続けますか？'))return;FIELD_GOALS_PENDING=null;FIELD_GOALS_REVISION++;await persistSavedState();await refreshFieldGoals();renderFieldProgress();};
  if(typeof wireFieldMissions==='function')wireFieldMissions(m);
}
function fieldDialog(title,content,save){
  var old=document.getElementById('field-goal-dialog');if(old)old.remove();
  var dialog=document.createElement('dialog');dialog.id='field-goal-dialog';dialog.setAttribute('aria-label',title);dialog.innerHTML='<form><h3>'+esc(title)+'</h3>'+content+'<p class="field-form-error" role="alert"></p><div>'+(save?'<button type="submit" class="btn">保存</button>':'')+'<button type="button" class="btn" data-cancel>'+(save?'キャンセル':'閉じる')+'</button></div></form>';document.body.appendChild(dialog);FIELD_GOALS_EDITING=true;
  function close(){FIELD_GOALS_EDITING=false;dialog.close();dialog.remove();}
  dialog.querySelector('[data-cancel]').onclick=close;dialog.addEventListener('cancel',function(e){e.preventDefault();close();});
  dialog.querySelector('form').onsubmit=async function(e){e.preventDefault();if(!save)return;try{var next=save(new FormData(this));FieldGoalsModel.validate(next);close();await saveFieldGoals(next);}catch(err){var error=dialog.querySelector('.field-form-error');if(error)error.textContent=err.message;}};
  dialog.showModal();
  return dialog;
}
function openFieldGoalEditor(m){
  if(fieldGoalsEditingBlocked())return;var s=FieldGoalsModel.summarize(fieldGoalsData(),fieldGoalsReport(m),m,fieldGoalsToday());
  var html='<p>'+esc(m)+'の目標。空欄は未設定です。</p><label>見込み（人）<input name="prospects" type="number" min="1" max="10000" value="'+(s.target===null?'':s.target)+'"></label>';
  FieldGoalsModel.keys.forEach(function(k){html+='<label>'+FIELD_KIND_LABELS[k]+'（'+fieldUnit(k)+'）<input name="'+k+'" type="number" min="0" max="10000" value="'+(s.metrics[k].goal===null?'':s.metrics[k].goal)+'"></label>';});
  fieldDialog('月の目標を設定',html,function(f){var data=structuredClone(fieldGoalsData()),g={prospects:f.get('prospects')===''?null:Number(f.get('prospects')),metrics:{}};FieldGoalsModel.keys.forEach(function(k){g.metrics[k]=f.get(k)===''?null:Number(f.get(k));});data.goals[m]=g;return data;});
}
function openFieldRecordEditor(m,id,kind,personRow,selectedDate){
  if(fieldGoalsEditingBlocked())return;var data=fieldGoalsData(),r=data.records.find(function(x){return x.id===id;}),today=fieldGoalsToday(),choices=[];
  DATA.forEach(function(p){if(DATA.filter(function(x){return x['名前(あだ名)']===p['名前(あだ名)'];}).length!==1)return;var known=data.persons.find(function(x){return x.name===p['名前(あだ名)'];});if(!known&&data.persons.some(function(x){return x.row===p._row&&x.name!==p['名前(あだ名)'];}))return;choices.push({value:known?known.id:'row:'+p._row,label:p['名前(あだ名)'],row:p._row});});
  if(r&&!choices.some(function(x){return x.value===r.personId;})){var saved=data.persons.find(function(p){return p.id===r.personId;});choices.push({value:saved.id,label:saved.name+'（人脈の再確認が必要）'});}
  var opts=function(items,current){return items.map(function(x){return '<option value="'+esc(x.value)+'"'+(x.value===current?' selected':'')+'>'+esc(x.label)+'</option>';}).join('');};
  var candidate=choices.find(function(x){return x.row===personRow;}),selectedKind=r?r.kind:kind||'introductions';
  var html='<label>活動種別<select name="kind">'+opts(FieldGoalsModel.keys.map(function(k){return {value:k,label:FIELD_KIND_LABELS[k]+'（'+fieldUnit(k)+'）'};}),selectedKind)+'</select></label><label>対象人物<select name="person" required><option value="">本人が選択</option>'+opts(choices,r?r.personId:candidate?candidate.value:'')+'</select></label><label>予定／実施日<input name="date" type="date" required value="'+esc(r?r.date:(selectedDate||(m===today.slice(0,7)?today:m+'-01')))+'"></label><label>状態<select name="status">'+opts(Object.keys(FIELD_STATUS_LABELS).map(function(k){return {value:k,label:FIELD_STATUS_LABELS[k]};}),r?r.status:(selectedDate?'confirmed':'proposed'))+'</select></label><label>目的・次にすること<textarea name="purpose" required maxlength="500">'+esc(r?r.purpose:kind?FIELD_KIND_LABELS[selectedKind]+'の機会を相談する':'')+'</textarea></label><label>本人が行動する期限<input name="dueDate" type="date" required value="'+esc(r?r.dueDate:(selectedDate||today))+'"></label><label><input name="outcome" type="checkbox"'+(r&&r.outcomeConfirmed?' checked':'')+'>紹介を実施し、この人が紹介につながったことを確認した</label><label><input name="newPerson" type="checkbox"'+(r&&r.newPersonForMonth?' checked':'')+'>人数指標について、この人は今月の日報累計や他の記録と重複しないと確認した</label><p>実施前に成果確認はできません。活動日が日報の対象日以前の記録は、重複の可能性があるため5指標への加算を保留します。人物名や行位置が変わり同一人物を確認できない場合、新しいIDを推測で作らず管理者に確認してください。</p>';
  fieldDialog(r?'行動の変更・取消':'相手と行動を記録',html,function(f){var next=structuredClone(fieldGoalsData()),personId=f.get('person');if(personId.startsWith('row:')){var p=DATA.find(function(x){return x._row===Number(personId.slice(4));});if(!p)throw Error('対象人物を再確認してください');personId=crypto.randomUUID();next.persons.push({id:personId,name:p['名前(あだ名)'],row:p._row});}if(f.get('status')==='completed'&&f.get('date')>today)throw Error('未来の日付は実施済みにできません');var item={id:r?r.id:crypto.randomUUID(),personId:personId,kind:f.get('kind'),status:f.get('status'),date:f.get('date'),dueDate:f.get('dueDate'),purpose:f.get('purpose').trim(),outcomeConfirmed:f.has('outcome'),newPersonForMonth:f.has('newPerson')};var at=next.records.findIndex(function(x){return x.id===item.id;});if(at<0)next.records.push(item);else next.records[at]=item;return next;});
}
async function fieldGoalsRequest(action,extra){var token=getWriteToken();if(!token)throw Error('書き込み用の合言葉が未設定です');var response=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({action:action,token:token},extra||{})),signal:AbortSignal.timeout(30000)});return response.json();}
async function refreshFieldGoals(){
  if(FIELD_GOALS_BUSY||FIELD_GOALS_READ_BUSY||FIELD_GOALS_EDITING)return;
  if(!getWriteToken()){FIELD_GOALS_PHASE='この端末のみ。同期には既存の書き込み用の合言葉が必要です。';if(VIEW==='field')renderFieldProgress();return;}
  FIELD_GOALS_READ_BUSY=true;var revision=FIELD_GOALS_REVISION;
  try{var j=await fieldGoalsRequest('fieldGoalsRead');if(!j.ok)throw Error('取得失敗');var state=FieldGoalsModel.validate(j.state);if(typeof j.version!=='string'||!j.version)throw Error('バージョン未取得');if(revision!==FIELD_GOALS_REVISION||FIELD_GOALS_EDITING)return;
    FIELD_GOALS_STATE=state;FIELD_GOALS_VERSION=j.version;
    if(FIELD_GOALS_PENDING&&j.requestId===FIELD_GOALS_PENDING.requestId&&JSON.stringify(state)===JSON.stringify(FIELD_GOALS_PENDING.state))FIELD_GOALS_PENDING=null;
    FIELD_GOALS_PHASE=FIELD_GOALS_PENDING?'未同期の変更を保持しています。再試行か取消を選んでください。':'同期済み';await persistSavedState();
  }catch(ignore){if(revision===FIELD_GOALS_REVISION&&!FIELD_GOALS_EDITING)FIELD_GOALS_PHASE='同期失敗。表示は端末の保存内容です。GASと目標達成管理シートの設定を確認し、再試行してください。';}
  finally{FIELD_GOALS_READ_BUSY=false;if(VIEW==='field'&&!FIELD_GOALS_EDITING)renderFieldProgress();}
}
async function saveFieldGoals(next){
  if(fieldGoalsEditingBlocked())return;FIELD_GOALS_REVISION++;if(FIELD_GOALS_PENDING)FIELD_GOALS_PENDING.state=FieldGoalsModel.validate(next);else FIELD_GOALS_PENDING={state:FieldGoalsModel.validate(next),version:FIELD_GOALS_VERSION,requestId:crypto.randomUUID(),sent:false};FIELD_GOALS_PHASE='保存中';renderFieldProgress();
  var stored=await persistSavedState();if(!stored){FIELD_GOALS_PHASE='この端末への保存に失敗。画面を閉じずに再試行してください。';renderFieldProgress();return;}
  if(!getWriteToken()){FIELD_GOALS_PHASE='この端末のみ（暗号化保存済み）。同期には合言葉が必要です。';renderFieldProgress();return;}await retryFieldGoals();
}
async function retryFieldGoals(){
  if(FIELD_GOALS_BUSY||!FIELD_GOALS_PENDING||FIELD_GOALS_EDITING)return;
  FIELD_GOALS_BUSY=true;FIELD_GOALS_PHASE='保存中';renderFieldProgress();var pending=FIELD_GOALS_PENDING;
  try{
    if(!await persistSavedState())throw Error('cache');
    if(!pending.version){var initial=await fieldGoalsRequest('fieldGoalsRead');if(!initial.ok)throw Error('read');var current=FieldGoalsModel.validate(initial.state);FIELD_GOALS_STATE=current;FIELD_GOALS_VERSION=initial.version;if(JSON.stringify(current)!==JSON.stringify(FieldGoalsModel.empty())){FIELD_GOALS_PHASE='別端末の記録があります。未同期の変更を取消して最新内容を確認してください。';return;}pending.version=initial.version;await persistSavedState();}
    pending.sent=true;if(!await persistSavedState())throw Error('cache');var j=await fieldGoalsRequest('fieldGoalsWrite',pending);if(j.error==='conflict'){FIELD_GOALS_PHASE='別端末の更新と競合しました。入力を保持しています。未同期の変更を取消して最新内容を確認してください。';return;}if(!j.ok&&j.message){FIELD_GOALS_PHASE=j.message+' 未同期の入力は保持しています。';return;}if(!j.ok)throw Error('sync');var data=FieldGoalsModel.validate(j.state);if(typeof j.version!=='string'||!j.version)throw Error('version');FIELD_GOALS_STATE=data;FIELD_GOALS_VERSION=j.version;FIELD_GOALS_PENDING=null;FIELD_GOALS_REVISION++;FIELD_GOALS_PHASE='同期済み';await persistSavedState();
  }catch(ignore){FIELD_GOALS_PHASE='同期失敗・再試行できます。未同期の変更は暗号化保存され、同じIDで再試行します。';}
  finally{FIELD_GOALS_BUSY=false;renderFieldProgress();}
}
