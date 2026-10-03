'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
function gas(){
 let exists=false,locked=false;const cells=[['','','',''],['','','','']],writes=[];
 const sh={getLastRow:()=>{let n=cells.length;while(n&&cells[n-1].every(v=>v===''))n--;return n;},getRange(r,c,n=1,m=1){return {getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>cells[r-1+i]?.[c-1+j]??'')),setValues(values){assert.ok(locked);writes.push({r,c,values});values.forEach((row,i)=>{if(!cells[r-1+i])cells[r-1+i]=Array(4).fill('');row.forEach((v,j)=>cells[r-1+i][c-1+j]=v);});}};}};
 const book={getSheetByName:()=>exists?sh:null,insertSheet(){exists=true;return sh;}};
 const ctx=vm.createContext({SpreadsheetApp:{openById:()=>book,flush(){}},PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'token'})},LockService:{getScriptLock:()=>({waitLock(){locked=true;},releaseLock(){locked=false;}})},Utilities:{formatDate:()=> '2026-10-03',DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()]},ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})}});
 vm.runInContext(fs.readFileSync('sheet-api.gs','utf8'),ctx);
 const post=b=>ctx.doPost({postData:{contents:JSON.stringify({token:'token',...b})}});
 return {ctx,cells,writes,post,createOccupied(){exists=true;cells[0][0]='Existing use';}};
}
test('専用シートは明示初期化のみ、未設定時と既存用途は書かずに止める',()=>{
 const g=gas();assert.equal(g.post({action:'fieldGoalsRead'}).ok,false);assert.equal(g.writes.length,0);g.createOccupied();assert.throws(()=>g.ctx.setupFieldGoalsSheet(),/既存データ/);assert.equal(g.writes.length,0);
});
test('GASは月別目標をCAS保存し、同じ要求再試行を重複させず競合を拒否する',()=>{
 const g=gas();g.ctx.setupFieldGoalsSheet();const initial=g.post({action:'fieldGoalsRead'}),state=initial.state;state.goals['2026-10']={prospects:3,metrics:{}};
 const b={action:'fieldGoalsWrite',requestId:'request-fixture-0001',version:initial.version,state};const r=g.post(b);assert.equal(r.ok,true);assert.notEqual(r.version,initial.version);const count=g.writes.length;assert.equal(g.post(b).ok,true);assert.equal(g.writes.length,count);
 assert.equal(g.post({...b,requestId:'request-fixture-0002'}).error,'conflict');assert.equal(g.writes.length,count);
 const changed=structuredClone(state);changed.goals['2026-10'].prospects=4;assert.equal(g.post({...b,state:changed}).error,'request mismatch');
 assert.equal(g.post({...b,requestId:'request-fixture-0003',version:null}).error,'version required');
 assert.equal(g.ctx.setupFieldGoalsSheet().alreadyReady,true);assert.equal(g.writes.length,count);
});
test('手動変更も内容ハッシュで検出し、無効な人物参照・認証・状態は保存しない',()=>{
 const g=gas();g.ctx.setupFieldGoalsSheet();const r=g.post({action:'fieldGoalsRead'});g.cells[1][0]=JSON.stringify({goals:{'2026-10':{prospects:5,metrics:{}}},persons:[],records:[]});const count=g.writes.length;
 assert.equal(g.post({action:'fieldGoalsWrite',requestId:'request-fixture-0001',version:r.version,state:r.state}).error,'conflict');assert.equal(g.writes.length,count);
 assert.equal(g.post({action:'fieldGoalsWrite',token:'wrong'}).error,'unauthorized');assert.equal(g.post({action:'fieldGoalsWrite',requestId:'request-fixture-0001',state:{}}).ok,false);assert.equal(g.writes.length,count);
});
test('GASに埋め込むモデルとAPIはソースと一致する',()=>{
 const gasSource=fs.readFileSync('sheet-api.gs','utf8').replace(/\r\n/g,'\n');for(const file of ['_assets/js/field-model.js','field_goals_api.gs'])assert.ok(gasSource.includes(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n').trim()));
});
test('新規人物は実在する一意な人脈のみ、登録後のID付替えや記録削除を拒否する',()=>{
 const g=gas();g.ctx.setupFieldGoalsSheet();let read=g.post({action:'fieldGoalsRead'});const state=read.state;state.persons.push({id:'person-fixture-0001',name:'Fixture',row:2});state.records.push({id:'record-fixture-0001',personId:'person-fixture-0001',kind:'introductions',status:'proposed',date:'2026-10-03',dueDate:'2026-10-03',purpose:'相談',outcomeConfirmed:false,newPersonForMonth:false});
 g.ctx.readContacts_=()=>[];let body={action:'fieldGoalsWrite',requestId:'request-fixture-0001',version:read.version,state};assert.equal(g.post(body).error,'person unknown');g.ctx.readContacts_=()=>[{'名前(あだ名)':'Fixture',_row:2}];assert.equal(g.post(body).ok,true);read=g.post({action:'fieldGoalsRead'});
 const removed=structuredClone(read.state);removed.records=[];assert.equal(g.post({...body,requestId:'request-fixture-0002',version:read.version,state:removed}).error,'record removed');
 const renamed=structuredClone(read.state);renamed.persons[0].name='Another';assert.equal(g.post({...body,requestId:'request-fixture-0003',version:read.version,state:renamed}).error,'identity changed');
});
test('週ミッションは開始前の基準を検証し、確定後の目標引下げ・削除を拒否する',()=>{
 const g=gas(),M=require('../_assets/js/field-model');g.ctx.setupFieldGoalsSheet();const initial=g.post({action:'fieldGoalsRead'}),state=M.createMission(initial.state,null,'2026-10','2026-10-03');const body={action:'fieldGoalsWrite',version:initial.version,requestId:'request-fixture-0001',state};assert.equal(g.post(body).ok,true);const read=g.post({action:'fieldGoalsRead'});
 const changed=structuredClone(read.state);changed.missions[0].targets.prospects=0;assert.equal(g.post({...body,requestId:'request-fixture-0002',version:read.version,state:changed}).error,'mission changed');const removed=structuredClone(read.state);removed.missions=[];assert.equal(g.post({...body,requestId:'request-fixture-0003',version:read.version,state:removed}).error,'mission changed');
});
test('GAS再生成は生成区間以外の前後の独自関数を保持する',()=>{
 const {embed}=require('../tools/embed_field_goals.cjs'),source='function before(){}\n// BEGIN GENERATED FIELD GOALS\nold\n// END GENERATED FIELD GOALS\nfunction after(){}\n';const result=embed(source,'new');assert.ok(result.startsWith('function before(){}\n'));assert.ok(result.endsWith('function after(){}\n'));assert.ok(result.includes('\nnew\n'));assert.throws(()=>embed('// BEGIN GENERATED FIELD GOALS\nmissing','new'));
});
test('大きな状態はセル上限を越えずに分割し、短縮更新・再読込・再試行で一致する',()=>{
 const g=gas();g.ctx.setupFieldGoalsSheet();const r=g.post({action:'fieldGoalsRead'}),state=r.state;state.persons.push({id:'person-fixture-0001',name:'Fixture',row:2});state.records=Array.from({length:80},(_,i)=>({id:'record-fixture-'+String(i).padStart(4,'0'),personId:'person-fixture-0001',kind:'individual',status:'proposed',date:'2026-10-03',dueDate:'2026-10-03',purpose:'x'.repeat(500),outcomeConfirmed:false,newPersonForMonth:false}));g.ctx.readContacts_=()=>[{'名前(あだ名)':'Fixture',_row:2}];const body={action:'fieldGoalsWrite',version:r.version,requestId:'request-fixture-0001',state};const saved=g.post(body);assert.equal(saved.ok,true);assert.ok(g.cells.length>3);assert.ok(g.cells.slice(1).every(row=>String(row[0]).length<=20000));assert.deepEqual(g.post({action:'fieldGoalsRead'}).state,saved.state);const count=g.writes.length;assert.equal(g.post(body).ok,true);assert.equal(g.writes.length,count);
 saved.state.records.forEach(x=>x.purpose='短い目的');const smaller=g.post({...body,version:saved.version,requestId:'request-fixture-0002',state:saved.state});assert.equal(smaller.ok,true);assert.equal(smaller.state.records.length,80);assert.ok(g.cells.slice(2).every(row=>row[0]===''));g.cells[2]=['','Owner note','',''];const before=g.writes.length;assert.equal(g.post({action:'fieldGoalsRead'}).ok,false);assert.equal(g.writes.length,before);
});
