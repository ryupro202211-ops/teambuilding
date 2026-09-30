const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const old=[{_row:2,'カテゴリー':'A','名前(あだ名)':'Demo','仕事(O)':'Old','メモ':'Clear me'},{_row:3,'カテゴリー':'B','名前(あだ名)':'Removed'}];
function setup(t){
  const src=require("../app_sources").readApp(path.join(__dirname,'../_assets/list.html')).replace('<script src="data.js"></script>','<script>let DATA='+JSON.stringify(old)+';</script>');
  const d=new JSDOM(src,{runScripts:'dangerously',url:'http://localhost'});
  t.after(()=>d.window.close());
  d.window.setView('garden');
  d.window.localStorage.setItem('comunitylisttolevel9','test-token');
  return d.window;
}
const data=w=>JSON.parse(w.eval('JSON.stringify(DATA)'));
test('refresh replaces existing fields, cleared fields and deleted rows using sheet row identity',async t=>{
  const w=setup(t);
  const records=[{_row:2,'カテゴリー':'C','名前(あだ名)':'Demo','仕事(O)':'Updated'},{_row:4,'カテゴリー':'D','名前(あだ名)':'Demo'}];
  w.fetch=async(url,opts)=>{assert.deepEqual(JSON.parse(opts.body),{token:'test-token',action:'read',what:'contacts'});return {json:async()=>({ok:true,records,count:2})};};
  await w.refreshRegisteredPeople();
  assert.deepEqual(data(w),records);
  assert.equal(w.document.querySelectorAll('.plant').length,2);
});
test('read failure preserves the snapshot and offers a retry',async t=>{
  const w=setup(t);w.fetch=async()=>{throw Error('offline');};
  await w.refreshRegisteredPeople();assert.deepEqual(data(w),old);
  assert.equal(w.document.getElementById('contact-sync-retry').hidden,false);
  assert.match(w.document.getElementById('contact-sync-status').textContent,/古い可能性/);
});
test('an older in-flight response cannot undo a newer local save',async t=>{
  const w=setup(t);let resolve;
  w.fetch=()=>new Promise(r=>resolve=r);
  const pending=w.refreshRegisteredPeople();
  w.eval('CONTACT_REVISION++; DATA[0]["仕事(O)"]="Saved"');
  resolve({json:async()=>({ok:true,records:old})});await pending;
  assert.equal(data(w)[0]['仕事(O)'],'Saved');
  assert.equal(w.document.getElementById('contact-sync-retry').hidden,false);
});
test('active profile editing is not replaced by a refresh',async t=>{
  const w=setup(t);w.eval('PROF_EDIT=true');
  w.fetch=async()=>({json:async()=>({ok:true,records:[{...old[0],'仕事(O)':'Remote'}]})});
  await w.refreshRegisteredPeople();assert.deepEqual(data(w),old);
});
test('malformed, empty and duplicate-row responses never replace contacts',async t=>{
  const w=setup(t);
  for(const records of [[],[{}],[old[0],old[0]]]){
    w.fetch=async()=>({json:async()=>({ok:true,records})});
    await w.refreshRegisteredPeople();assert.deepEqual(data(w),old);
    assert.equal(w.document.getElementById('contact-sync-retry').hidden,false);
  }
});
test('read started during registration cannot remove the successfully registered person',async t=>{
  const w=setup(t),doc=w.document;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.HTMLElement.prototype.scrollIntoView=function(){};
  let finishCreate,finishRead;
  w.fetch=(url,opts)=>new Promise(r=>{if(JSON.parse(opts.body).action==='create')finishCreate=r;else finishRead=r;});
  doc.querySelector('.gd-add').click();doc.getElementById('person-name').value='New';
  doc.getElementById('person-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  const pending=w.refreshRegisteredPeople();
  finishCreate({json:async()=>({ok:true,record:{_row:4,'カテゴリー':'A','名前(あだ名)':'New'}})});
  await new Promise(r=>setImmediate(r));
  finishRead({json:async()=>({ok:true,records:old})});await pending;
  assert.equal(data(w).length,3);
});
