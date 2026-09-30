const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function api(){
  const rows=[Array(26).fill('')], notes={}; let locked=false;
  const sheet={getLastRow:()=>rows.length,getMaxRows:()=>100,
    getRange(r,c,n=1,m=1){return {
      getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>rows[r-1+i]?.[c-1+j]||'')),
      getNotes:()=>Array.from({length:n},(_,i)=>[notes[r+i]||'']),
      setNote:v=>{notes[r]=v;},
      setValues:vv=>{assert.ok(locked); vv.forEach((v,i)=>{rows[r-1+i]??=Array(26).fill('');v.forEach((x,j)=>rows[r-1+i][c-1+j]=x);});}
    };}
  };
  const ctx=vm.createContext({
    PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'test-token'})},
    SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush(){}},
    LockService:{getScriptLock:()=>({waitLock(){locked=true;},releaseLock(){locked=false;}})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../sheet-api.gs'),'utf8'),ctx);
  return {rows,post:b=>ctx.doPost({postData:{contents:JSON.stringify(b)}})};
}
const body=()=>({token:'test-token',action:'create',requestId:'test-request-12345678',values:{'カテゴリー':'A','名前(あだ名)':'テスト専用','仕事(O)':'営業'}});
test('create appends an authenticated record with the correct row',()=>{
  const a=api(), r=a.post(body());assert.equal(r.ok,true);assert.equal(r.record._row,2);assert.equal(r.record['カテゴリー'],'A');assert.equal(a.rows.length,2);
});
test('retrying the same request never appends twice',()=>{
  const a=api();a.post(body());const r=a.post(body());assert.equal(r.replayed,true);assert.equal(a.rows.length,2);
});
test('invalid token, category, empty name and duplicate names are rejected',()=>{
  const a=api();for(const b of [{...body(),token:''},{...body(),values:{'カテゴリー':'X','名前(あだ名)':'test'}},{...body(),values:{'カテゴリー':'A','名前(あだ名)':' '}}])assert.equal(a.post(b).ok,false);
  assert.equal(a.rows.length,1);a.post(body());assert.equal(a.post({...body(),requestId:'another-request-12345'}).error,'duplicate');assert.equal(a.rows.length,2);
});
test('formula-like text is escaped and protected fields are ignored',()=>{
  const a=api(),b=body();b.values['メモ']='=1+1';b.values['履歴']='overwrite';b.values['現在の年齢']='99';a.post(b);assert.equal(a.rows[1][25],"'=1+1");assert.equal(a.rows[1][7],'');assert.equal(a.rows[1][13],'');
});
test('UI opens category form and handles save success, failure and repeat click',async()=>{
  const {JSDOM}=require('jsdom');
  const src=require("../app_sources").readApp(path.join(__dirname,'../_assets/list.html')).replace('<script src="data.js"></script>','<script>let DATA=[];</script>');
  const d=new JSDOM(src,{runScripts:'dangerously',url:'http://localhost'}),w=d.window,doc=w.document;
  w.setView('garden');
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.HTMLElement.prototype.scrollIntoView=function(){};
  w.prompt=()=>{throw new Error('Native prompt must not be used');};
  assert.equal(doc.querySelectorAll('.gd-add').length,4);
  doc.querySelector('[data-category="B"]').click();assert.equal(doc.getElementById('person-category').value,'B');assert.equal(doc.getElementById('person-dialog').open,true);
  doc.getElementById('person-name').value='新規デモ';let calls=0, resolve;
  w.fetch=()=>{calls++;return new Promise(r=>resolve=r);};
  const form=doc.getElementById('person-form');
  form.dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(calls,0);assert.equal(doc.activeElement.id,'person-token');
  doc.getElementById('person-token').value='wrong-token';
  form.dispatchEvent(new w.Event('submit',{cancelable:true}));
  resolve({json:async()=>({ok:false,error:'unauthorized'})});await new Promise(r=>setImmediate(r));
  assert.equal(w.localStorage.getItem('comunitylisttolevel9'),null);assert.equal(doc.getElementById('person-token').value,'');assert.equal(doc.getElementById('person-name').value,'新規デモ');
  calls=0;doc.getElementById('person-token').value='test-token';
  form.dispatchEvent(new w.Event('submit',{cancelable:true}));form.dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(calls,1);
  resolve({json:async()=>({ok:false,error:'duplicate',message:'同じ名前が登録されています。'})});
  await new Promise(r=>setImmediate(r));assert.equal(doc.getElementById('person-dialog').open,true);assert.equal(doc.getElementById('person-name').value,'新規デモ');assert.equal(doc.getElementById('person-save').disabled,false);
  w.fetch=async()=>({json:async()=>({ok:true,record:{_row:2,'カテゴリー':'B','名前(あだ名)':'新規デモ'}})});
  form.dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setImmediate(r));assert.equal(doc.getElementById('person-dialog').open,false);assert.equal(doc.querySelectorAll('.plant').length,1);
  assert.equal(w.localStorage.getItem('comunitylisttolevel9'),'test-token');assert.equal(doc.getElementById('person-token').value,'');w.close();
});
