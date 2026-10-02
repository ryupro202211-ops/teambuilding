const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const COL={category:0,name:2,actionDate:3,history:7};

function api(seed){
  const rows=(seed||[]).map(r=>r.slice());
  let locked=false,waitLockCalls=0;
  const sheet={
    getLastRow:()=>rows.length,
    getRange(r,c,n=1,m=1){
      return {
        getValue:()=>rows[r-1]?.[c-1]||'',
        getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>rows[r-1+i]?.[c-1+j]||'')),
        getDataValidation:()=>null,
        setValue:v=>{assert.ok(locked,'contacted writes under ScriptLock');rows[r-1][c-1]=v;}
      };
    }
  };
  const ctx=vm.createContext({
    PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'test-token'})},
    SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet})},
    LockService:{getScriptLock:()=>({waitLock(){waitLockCalls++;locked=true;},releaseLock(){locked=false;}})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../sheet-api.gs'),'utf8'),ctx);
  return {rows,post:b=>{const p=ctx.readContacts_().find(p=>p['名前(あだ名)']===b.name);return ctx.doPost({postData:{contents:JSON.stringify({...b,version:b.version||p?._version})}});},getWaitLockCalls:()=>waitLockCalls};
}

function row(category,name,actionDate='',history=''){
  const r=Array(26).fill('');
  r[COL.category]=category;r[COL.name]=name;r[COL.actionDate]=actionDate;r[COL.history]=history;
  return r;
}

function body(overrides={}){
  return Object.assign({action:'contacted',token:'test-token',requestId:'contact-123456789',row:2,name:'あいこ',category:'A',date:'2026-09-16'},overrides);
}

test('A/B/C/D cycles are calculated from the supplied checked date',()=>{
  const cases=[['A','9/30'],['B','10/16'],['C','12/15'],['D','1/14']];
  for(const [category,want] of cases){
    const a=api([row('', ''),row(category,'あいこ','1/1')]);
    const r=a.post(body({category}));
    assert.equal(r.ok,true);assert.equal(r.updated['履歴'],'9/16 連絡');assert.equal(r.updated['アクション日'],want);
  }
});

test('retry on the same day does not duplicate the complete history entry',()=>{
  const a=api([row('', ''),row('A','あいこ')]);
  const request=body();a.post(request);const again=a.post(request);
  assert.equal(again.ok,true);assert.equal(a.rows[1][COL.history],'9/16 連絡');assert.equal(a.rows[1][COL.actionDate],'9/30');
});

test('row drift is repaired only when the exact name is unique',()=>{
  const a=api([row('', ''),row('A','別人'),row('B','あいこ')]);
  const r=a.post(body({category:'B'}));
  assert.equal(r.ok,true);assert.equal(r.row,3);assert.equal(r.name,'あいこ');assert.equal(a.rows[1][COL.history],'');assert.equal(a.rows[2][COL.history],'9/16 連絡');
});

test('ambiguous exact names are rejected without writes',()=>{
  const a=api([row('', ''),row('A','別人'),row('A','あいこ'),row('A','あいこ')]);
  const r=a.post(body());
  assert.equal(r.ok,false);assert.equal(r.error,'ambiguous name');assert.equal(a.rows[2][COL.history],'');assert.equal(a.rows[3][COL.history],'');
});

test('invalid request id, date and category are rejected',()=>{
  for(const change of [{requestId:'short'},{date:'2026-02-30'},{date:'16/09/2026'},{category:'X'}]){
    const a=api([row('', ''),row('A','あいこ')]);const r=a.post(body(change));
    assert.equal(r.ok,false);assert.equal(a.rows[1][COL.history],'');assert.equal(a.rows[1][COL.actionDate],'');
  }
});

test('prototype-inherited category names are rejected',()=>{
  for(const category of ['toString','constructor','__proto__']){
    const a=api([row('', ''),row('A','あいこ')]);const r=a.post(body({category}));
    assert.equal(r.ok,false,category);assert.equal(a.rows[1][COL.history],'');assert.equal(a.rows[1][COL.actionDate],'');
  }
});

test('unauthorized requests are rejected before locking or writing',()=>{
  const a=api([row('', ''),row('A','あいこ')]);const r=a.post(body({token:'wrong'}));
  assert.deepEqual(r,{ok:false,error:'unauthorized'});assert.equal(a.getWaitLockCalls(),0);assert.equal(a.rows[1][COL.history],'');
});
