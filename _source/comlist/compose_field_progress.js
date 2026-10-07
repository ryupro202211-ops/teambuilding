'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {METRICS,validateFieldProgress}=require('./field_progress');
const labels=['オリエン','紹介','個別','初個別','新友達'];
function composeFieldProgress(input,checkedAt){
 if(!input||input.complete!==true||!Array.isArray(input.rows))throw Error('field rows are not complete');
 if(typeof checkedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(checkedAt)||Number.isNaN(Date.parse(checkedAt)))throw Error('invalid check time');
 const months=new Map(),days=[];
 const values=(r,suffix)=>Object.fromEntries(METRICS.map((key,i)=>[key,r[labels[i]+' '+suffix]??null]));
 for(const r of input.rows){
  if(r['記録状況']!=='記録あり')continue;
  const activityDate=r['date:活動日:start'],reportDate=r['date:報告日:start'];
  if(!activityDate||!reportDate)continue;
  const month=activityDate.slice(0,7),dayValues=values(r,'進捗'),total=values(r,'月累計');
  days.push({activityDate,reportDate,url:r.url,values:dayValues});
  const rawMonth=String(r['原文目標月']||'').trim(),match=rawMonth.match(/^◎?(20\d{2})年(\d{1,2})月度実績$/);
  const targetMonth=match?match[1]+'-'+match[2].padStart(2,'0'):rawMonth;
  if(targetMonth!==month||!Object.values(total).some(n=>n!==null))continue;
  const previous=months.get(month);
  if(!previous||activityDate>previous.activityDate||(activityDate===previous.activityDate&&reportDate>previous.reportDate)){
   const last=new Date(Date.UTC(+month.slice(0,4),+month.slice(5),0)).toISOString().slice(0,10);
   months.set(month,{month,activityDate,reportDate,url:r.url,partial:activityDate!==last,values:total,goals:values(r,'月目標')});
  }
 }
 return validateFieldProgress({months:[...months.values()],days,checkedAt:new Date(checkedAt).toISOString()});
}
function verifyFresh(input,today){
 const out=validateFieldProgress(input);
 if(!out.checkedAt||new Date(Date.parse(out.checkedAt)+9*3600000).toISOString().slice(0,10)!==today)throw Error('field progress is not fresh for '+today);
 if(!Array.isArray(out.days))throw Error('daily field progress is missing');
 return out;
}
if(require.main===module){
 try{
  const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];
  if(args.includes('--verify')){verifyFresh(JSON.parse(fs.readFileSync(arg('--verify'),'utf8')),arg('--today'));console.log('FIELD_PROGRESS_FRESH: OK');}
  else {
   if(!args.includes('--input')||!args.includes('--checked-at')||!args.includes('--out'))throw Error('--input, --checked-at and --out required');
   const out=composeFieldProgress(JSON.parse(fs.readFileSync(arg('--input'),'utf8')),arg('--checked-at'));
   const dest=path.resolve(arg('--out')),tmp=dest+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';fs.mkdirSync(path.dirname(dest),{recursive:true});
   try{fs.writeFileSync(tmp,JSON.stringify(out)+'\n');fs.renameSync(tmp,dest);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
   console.log('FIELD_PROGRESS_COMPOSE: OK months='+out.months.length+' days='+out.days.length);
  }
 }catch(e){console.error('FIELD_PROGRESS_ERROR: '+e.message);process.exitCode=1;}
}
module.exports={composeFieldProgress,verifyFresh};
