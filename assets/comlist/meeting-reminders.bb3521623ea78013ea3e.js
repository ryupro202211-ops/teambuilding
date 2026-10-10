
'use strict';
var MeetingRemindersModel=(function(){
  function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;var ms=Date.parse(value+'T00:00:00Z');return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value;}
  function shift(date,days){return new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}
  function validate(records){if(!Array.isArray(records)||records.length>10000)throw Error('invalid reminders');var ids=new Set();return records.map(function(r){if(!r||typeof r.id!=='string'||ids.has(r.id)||!Number.isInteger(r.row)||r.row<2||typeof r.name!=='string'||!validDate(r.meeting)||![7,3,1,0].includes(r.offset)||!validDate(r.due)||r.due!==shift(r.meeting,-r.offset)||typeof r.done!=='boolean'||r.id!==JSON.stringify([r.row,r.name,r.meeting,r.offset]))throw Error('invalid reminder');ids.add(r.id);return Object.assign({},r);});}
  function update(records,people,today){var ids=new Set(records.map(function(r){return r.id;})),changed=false;
    people.forEach(function(p){var raw=String(p['次会う日']||'').replace(/\//g,'-'),date=raw.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/,function(_,y,m,d){return y+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0');});if(!validDate(date)||date<today||!Number.isInteger(p._row))return;
      [7,3,1,0].forEach(function(offset){var due=shift(date,-offset),name=p['名前(あだ名)']||'名前なし',id=JSON.stringify([p._row,name,date,offset]);if(due>today||ids.has(id))return;records.push({id:id,row:p._row,name:name,meeting:date,offset:offset,due:due,done:false});ids.add(id);changed=true;});
    });return changed;
  }
  return {shift:shift,validate:validate,update:update};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=MeetingRemindersModel;
var MEETING_REMINDERS=[],MEETING_REMINDER_SAVING_ID=null,MEETING_REMINDER_BUSY=false,MEETING_REMINDER_OPEN=false,MEETING_REMINDER_NOTICE='';
function meetingReminderToday(){return new Date(Date.now()+9*3600000).toISOString().slice(0,10);}
function meetingReminderBadge(count){return count?'<span class="meeting-new-badge" aria-label="未完了 '+count+'件">'+count+'</span>':'';}
function renderMeetingReminders(){
  if(typeof document==='undefined'||!document||typeof DATA==='undefined'||typeof SAVED_SESSION==='undefined'||!SAVED_SESSION)return;
  if(MeetingRemindersModel.update(MEETING_REMINDERS,DATA,meetingReminderToday()))persistSavedState().then(function(ok){if(!ok){MEETING_REMINDER_NOTICE='端末への保存に失敗しました。リマインドを保存し直してください。';renderMeetingReminders();}else if(getWriteToken())syncMeetingReminders();});
  var pending=MEETING_REMINDERS.filter(function(r){return !r.done||r.id===MEETING_REMINDER_SAVING_ID||(getWriteToken()&&r.done&&!r.synced);}).sort(function(a,b){return a.due.localeCompare(b.due)||a.meeting.localeCompare(b.meeting)||a.name.localeCompare(b.name);});
  var menu=document.querySelector('.tab[data-view="garden"]');if(menu){var old=menu.querySelector('.meeting-new-badge');if(old)old.remove();menu.insertAdjacentHTML('beforeend',meetingReminderBadge(pending.length));}
  var box=document.getElementById('garden-reminders');if(!box)return;
  box.innerHTML='<button type="button" class="btn meeting-reminder-toggle" aria-expanded="'+MEETING_REMINDER_OPEN+'">会う予定のリマインド'+meetingReminderBadge(pending.length)+'</button><div class="meeting-reminder-list"'+(MEETING_REMINDER_OPEN?'':' hidden')+'><p class="contact-note">1週間前・3日前・前日・当日にお知らせします。完了するまで残ります。書き込み合言葉を設定した端末間で完了状態を共有します。</p>'+(pending.length?pending.map(function(r){var label={7:'1週間前',3:'3日前',1:'前日',0:'当日'}[r.offset];return '<article class="meeting-reminder-item"><div><strong>'+esc(r.name)+' ／ '+label+'</strong><p>会う日：'+esc(r.meeting)+' ／ リマインド日：'+esc(r.due)+'</p></div><button type="button" class="btn" data-reminder-id="'+esc(r.id)+'"'+(MEETING_REMINDER_BUSY?' disabled':'')+'>リマインド完了</button></article>';}).join(''):'<p>未完了のリマインドはありません。</p>')+'</div><p class="meeting-reminder-status" role="status">'+esc(MEETING_REMINDER_NOTICE)+'</p>'+(MEETING_REMINDER_NOTICE?'<button type="button" class="btn" id="meeting-reminder-retry">保存を再試行</button>':'');
  box.querySelector('.meeting-reminder-toggle').onclick=function(){MEETING_REMINDER_OPEN=!MEETING_REMINDER_OPEN;renderMeetingReminders();};
  box.querySelectorAll('[data-reminder-id]').forEach(function(b){b.onclick=function(){completeMeetingReminder(b.dataset.reminderId);};});
  var retry=box.querySelector('#meeting-reminder-retry');if(retry)retry.onclick=async function(){if(await persistSavedState())MEETING_REMINDER_NOTICE='';await syncMeetingReminders();renderMeetingReminders();};
  var syncButton=document.createElement('button');syncButton.type='button';syncButton.className='btn';syncButton.textContent='リマインドを同期';syncButton.disabled=!!MEETING_REMINDER_SYNC;syncButton.onclick=function(){if(getWriteToken()||askWriteToken())syncMeetingReminders();};box.appendChild(syncButton);
}
async function completeMeetingReminder(id){
  if(MEETING_REMINDER_BUSY)return;var item=MEETING_REMINDERS.find(function(r){return r.id===id;});if(!item)return;
  if(!getWriteToken()&&!askWriteToken()){MEETING_REMINDER_NOTICE='端末間で完了状態を共有するには、書き込み合言葉が必要です。';renderMeetingReminders();return;}
  if(item.done){await syncMeetingReminders();return;}
  MEETING_REMINDER_BUSY=true;MEETING_REMINDER_SAVING_ID=id;renderMeetingReminders();item.done=true;item.synced=false;
  var ok=await persistSavedState();if(!ok){item.done=false;MEETING_REMINDER_NOTICE='完了状態を保存できませんでした。もう一度、完了ボタンを押してください。';}else MEETING_REMINDER_NOTICE='';
  if(ok){await syncMeetingReminders();if(getWriteToken()&&item.done&&!item.synced&&MEETING_REMINDER_NOTICE==='リマインドを同期しました。')await syncMeetingReminders();}MEETING_REMINDER_BUSY=false;MEETING_REMINDER_SAVING_ID=null;renderMeetingReminders();
}
var MEETING_REMINDER_SYNC=null,MEETING_REMINDER_SYNC_SESSION=null,MEETING_REMINDER_RESYNC=false;
async function reminderStateRequest(body,token){
  var response=await fetch(API_URL,{method:'POST',body:JSON.stringify(Object.assign({action:'reminderState',token:token},body)),signal:AbortSignal.timeout(20000)}),result=await response.json();
  if(!result||result.ok!==true||result.version!==1||!result.done||typeof result.done!=='object'||Array.isArray(result.done)||Object.keys(result.done).some(function(id){return !/^[a-f0-9]{64}$/.test(id)||result.done[id]!==true;}))throw Error('invalid reminder response');
  if(body.op==='set'&&result.done[body.id]!==true)throw Error('missing reminder acknowledgement');return result.done;
}
function syncMeetingReminders(){
  if(MEETING_REMINDER_SYNC){MEETING_REMINDER_RESYNC=true;return MEETING_REMINDER_SYNC;}
  if(typeof SAVED_SESSION==='undefined'||!SAVED_SESSION)return Promise.resolve(false);
  var token=getWriteToken(),session=SAVED_SESSION;
  if(!token){MEETING_REMINDER_NOTICE='完了状態はこの端末に保存しています。端末間で共有するには「リマインドを同期」から書き込み合言葉を設定してください。';renderMeetingReminders();return Promise.resolve(false);}
  MEETING_REMINDER_SYNC=(async function(){try{
    do {
    MEETING_REMINDER_RESYNC=false;
    var records=MEETING_REMINDERS.slice(),ids=await Promise.all(records.map(async function(r){var digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(r.id));return Array.from(new Uint8Array(digest),function(b){return b.toString(16).padStart(2,'0');}).join('');}));
    for(var start=0;start<ids.length;start+=100){var remote=await reminderStateRequest({op:'get',ids:ids.slice(start,start+100)},token);if(SAVED_SESSION!==session)return false;
      for(var i=start;i<Math.min(start+100,ids.length);i++){var r=records[i];if(remote[ids[i]]){r.done=true;r.synced=true;}else if(r.done){await reminderStateRequest({op:'set',id:ids[i],done:true},token);if(SAVED_SESSION!==session)return false;r.synced=true;}}
    }
    if(!await persistSavedState())throw Error('local save failed');
    } while(MEETING_REMINDER_RESYNC);
    MEETING_REMINDER_NOTICE='リマインドを同期しました。';return true;
  }catch(e){MEETING_REMINDER_NOTICE='同期できませんでした。完了記録は端末に残っています。「リマインドを同期」で再試行してください。';return false;}
  })().finally(function(){MEETING_REMINDER_SYNC=null;renderMeetingReminders();});return MEETING_REMINDER_SYNC;
}
if(typeof document!=='undefined'){document.addEventListener('visibilitychange',function(){if(!document.hidden){renderMeetingReminders();syncMeetingReminders();}});setInterval(function(){renderMeetingReminders();syncMeetingReminders();},60000);}
