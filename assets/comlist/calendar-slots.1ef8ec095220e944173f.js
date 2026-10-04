
var CALENDAR_AVAILABILITY=null,CALENDAR_SLOT_PREFS=null,calendarSlotWeek=0,calendarSlotsBusy=false,calendarSlotsError='',calendarSlotOpening=false;
function slotStamp(value){var ms=Date.parse(value);return Number.isFinite(ms)?new Date(ms+9*3600000).toISOString().slice(0,16).replace('T',' ')+'（日本時間）':'未確認';}
function slotTime(ms){return new Date(ms+9*3600000).toISOString().slice(11,16);}
function slotWeekHTML(slots,now){
  var day=86400000,today=CalendarAvailability.date(now),midnight=Date.parse(today+'T00:00:00+09:00');
  var monday=midnight-((new Date(midnight+9*3600000).getUTCDay()+6)%7)*day;
  var lastWeek=Math.floor((Date.parse(CalendarAvailability.date(now+7*day)+'T00:00:00+09:00')-monday)/(7*day));
  calendarSlotWeek=Math.max(0,Math.min(lastWeek,calendarSlotWeek));
  var start=monday+calendarSlotWeek*7*day,first=CalendarAvailability.date(start),last=CalendarAvailability.date(start+6*day);
  var from=8,to=24;
  slots.forEach(function(s){from=Math.min(from,Math.floor((s.start-Date.parse(s.date+'T00:00:00+09:00'))/3600000));});
  var height=(to-from)*44,axis='';
  for(var hour=from;hour<=to;hour++)axis+='<span style="top:'+((hour-from)*44)+'px">'+String(hour).padStart(2,'0')+':00</span>';
  var columns=Array.from({length:7},function(_,index){
    var stamp=start+index*day,date=CalendarAvailability.date(stamp),weekday=['日','月','火','水','木','金','土'][new Date(stamp+9*3600000).getUTCDay()];
    var inRange=date>=today&&date<=CalendarAvailability.date(now+7*day),items='';
    slots.forEach(function(s,slotIndex){if(s.date!==date)return;var a=(s.start-stamp)/3600000,b=(s.end-stamp)/3600000;
      var time=slotTime(s.start)+'〜'+(CalendarAvailability.date(s.end)!==s.date?'24:00':slotTime(s.end));
      items+='<button type="button" class="slot-candidate slot-week-event" data-slot-index="'+slotIndex+'" style="top:'+((a-from)*44)+'px;height:'+((b-a)*44)+'px" aria-label="'+esc(date+'（'+weekday+'）'+time+' この時間に予定を入れる')+'"><strong>'+time+'</strong><span>予定を入れる</span></button>';
    });
    return '<div class="slot-week-day'+(date===today?' is-today':'')+(inRange?'':' is-outside')+'" data-slot-date="'+date+'"><div class="slot-week-date">'+esc(date.slice(5).replace('-','/'))+'（'+weekday+'）'+(date===today?'<small>今日</small>':'')+'</div><div class="slot-week-track" style="height:'+height+'px">'+items+(!items?'<span class="slot-week-empty">'+(inRange?'候補なし':'対象期間外')+'</span>':'')+'</div></div>';
  }).join('');
  return '<div class="slot-week-controls"><button type="button" id="slot-week-prev" '+(calendarSlotWeek===0?'disabled':'')+' aria-label="前の週">‹ 前の週</button><strong>'+first+'〜'+last+'</strong><button type="button" id="slot-week-next" '+(calendarSlotWeek===lastWeek?'disabled':'')+' aria-label="次の週">次の週 ›</button></div><p class="slots-note">色付きの90分枠を押すと予定入力へ進みます。スマホでは横にスクロールして確認できます。</p><div class="slot-week-scroll" tabindex="0" role="region" aria-label="90分空き候補の週間カレンダー"><div class="slot-week-grid"><div class="slot-week-axis"><div class="slot-week-date">時間</div><div class="slot-week-hours" style="height:'+height+'px">'+axis+'</div></div>'+columns+'</div></div>';
}
function slotSettingsHTML(){
  var s=CALENDAR_SLOT_PREFS||CalendarAvailability.defaults();
  return '<details class="slot-settings"><summary>活動時間・移動余裕を設定（この端末のみ）</summary><form id="slot-settings-form"><p>既存設定：平日12:00〜13:30／18:00〜24:00、土日8:00〜24:00。睡眠・休み・祝日を含め、ご自身の活動時間に調整してください。空欄の時間帯は使いません。</p>'+[['weekday',0,'平日枠1'],['weekday',1,'平日枠2'],['weekend',0,'土日']].map(function(p){var w=s[p[0]][p[1]]||[];return '<label>'+p[2]+' <input aria-label="'+p[2]+'開始" name="'+p[0]+p[1]+'start" type="time" value="'+(w.length?slotTime(Date.UTC(2000,0,1,0,w[0])-9*3600000):'')+'">〜<input aria-label="'+p[2]+'終了" name="'+p[0]+p[1]+'end" type="text" inputmode="numeric" pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00" placeholder="24:00" value="'+(w.length?(w[1]===1440?'24:00':slotTime(Date.UTC(2000,0,1,0,w[1])-9*3600000)):'')+'"></label>';}).join('')+'<label>前後の移動・準備余裕（分） <input name="buffer" type="number" min="0" max="120" required value="'+(s.buffer===null?'':s.buffer)+'"></label><label>候補を出さない日（YYYY-MM-DD、カンマ区切り）<input name="excluded" value="'+esc(s.excludedDates.join(','))+'"></label><button type="submit">設定を保存</button><p id="slot-settings-error" role="status"></p></form></details>';
}
function renderSlots(){
  var box=document.getElementById('slots');if(!box)return;
  var now=Date.now();
  var result={slots:[],reason:'カレンダーを再取得し、活動時間と移動余裕を設定してください。'},info=CALENDAR_AVAILABILITY&&CALENDAR_AVAILABILITY.info;
  try{result=CalendarAvailability.compute(CALENDAR_AVAILABILITY,CALENDAR_SLOT_PREFS,now);}catch(error){if(CALENDAR_AVAILABILITY&&CALENDAR_SLOT_PREFS)result.reason=error.message;}
  if(calendarSlotsError)result={slots:[],reason:calendarSlotsError};
  var shown=result.slots;
  box.innerHTML='<section class="slot-candidates"><div class="slots-head"><h2>今から7日間の90分空き候補</h2><button id="slot-refresh" '+(calendarSlotsBusy?'disabled':'')+'>'+(calendarSlotsBusy?'取得中…':'カレンダーを再取得')+'</button></div><p class="slots-note">確認範囲：本人のメインカレンダーのみ。共有・別カレンダーは確認対象外です。空き時間を90分ずつ区切って表示します。</p>'+(info?'<p class="slots-note">取得：'+esc(slotStamp(info.fetchedAt))+' ／ 範囲：'+esc(slotStamp(info.rangeStart))+'〜'+esc(slotStamp(info.rangeEnd))+' ／ '+(info.complete?'取得完了':'一部未取得')+'</p>':'<p class="slots-note">取得日時・範囲は未確認です。</p>')+'<div role="status">'+esc(result.reason||(!result.slots.length?'条件に合う候補はありません。':''))+'</div>'+(result.reason?'':slotWeekHTML(shown,now))+slotSettingsHTML()+'<p class="slots-note">候補は取得時点の参考情報です。登録前にカレンダーを確認してください。ボタンは入力画面を開き、保存や招待は行いません。</p></section>';
  document.getElementById('slot-refresh').onclick=refreshCalendarAvailability;
  var prev=document.getElementById('slot-week-prev'),next=document.getElementById('slot-week-next');
  if(prev)prev.onclick=function(){calendarSlotWeek--;renderSlots();};
  if(next)next.onclick=function(){calendarSlotWeek++;renderSlots();};
  document.querySelectorAll('[data-slot-index]').forEach(function(b){b.onclick=function(){openSlotDraft(shown[+b.dataset.slotIndex]);};});
  document.getElementById('slot-settings-form').onsubmit=async function(e){e.preventDefault();var f=new FormData(e.target),s=CalendarAvailability.defaults();function minutes(value){if(!/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(value))throw Error('時間はHH:MMで入力してください');return +value.slice(0,2)*60+(+value.slice(3));}try{s.weekday=[];s.weekend=[];[['weekday',0],['weekday',1],['weekend',0]].forEach(function(p){var a=f.get(p[0]+p[1]+'start'),b=f.get(p[0]+p[1]+'end');if(a||b)s[p[0]].push([minutes(a),minutes(b)]);});s.buffer=Number(f.get('buffer'));s.excludedDates=String(f.get('excluded')).split(',').map(function(d){return d.trim();}).filter(Boolean);s.confirmed=true;CalendarAvailability.settings(s);CALENDAR_SLOT_PREFS=s;var saved=await persistSavedState();if(!saved)calendarSlotsError='この端末への設定保存に失敗しました。';else calendarSlotsError='';renderSlots();}catch(error){document.getElementById('slot-settings-error').textContent=error.message;}};
}
async function refreshCalendarAvailability(){
  if(calendarSlotsBusy)return;var token=getWriteToken()||askWriteToken();if(!token)return;
  calendarSlotsBusy=true;calendarSlotsError='';renderSlots();
  try{var response=await fetch(API_URL,{method:'POST',body:JSON.stringify({action:'read',what:'calendarAvailability',token:token}),signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('HTTP');var j=await response.json();if(!j.ok)throw Error('API');CALENDAR_AVAILABILITY=CalendarAvailability.validate(j.calendarAvailability);await persistSavedState();}catch(error){calendarSlotsError='カレンダー取得に失敗しました。空き候補は確認できません。再試行してください。';if(CALENDAR_AVAILABILITY){CALENDAR_AVAILABILITY.info.complete=false;await persistSavedState();}}finally{calendarSlotsBusy=false;renderSlots();}
}
async function openSlotDraft(slot){
  if(!slot||calendarSlotOpening)return;
  try{var current=CalendarAvailability.compute(CALENDAR_AVAILABILITY,CALENDAR_SLOT_PREFS,Date.now());if(current.reason||!current.slots.some(function(s){return s.start===slot.start&&s.end===slot.end;})){renderSlots();return;}}catch(staleCandidate){renderSlots();return;}
  calendarSlotOpening=true;
  try{if(eventMutationBusy())return;var editor=document.getElementById('eventEditor');if(editor&&!editor.hidden){setView('events');return;}setView('events');await openEventEditor();document.getElementById('eventDate').value=slot.date;document.getElementById('eventStartTime').value=slotTime(slot.start);document.getElementById('eventEndTime').value=CalendarAvailability.date(slot.end)!==slot.date?'24:00':slotTime(slot.end);}finally{calendarSlotOpening=false;}
}
