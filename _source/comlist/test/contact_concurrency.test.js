'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function gas(){
  let locked=false;const rows=[Array(45).fill(''),Array(45).fill('')];rows[1][0]='A';rows[1][2]='Fixture';rows[1][3]='2026/10/01';rows[1][5]='2026/12/01';rows[1][7]='9/1 会食';rows[1][21]='Engineer';
  const formulas=[Array(45).fill(''),Array(45).fill('')];
  const sheet={getMaxColumns:()=>45,getLastRow:()=>rows.length,getRange(r,c,n=1,m=1){return {getFormulas:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>formulas[r-1+i]?.[c-1+j]||'')),getValue:()=>rows[r-1][c-1]||'',getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>rows[r-1+i][c-1+j]||'')),getDataValidation:()=>null,setValue(v){assert.ok(locked);rows[r-1][c-1]=v;},setValues(v){assert.ok(locked);v.forEach((a,i)=>a.forEach((x,j)=>rows[r-1+i][c-1+j]=x));}};}};
  const ctx=vm.createContext({PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'token'})},SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush(){}},LockService:{getScriptLock:()=>({waitLock(){locked=true;},releaseLock(){locked=false;}})},ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})}});
  vm.runInContext(fs.readFileSync('sheet-api.gs','utf8'),ctx);
  const post=b=>ctx.doPost({postData:{contents:JSON.stringify({token:'token',row:2,name:'Fixture',...b})}});
  return {ctx,rows,formulas,post,ready(){ctx.CONTACT_TRACKING_HEADERS.forEach((x,i)=>rows[0][29+i]=x);},record:()=>ctx.readContacts_()[0]};
}
test('stale contact version and missing version reject before any history/profile writes',()=>{
  const g=gas(),version=g.record()._version;assert.equal(typeof version,'string');g.rows[1][21]='Other device';const before=JSON.stringify(g.rows);
  assert.equal(g.post({version,values:{'次会う日':'2026/12/02'}}).error,'conflict');assert.equal(JSON.stringify(g.rows),before);
  assert.equal(g.post({values:{'仕事(O)':'Overwrite'}}).error,'version required');assert.equal(JSON.stringify(g.rows),before);
});
test('successful update returns new version, follows unique name row drift and bulk reports each conflict',()=>{
  const g=gas();const version=g.record()._version;
  const r=g.post({version,values:{'仕事(O)':'Updated'}});assert.equal(r.ok,true);assert.notEqual(r.version,version);
  const bulk=g.post({action:'bulk',items:[{row:2,name:'Fixture',version,values:{'仕事(O)':'Stale'}}]});assert.equal(bulk.results[0].error,'conflict');assert.equal(g.rows[1][21],'Updated');
  g.rows.splice(1,0,Array(45).fill(''));g.rows[1][0]='B';g.rows[1][2]='Another';
  assert.equal(g.post({version:r.version,values:{'仕事(O)':'Moved'}}).row,3);assert.equal(g.rows[2][21],'Moved');
});
test('contact tracking refuses unconfigured columns and never sends/writes on invalid actions',()=>{
  const g=gas(),before=JSON.stringify(g.rows);const b={action:'contactAction',status:'waiting',date:'2026-10-02',requestId:'request-1234567890',version:g.record()._version};
  assert.equal(g.post(b).error,'tracking not ready');assert.equal(JSON.stringify(g.rows),before);g.ready();b.version=g.record()._version;
  for(const change of [{status:'send'},{date:'2026-02-30'},{requestId:'short'}])assert.equal(g.post({...b,...change}).ok,false);
});
test('explicit contact statuses persist, retries are idempotent and late retry preserves subsequent edits',()=>{
  for(const status of ['contacted','waiting','planning']){
    const g=gas();g.ready();const b={action:'contactAction',status,date:'2026-10-02',requestId:'request-1234567890',version:g.record()._version};
    const r=g.post(b);assert.equal(r.ok,true);assert.equal(r.contactState.status,status);const after=JSON.stringify(g.rows);assert.equal(g.post(b).ok,true);assert.equal(JSON.stringify(g.rows),after);
    assert.equal(g.rows[1][5],'2026/12/01');assert.equal(g.rows[1][21],'Engineer');
    if(status==='contacted'){assert.match(g.rows[1][7],/^9\/1 会食.*2026\/10\/2 連絡$/);assert.equal(g.rows[1][3],'2026/10/16');}else assert.equal(g.rows[1][7],'9/1 会食');
    assert.equal(g.post({version:r.version,values:{'仕事(O)':'Later'}}).ok,true);const replay=g.post(b);assert.equal(replay.ok,true);assert.equal(g.rows[1][21],'Later');assert.equal(replay.record['仕事(O)'],'Later');
  }
});
test('a future promised action date survives contacted recording and category comes from sheet',()=>{
  const g=gas();g.ready();g.rows[1][3]='2027/01/01';const r=g.post({action:'contactAction',status:'contacted',date:'2026-12-31',category:'D',requestId:'request-1234567890',version:g.record()._version});assert.equal(r.ok,true);assert.equal(g.rows[1][3],'2027/01/01');
});

test('AD:AF initialization and recording preserve existing AA:AC data, and refuse occupied tracking cells',()=>{
  const g=gas();g.rows[1][26]='Existing AA';g.rows[1][27]='Existing AB';g.rows[1][28]='Invitation text';
  const original=g.rows.map(r=>r.slice(0,29));assert.equal(g.ctx.setupContactTrackingSheet().columns,'AD:AF');
  assert.deepEqual(g.rows.map(r=>r.slice(0,29)),original);assert.deepEqual(g.rows[0].slice(29,32),Array.from(g.ctx.CONTACT_TRACKING_HEADERS));
  const r=g.post({action:'contactAction',status:'waiting',date:'2026-10-02',requestId:'request-1234567890',version:g.record()._version});assert.equal(r.ok,true);
  assert.deepEqual(g.rows.map(r=>r.slice(0,29)),original);assert.equal(g.rows[1][29],'waiting');assert.equal(g.rows[1][30],'2026-10-02');assert.equal(JSON.parse(g.rows[1][31]).id,'request-1234567890');
  for(const [row,col,value,formula] of [[1,29,'Occupied',''],[0,29,'Wrong header',''],[1,30,'','=""'],[0,30,'','=""']]){
    const h=gas();h.rows[row][col]=value;h.formulas[row][col]=formula;const before=JSON.stringify(h.rows);assert.throws(()=>h.ctx.setupContactTrackingSheet());assert.equal(JSON.stringify(h.rows),before);
  }
});
