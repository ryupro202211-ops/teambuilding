
(function(root){
  'use strict';
  var minute=60000,day=86400000;
  function wall(value){if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('予定時刻の形式が不正です');var ms=Date.parse(value+':00+09:00');if(!Number.isFinite(ms)||new Date(ms+9*3600000).toISOString().slice(0,16)!==value)throw Error('予定時刻が不正です');return ms;}
  function date(ms){return new Date(ms+9*3600000).toISOString().slice(0,10);}
  function defaults(){return {weekday:[[720,810],[1080,1440]],weekend:[[480,1440]],buffer:null,excludedDates:[],confirmed:false};}
  function settings(s){if(!s||s.confirmed!==true||!Number.isInteger(s.buffer)||s.buffer<0||s.buffer>120||!Array.isArray(s.excludedDates)||s.excludedDates.some(function(d){return !/^20\d{2}-\d{2}-\d{2}$/.test(d);}))throw Error('活動時間と移動余裕を設定してください');['weekday','weekend'].forEach(function(k){if(!Array.isArray(s[k])||s[k].length>4||s[k].some(function(w){return !Array.isArray(w)||w.length!==2||!Number.isInteger(w[0])||!Number.isInteger(w[1])||w[0]<0||w[1]>1440||w[1]<=w[0];}))throw Error('活動時間が不正です');});return s;}
  function validate(input){
    if(!input||!Array.isArray(input.events)||input.events.length>5000||!input.info)throw Error('カレンダー取得結果が不正です');
    var i=input.info,start=Date.parse(i.rangeStart),end=Date.parse(i.rangeEnd),fetched=Date.parse(i.fetchedAt);
    if(i.source!=='primary'||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!Number.isFinite(fetched)||typeof i.complete!=='boolean')throw Error('取得範囲を確認できません');
    input.events.forEach(function(r){if(!Array.isArray(r)||r.length<3||wall(r[1])<=wall(r[0])||!r[2]||typeof r[2].allDay!=='boolean')throw Error('予定の取得結果が不正です');});return input;
  }
  function compute(input,prefs,now){
    var value=validate(input),s=settings(prefs),ms=now instanceof Date?now.getTime():Number(now),end=ms+7*day,i=value.info;
    if(!Number.isFinite(ms))throw Error('現在時刻が不正です');
    if(!i.complete)return {slots:[],reason:'一部の予定情報が未取得です。再取得してください。'};
    if(ms-Date.parse(i.fetchedAt)>3*3600000||Date.parse(i.fetchedAt)>ms+5*minute)return {slots:[],reason:'取得結果が古いか時刻が不正です。再取得してください。'};
    if(Date.parse(i.rangeStart)>ms||Date.parse(i.rangeEnd)<end)return {slots:[],reason:'7日間の取得範囲が不足しています。再取得してください。'};
    var busy=[];
    value.events.forEach(function(r){var m=r[2],status=String(m.status||'').toLowerCase(),reply=String(m.selfStatus||'').toLowerCase(),trans=String(m.transparency||'').toLowerCase();if(status==='cancelled'||reply==='no'||reply==='declined'||trans==='transparent')return;busy.push([wall(r[0])-s.buffer*minute,wall(r[1])+s.buffer*minute]);});
    busy.sort(function(a,b){return a[0]-b[0];});var merged=[];busy.forEach(function(b){var last=merged[merged.length-1];if(last&&last[1]>=b[0])last[1]=Math.max(last[1],b[1]);else merged.push(b.slice());});
    var slots=[];
    for(var n=0;n<=7;n++){
      var d=date(ms+n*day),midnight=Date.parse(d+'T00:00:00+09:00');if(s.excludedDates.includes(d))continue;
      var weekday=new Date(midnight+9*3600000).getUTCDay(),windows=weekday===0||weekday===6?s.weekend:s.weekday,free=[];
      windows.forEach(function(w){var a=Math.max(midnight+w[0]*minute,Math.ceil(ms/minute)*minute),b=Math.min(midnight+w[1]*minute,end);if(b<=a)return;var cursor=a;merged.forEach(function(block){if(block[1]<=cursor||block[0]>=b)return;if(block[0]>cursor)free.push([cursor,Math.min(block[0],b)]);cursor=Math.max(cursor,block[1]);});if(cursor<b)free.push([cursor,b]);});
      // One candidate per contiguous gap, even when activity windows overlap.
      free.sort(function(a,b){return a[0]-b[0];});var gaps=[];free.forEach(function(g){var last=gaps[gaps.length-1];if(last&&last[1]>=g[0])last[1]=Math.max(last[1],g[1]);else gaps.push(g.slice());});gaps.forEach(function(g){if(g[1]-g[0]>=90*minute)slots.push({start:g[0],end:g[0]+90*minute,date:d});});
    }
    return {slots:slots.sort(function(a,b){return a.start-b.start;}),reason:''};
  }
  var model={wall:wall,date:date,defaults:defaults,settings:settings,validate:validate,compute:compute};
  if(typeof module!=='undefined'&&module.exports)module.exports=model;else root.CalendarAvailability=model;
})(typeof globalThis!=='undefined'?globalThis:this);
