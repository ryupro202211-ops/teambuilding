
(function(root){
  'use strict';
  var keys=['orientation','introductions','individual','first_individual','new_friends'];
  var personMetrics=['orientation','first_individual','new_friends'];
  var statuses=['proposed','confirmed','completed','postponed','cancelled'];
  function empty(){return {goals:{},persons:[],records:[],missions:[]};}
  function date(s){return typeof s==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
  function month(s){return typeof s==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(s);}
  function validate(input){
    if(!input||!input.goals||typeof input.goals!=='object'||Array.isArray(input.goals)||!Array.isArray(input.persons)||!Array.isArray(input.records)||input.persons.length>200||input.records.length>300)throw Error('目標・行動データが不正です');
    var data=empty(),ids=new Set(),names=new Set();
    input.persons.forEach(function(p){if(!p||typeof p.id!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||names.has(p.name)||p.name.length>200||!Number.isInteger(p.row)||p.row<2)throw Error('人物IDが不正です');ids.add(p.id);names.add(p.name);data.persons.push({id:p.id,name:p.name,row:p.row});});
    if(Object.keys(input.goals).length>120)throw Error('目標月が多すぎます');
    Object.keys(input.goals).forEach(function(m){var g=input.goals[m];if(!month(m)||!g||typeof g!=='object')throw Error('目標月が不正です');var out={prospects:null,metrics:{}};if(g.prospects!==null&&(!Number.isInteger(g.prospects)||g.prospects<1||g.prospects>10000))throw Error('人数目標が不正です');out.prospects=g.prospects;keys.forEach(function(k){var n=g.metrics&&g.metrics[k];if(n!==null&&n!==undefined&&(!Number.isInteger(n)||n<0||n>10000))throw Error('指標目標が不正です');out.metrics[k]=n===undefined?null:n;});data.goals[m]=out;});
    var records=new Set();input.records.forEach(function(r){if(!r||typeof r.id!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(r.id)||records.has(r.id)||!ids.has(r.personId)||!keys.includes(r.kind)||!statuses.includes(r.status)||!date(r.date)||!date(r.dueDate)||typeof r.purpose!=='string'||!r.purpose.trim()||r.purpose.length>500||typeof r.outcomeConfirmed!=='boolean'||typeof r.newPersonForMonth!=='boolean')throw Error('行動記録が不正です');if(r.outcomeConfirmed&&(r.kind!=='introductions'||r.status!=='completed'))throw Error('紹介につながった確認は紹介の実施後に記録してください');records.add(r.id);data.records.push({id:r.id,personId:r.personId,kind:r.kind,status:r.status,date:r.date,dueDate:r.dueDate,purpose:r.purpose,outcomeConfirmed:r.outcomeConfirmed,newPersonForMonth:r.newPersonForMonth});});
    var missions=input.missions===undefined?[]:input.missions,missionIds=new Set();
    if(!Array.isArray(missions)||missions.length>120)throw Error('週ミッションが不正です');
    missions.forEach(function(w){
      if(!w||!month(w.month)||!date(w.weekStart)||new Date(w.weekStart+'T00:00:00Z').getUTCDay()!==1||!date(w.startDate)||w.startDate.slice(0,7)!==w.month||w.startDate<w.weekStart||w.startDate>weekEnd(w.weekStart)||w.id!==w.weekStart+'@'+w.month||missionIds.has(w.id)||!w.targets||!w.baseline)throw Error('週ミッションの日付が不正です');
      var targets={},baseline={recordIds:[],personIds:{}};
      ['prospects'].concat(keys).forEach(function(k){var n=w.targets[k];if(n!==null&&(!Number.isInteger(n)||n<0||n>10000))throw Error('週ミッション目標が不正です');targets[k]=n;var p=w.baseline.personIds&&w.baseline.personIds[k];if(!Array.isArray(p)||p.some(function(id){return !ids.has(id);})||new Set(p).size!==p.length)throw Error('週ミッション人物が不正です');baseline.personIds[k]=p.slice();});
      var b=w.baseline.recordIds;if(!Array.isArray(b)||b.some(function(id){return !records.has(id);})||new Set(b).size!==b.length)throw Error('週ミッション記録が不正です');baseline.recordIds=b.slice();missionIds.add(w.id);data.missions.push({id:w.id,month:w.month,weekStart:w.weekStart,startDate:w.startDate,targets:targets,baseline:baseline});
    });
    return data;
  }
  function count(rows,k){return personMetrics.includes(k)?new Set(rows.map(function(r){return r.personId;})).size:rows.length;}
  function weekStart(today){var d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
  function weekEnd(start){var d=new Date(start+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+6);return d.toISOString().slice(0,10);}
  function missionBaseline(data,m,today){
    var completed=data.records.filter(function(r){return r.status==='completed'&&r.date<=today&&r.date.slice(0,7)===m;}),baseline={recordIds:completed.map(function(r){return r.id;}),personIds:{}};
    baseline.personIds.prospects=Array.from(new Set(completed.filter(function(r){return r.kind==='introductions'&&r.outcomeConfirmed;}).map(function(r){return r.personId;})));
    keys.forEach(function(k){baseline.personIds[k]=Array.from(new Set(completed.filter(function(r){return r.kind===k;}).map(function(r){return r.personId;})));});return baseline;
  }
  function createMission(input,report,m,today){
    var data=validate(input),s=summarize(data,report,m,today),start=weekStart(today);
    if(m!==today.slice(0,7)||data.missions.some(function(w){return w.id===start+'@'+m;}))throw Error('今週ミッションは設定済み、または今月ではありません');
    var baseline=missionBaseline(data,m,today),targets={prospects:s.remaining===null?null:Math.ceil(s.remaining*s.weekDays/s.remainingDays)};
    keys.forEach(function(k){targets[k]=s.metrics[k].weekly;});
    if(!Object.values(targets).some(function(n){return n>0;}))throw Error('必要数が確認できる新しいミッションはありません');
    data.missions.push({id:start+'@'+m,month:m,weekStart:start,startDate:today,targets:targets,baseline:baseline});return validate(data);
  }
  function missionSummary(data,w,today){
    var rows=data.records.filter(function(r){return r.status==='completed'&&r.date>=w.startDate&&r.date<=today&&r.date<=weekEnd(w.weekStart)&&r.date.slice(0,7)===w.month&&!w.baseline.recordIds.includes(r.id);}),actual={};
    actual.prospects=new Set(rows.filter(function(r){return r.kind==='introductions'&&r.outcomeConfirmed&&!w.baseline.personIds.prospects.includes(r.personId);}).map(function(r){return r.personId;})).size;
    keys.forEach(function(k){var eligible=rows.filter(function(r){return r.kind===k&&(!personMetrics.includes(k)||(r.newPersonForMonth&&!w.baseline.personIds[k].includes(r.personId)));});actual[k]=count(eligible,k);});
    var required=Object.keys(w.targets).filter(function(k){return w.targets[k]>0;});return {actual:actual,required:required,achieved:required.length>0&&required.every(function(k){return actual[k]>=w.targets[k];})};
  }
  function summarize(data,report,m,today){
    data=validate(data);if(!month(m)||!date(today))throw Error('集計日が不正です');
    var records=data.records.filter(function(r){return r.date.slice(0,7)===m;});
    var completed=records.filter(function(r){return r.status==='completed'&&r.date<=today;}),prospects=new Set(completed.filter(function(r){return r.kind==='introductions'&&r.outcomeConfirmed;}).map(function(r){return r.personId;}));
    var g=data.goals[m],target=g?g.prospects:m===today.slice(0,7)?3:null;
    var end=new Date(m+'-01T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);var endDate=end.toISOString().slice(0,10);
    var remainingDays=m<today.slice(0,7)?0:Math.round((end-new Date((m===today.slice(0,7)?today:m+'-01')+'T00:00:00Z'))/86400000)+1;
    var untilSunday=7-((new Date(today+'T00:00:00Z').getUTCDay()+6)%7),weekDays=m===today.slice(0,7)?Math.min(remainingDays,untilSunday):Math.min(remainingDays,7);
    var confirmed=records.filter(function(r){return r.status==='confirmed'&&r.date>=today&&r.date<=endDate&&r.dueDate>=today;});
    var futurePeople=new Set(confirmed.filter(function(r){return r.kind==='introductions'&&!prospects.has(r.personId);}).map(function(r){return r.personId;}));
    var metrics={};keys.forEach(function(k){
      var base=report&&report.values?report.values[k]:null;base=Number.isInteger(base)&&base>=0?base:null;
      var goal=g?g.metrics[k]:report&&report.goals?report.goals[k]:null;goal=Number.isInteger(goal)&&goal>=0?goal:null;
      var rows=completed.filter(function(r){return r.kind===k;}),extra=rows.filter(function(r){return report&&date(report.activityDate)&&r.date>report.activityDate&&(!personMetrics.includes(k)||r.newPersonForMonth);});
      var held=rows.length-extra.length,additional=count(extra,k),actual=base===null?null:base+additional,gap=actual===null||goal===null?null:Math.max(0,goal-actual);
      var booked=confirmed.filter(function(r){return r.kind===k;}),bookedCount=count(booked,k);
      var eligible=booked.filter(function(r){return report&&date(report.activityDate)&&r.date>report.activityDate&&(!personMetrics.includes(k)||r.newPersonForMonth);});
      if(personMetrics.includes(k)){var extraIds=new Set(extra.map(function(r){return r.personId;}));eligible=eligible.filter(function(r){return !extraIds.has(r.personId);});}
      var secured=count(eligible,k);
      metrics[k]={reported:base,additional:additional,held:held,actual:actual,goal:goal,gap:gap,weekly:gap===null||remainingDays===0?null:Math.ceil(gap*weekDays/remainingDays),confirmed:bookedCount,secured:secured,unsecured:gap===null?null:Math.max(0,gap-secured),conditional:actual===null?null:actual+secured};
    });
    return {month:m,target:target,prospects:prospects.size,remaining:target===null?null:Math.max(0,target-prospects.size),conditionalProspects:prospects.size+futurePeople.size,metrics:metrics,records:records,weekDays:weekDays,remainingDays:remainingDays,actions:records.filter(function(r){return ['proposed','confirmed'].includes(r.status)&&r.dueDate<=today;})};
  }
  var model={keys:keys,personMetrics:personMetrics,statuses:statuses,empty:empty,validate:validate,date:date,month:month,summarize:summarize,weekStart:weekStart,weekEnd:weekEnd,createMission:createMission,missionSummary:missionSummary,missionBaseline:missionBaseline};
  if(typeof module!=='undefined'&&module.exports)module.exports=model;else root.FieldGoalsModel=model;
})(typeof globalThis!=='undefined'?globalThis:this);
