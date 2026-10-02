'use strict';
var CONTACT_ACTION_BUSY=false;
var CONTACT_ACTION_PHASE='';
var CONTACT_STATUS_LABELS={contacted:'連絡した',waiting:'返信待ち',planning:'次の予定を決める'};

// Promised dates outrank category. An explicit future promise is never brought forward.
function contactSuggestions(date){
  var base=parseDate(date||todayISO());if(!base)return [];
  base.setHours(0,0,0,0);
  return DATA.filter(function(p){return /^[ABCD]$/.test(p['カテゴリー']);}).map(function(p){
    var cat=p['カテゴリー'],meta=PLANT_META[cat],state=p._contactState||{};
    var promised=parseDate(p['アクション日']),n=promised?Math.round((promised-base)/86400000):null;
    if(n!==null&&n>0)return null;
    if(state.date===date)return null;
    if(n===null&&state.status==='contacted'){
      var last=parseDate(state.date);if(last&&(base-last)/86400000<meta.cycle)return null;
    }
    var reason=n!==null?'アクション日 '+p['アクション日']+(n<0?'（'+(-n)+'日超過）':'（今日の約束）'):'カテゴリ '+cat+'（'+meta.cycle+'日周期）・連絡日未設定';
    if(state.status==='waiting')reason+=' ／ 返信状況を確認';
    if(state.status==='planning')reason+=' ／ 次の予定を相談';
    return {person:p,reason:reason,gap:n,category:cat};
  }).filter(Boolean).sort(function(a,b){return (a.gap===null?1:0)-(b.gap===null?1:0)||(a.gap??0)-(b.gap??0)||a.category.localeCompare(b.category)||plantKey(a.person).localeCompare(plantKey(b.person));}).slice(0,3);
}
function contactSuggestionsHTML(actions){
  var date=todayISO(),rows=contactSuggestions(date);
  return '<h3>今日連絡する3人</h3><p class="contact-note">'+esc(date)+' の候補。約束したアクション日を優先し、同じ日ならA→B→C→D。候補だけでは連絡も記録も行いません。</p>'
    +(rows.length?rows.map(function(x){var p=x.person;return '<article class="contact-candidate"><button type="button" class="btn" data-contact-open="'+esc(plantKey(p))+'">'+esc(p['名前(あだ名)'])+'</button><p>'+esc(x.reason)+'</p>'
      +(p._contactState?'<small>記録：'+esc(CONTACT_STATUS_LABELS[p._contactState.status]||'')+' '+esc(p._contactState.date)+'</small>':'')
      +(actions?contactRecordControlsHTML(p):'')+'</article>';}).join(''):'<p>今日の候補はありません。連絡日の約束が先の人は、その日を待ちます。</p>');
}
function contactRecordControlsHTML(p){
  return '<div class="contact-actions">'+Object.keys(CONTACT_STATUS_LABELS).map(function(s){return '<button type="button" class="btn" data-contact-row="'+p._row+'" data-contact-status="'+s+'"'+(CONTACT_ACTION_BUSY||CONTACT_ACTION_PENDING||PANEL_EDIT||PROF_EDIT?' disabled':'')+'>'+CONTACT_STATUS_LABELS[s]+'</button>';}).join('')+'</div>';
}
function wireContactSuggestions(root){
  root.querySelectorAll('[data-contact-open]').forEach(function(b){b.onclick=function(){openPersonFromBrief(b.dataset.contactOpen);};});
  root.querySelectorAll('[data-contact-status]').forEach(function(b){b.onclick=function(){var p=DATA.find(function(x){return x._row===Number(b.dataset.contactRow);});if(p)recordContactAction(p,b.dataset.contactStatus);};});
}
function renderContactSuggestions(){
  var box=document.getElementById('gd-contact-suggestions');if(box){box.innerHTML=contactSuggestionsHTML(true);wireContactSuggestions(box);}
  var home=document.querySelector('[data-section="contacts"] .today-card-body');if(home){home.innerHTML=contactSuggestionsHTML(false);wireContactSuggestions(home);}
  document.querySelectorAll('[data-contact-status]').forEach(function(b){b.disabled=!!(CONTACT_ACTION_BUSY||CONTACT_ACTION_PENDING||PANEL_EDIT||PROF_EDIT);});
  renderContactActionStatus();
}
function requireContactVersion(o){
  if(!o||typeof o._version!=='string'||!o._version)throw Error('競合チェック用の情報がありません。編集を閉じて最新データを再取得してください。再取得しても表示される場合はGASの更新が必要です。');
  return o._version;
}
function contactWriteError(j){
  if(j.error==='conflict')return 'ほかの端末またはシートで更新されています。入力は保存していません。編集内容を控え、編集を閉じて再取得してからやり直してください。';
  if(j.error==='version required')return '競合チェック用の情報がありません。最新データを再取得してください。';
  return j.message||j.error||'保存結果を確認できませんでした。';
}
function applyContactResult(o,j){
  if(j.record){
    if(!validCachedContacts([j.record])||j.record._version!==j.version)throw Error('最新の記録結果を確認できませんでした。再取得してください。');
    Object.keys(o).forEach(function(k){delete o[k];});Object.assign(o,j.record);
  }
  if(j.row)o._row=j.row;
  Object.keys(j.updated||{}).forEach(function(k){if(j.updated[k])o[k]=j.updated[k];else delete o[k];});
  if(j.version)o._version=j.version;
  if(j.contactState)o._contactState=j.contactState;
}
async function recordContactAction(o,status){
  if(CONTACT_ACTION_BUSY||CONTACT_ACTION_PENDING||!CONTACT_STATUS_LABELS[status])return;
  if(PANEL_EDIT||PROF_EDIT||CONTACT_EDIT_BUSY||BULK_SAVE_BUSY||document.getElementById('bulk-dialog').open){CONTACT_ACTION_PHASE='編集中の内容を保存するか、編集を閉じてから記録してください。';renderContactActionStatus();return;}
  var date=todayISO();
  var note=status==='contacted'?'履歴へ追記し、期限を過ぎた連絡日はカテゴリ周期で次回に進めます。将来の約束や会う予定は保持します。':'会う予定・プロフィール・履歴は変更しません。';
  if(!confirm(o['名前(あだ名)']+'：'+date+'「'+CONTACT_STATUS_LABELS[status]+'」を記録します。'+note))return;
  var token=getWriteToken()||askWriteToken();if(!token){CONTACT_ACTION_PHASE='合言葉が必要です';renderContactActionStatus();return;}
  try{requireContactVersion(o);}catch(e){CONTACT_ACTION_PHASE=e.message;renderContactActionStatus();return;}
  CONTACT_ACTION_PENDING={row:o._row,name:o['名前(あだ名)'],version:o._version,date:date,status:status,requestId:crypto.randomUUID()};
  await persistSavedState();
  return retryContactAction();
}
async function retryContactAction(){
  if(CONTACT_ACTION_BUSY||!CONTACT_ACTION_PENDING)return;
  if(PANEL_EDIT||PROF_EDIT||CONTACT_EDIT_BUSY||BULK_SAVE_BUSY||document.getElementById('bulk-dialog').open){CONTACT_ACTION_PHASE='編集中の内容を保存するか、編集を閉じてから記録を再試行してください。';renderContactActionStatus();return;}
  var operation=CONTACT_ACTION_PENDING,token=getWriteToken();
  if(!token){CONTACT_ACTION_PHASE='この端末のみ・合言葉を設定して再試行してください';renderContactActionStatus();return;}
  CONTACT_ACTION_BUSY=true;CONTACT_ACTION_PHASE='保存中…（同期結果を確認中）';CONTACT_REVISION++;renderContactActionStatus();renderContactSuggestions();
  try{
    var res=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({action:'contactAction',token:token},operation)),signal:AbortSignal.timeout(30000)});
    var j=await res.json();if(!j||!j.ok){if(j&&j.error==='unauthorized')setWriteToken('');throw Error(contactWriteError(j||{}));}
    if(!j.version||!j.contactState)throw Error('GASの更新が必要です。記録結果を再取得して確認してください。');
    var o=DATA.find(function(p){return p._row===operation.row&&p['名前(あだ名)']===operation.name;})||DATA.find(function(p){return p['名前(あだ名)']===operation.name;});
    if(!o)throw Error('対象者を再取得して記録結果を確認してください。');
    applyContactResult(o,j);CONTACT_ACTION_PENDING=null;CONTACT_REVISION++;
    var saved=await persistSavedState();CONTACT_ACTION_PHASE='同期済み'+(saved?'':'（端末保存なし）');
    if(operation.status==='planning'){SELECTED=plantKey(o);PANEL_EDIT_KEY=SELECTED;PANEL_EDIT=true;PROF_EDIT=false;}
    render();if(VIEW==='today'){renderTodayTasks();wireTodayTasks();}
  }catch(e){CONTACT_ACTION_PHASE='同期失敗・再試行：'+e.message;if(!await persistSavedState())CONTACT_ACTION_PHASE+=' ／ 端末保存なし・再読み込み前に結果を確認してください。';}
  finally{CONTACT_ACTION_BUSY=false;renderContactSuggestions();}
}
function renderContactActionStatus(){
  var bar=document.getElementById('contact-action-bar');if(bar)bar.hidden=!CONTACT_ACTION_PHASE&&!CONTACT_ACTION_PENDING;
  var status=document.getElementById('contact-action-status');
  if(status)status.textContent=CONTACT_ACTION_PHASE||(CONTACT_ACTION_PENDING?'この端末に未同期の記録案があります。結果を確認して再試行してください。':'');
  var retry=document.getElementById('contact-action-retry'),cancel=document.getElementById('contact-action-cancel');
  if(retry){retry.hidden=!CONTACT_ACTION_PENDING;retry.disabled=CONTACT_ACTION_BUSY;}
  if(cancel){cancel.hidden=!CONTACT_ACTION_PENDING;cancel.disabled=CONTACT_ACTION_BUSY;}
}
document.getElementById('contact-action-retry').addEventListener('click',retryContactAction);
document.getElementById('contact-action-cancel').addEventListener('click',async function(){
  if(CONTACT_ACTION_BUSY||!CONTACT_ACTION_PENDING||!confirm('未同期の記録案を取り消して再取得します。通信先で完了していた記録は取り消されません。'))return;
  CONTACT_ACTION_PENDING=null;CONTACT_ACTION_PHASE='記録案を取り消しました';await persistSavedState();await refreshRegisteredPeople();renderContactSuggestions();
});
document.getElementById('task-sync-retry').addEventListener('click',function(){retryTaskSync();});
window.addEventListener('online',function(){if(typeof retryTaskSync==='function')retryTaskSync();});
