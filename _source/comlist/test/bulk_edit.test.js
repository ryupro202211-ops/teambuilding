const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

// シートの列（0始まり）。COLUMNS の並びと同じ。
const COL={cat:0,name:2,ad:3,ac:4,nd:5,nw:6,hist:7};
function P(cat,name,vals){
  const r=Array(26).fill('');r[COL.cat]=cat;r[COL.name]=name;
  Object.keys(vals||{}).forEach(function(k){r[COL[k]]=vals[k];});
  return r;
}

function api(people){
  const rows=[Array(26).fill('')].concat(people||[]);
  const notes={};let locked=false,lockCount=0;
  const row_=r=>{rows[r-1]=rows[r-1]||Array(26).fill('');return rows[r-1];};
  const sheet={
    getLastRow:()=>rows.length,getMaxRows:()=>200,insertRowsAfter(){},
    getRange(r,c,n=1,m=1){return {
      getValue:()=>(rows[r-1]||[])[c-1]||'',
      setValue:v=>{assert.ok(locked,'書き込みはロックの内側で行うこと');row_(r)[c-1]=v;},
      getDataValidation:()=>null,clearDataValidations(){},setDataValidation(){},
      getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>(rows[r-1+i]||[])[c-1+j]||'')),
      getNotes:()=>Array.from({length:n},(_,i)=>[notes[r+i]||'']),
      setNote:v=>{notes[r]=v;},
      setValues:vv=>{assert.ok(locked);vv.forEach((v,i)=>{row_(r+i);v.forEach((x,j)=>rows[r-1+i][c-1+j]=x);});}
    };}
  };
  const ctx=vm.createContext({
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>'test-token'})},
    SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush(){}},
    LockService:{getScriptLock:()=>({waitLock(){lockCount++;locked=true;},releaseLock(){locked=false;}})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})},
    Utilities:{formatDate:d=>d.getFullYear()+'/'+(d.getMonth()+1)+'/'+d.getDate()},
    Session:{getScriptTimeZone:()=>'Asia/Tokyo'}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../sheet-api.gs'),'utf8'),ctx);
  return {rows,lockCount:()=>lockCount,post:b=>ctx.doPost({postData:{contents:JSON.stringify(b)}})};
}
const bulk=(items,extra)=>Object.assign({token:'test-token',action:'bulk',requestId:'bulk-request-1234567890',items:items},extra||{});

test('bulk updates several different people in one request',()=>{
  const a=api([P('A','あいこ'),P('B','ぶんた'),P('C','ちさと')]);
  const r=a.post(bulk([
    {row:2,name:'あいこ',values:{'アクション日':'9/11'}},
    {row:4,name:'ちさと',values:{'アクション日':'9/11'}}
  ]));
  assert.equal(r.ok,true);
  assert.equal(a.rows[1][COL.ad],'9/11');
  assert.equal(a.rows[2][COL.ad],'','選ばれていない人は触らない');
  assert.equal(a.rows[3][COL.ad],'9/11');
});

test('rejects a batch that is empty, malformed or larger than 50 people',()=>{
  const a=api([P('A','あいこ')]);
  const one={row:2,name:'あいこ',values:{'アクション日':'9/11'}};
  [undefined,'x',[],new Array(51).fill(one)].forEach(function(items){
    const r=a.post(bulk(items));
    assert.equal(r.ok,false,'items='+JSON.stringify(items||null).slice(0,24));
  });
  assert.equal(a.rows[1][COL.ad],'','弾いたバッチは1件も書かない');
});

test('an item without a usable row is rejected instead of written somewhere',()=>{
  const a=api([P('A','あいこ'),P('B','ぶんた')]);
  const r=a.post(bulk([
    {row:2,name:'あいこ',values:{'アクション日':'9/11'}},
    {values:{'アクション日':'9/11'}},
    {row:1,name:'ぶんた',values:{'アクション日':'9/11'}}
  ]));
  assert.equal(r.results[1].ok,false);assert.equal(r.results[1].error,'invalid row');
  assert.equal(r.results[2].ok,false);assert.equal(r.results[2].error,'invalid row');
  assert.equal(a.rows[0][COL.ad],'','ヘッダー行を書き換えない');
  assert.equal(a.rows[1][COL.ad],'9/11','正しい要素は書かれる');
});

// ここから下は writeRecord_ から引き継ぐ契約。バッチ経由でも保たれることを固定する。

test('one unresolvable name never blocks the rest of the batch',()=>{
  const a=api([P('A','あいこ'),P('B','ぶんた'),P('C','ふたご'),P('D','ふたご')]);
  const r=a.post(bulk([
    {row:2,name:'あいこ',values:{'アクション日':'9/11'}},
    {row:3,name:'いない人',values:{'アクション日':'9/11'}},
    {row:3,name:'ふたご',values:{'アクション日':'9/11'}},
    {row:3,name:'ぶんた',values:{'アクション日':'9/11'}}
  ]));
  assert.equal(r.ok,true);
  assert.equal(r.results[1].error,'name not found');
  assert.equal(r.results[2].error,'ambiguous name','行がズレていて同名が複数なら、書かずに止める');
  assert.equal(a.rows[1][COL.ad],'9/11');
  assert.equal(a.rows[3][COL.ad],'','同名の人はどちらも書き換えない');
  assert.equal(a.rows[4][COL.ad],'');
  assert.equal(a.rows[2][COL.ad],'9/11');
});

test('a batch follows moved rows by name',()=>{
  const a=api([P('A','あいこ'),P('B','ぶんた')]);
  const r=a.post(bulk([{row:3,name:'あいこ',values:{'アクション日':'9/11'}}]));
  assert.equal(r.results[0].ok,true);assert.equal(r.results[0].row,2,'名前で正しい行に付け替える');
  assert.equal(a.rows[1][COL.ad],'9/11');assert.equal(a.rows[2][COL.ad],'');
});

test('a batch appends the previous plan to history only where the date really changed',()=>{
  const a=api([
    P('A','あいこ',{nd:'8/20',nw:'サシ',hist:'7/1 初回'}),
    P('B','ぶんた',{nd:'8/21',nw:'ランチ'}),
    P('C','ちさと',{nd:'',nw:''})
  ]);
  const r=a.post(bulk([
    {row:2,name:'あいこ',values:{'次会う日':'9/25','次会う日にする事':'サシ'}},
    {row:3,name:'ぶんた',values:{'次会う日':'8/21','次会う日にする事':'カフェ'}},
    {row:4,name:'ちさと',values:{'次会う日':'9/26','次会う日にする事':'初回'}}
  ]));
  assert.equal(r.ok,true);
  assert.equal(a.rows[1][COL.hist],'7/1 初回 8/20 サシ','日付が変わった人だけ積む');
  assert.equal(a.rows[2][COL.hist],'','する事だけの修正では積まない');
  assert.equal(a.rows[3][COL.hist],'','初めての予定では積まない');
});

test('resending the same batch does not append history twice',()=>{
  const a=api([P('A','あいこ',{nd:'8/20',nw:'サシ'})]);
  const items=[{row:2,name:'あいこ',values:{'次会う日':'9/25','次会う日にする事':'サシ'}}];
  a.post(bulk(items));const before=a.rows[1][COL.hist];
  a.post(bulk(items));
  assert.equal(a.rows[1][COL.hist],before,'2回目は次会う日が既に新しいので積まれない');
  assert.equal(before,'8/20 サシ');
});

test('the whole batch runs under a single lock',()=>{
  const a=api([P('A','あいこ'),P('B','ぶんた'),P('C','ちさと')]);
  a.post(bulk([
    {row:2,name:'あいこ',values:{'アクション日':'9/11'}},
    {row:3,name:'ぶんた',values:{'アクション日':'9/11'}},
    {row:4,name:'ちさと',values:{'アクション日':'9/11'}}
  ]));
  assert.equal(a.lockCount(),1,'1人1リクエストにするとロックの取り合いになるので、まとめて1回');
});

/* ===================== 画面（リストタブのまとめて編集） ===================== */

const {JSDOM}=require('jsdom');
const PEOPLE=[
  {_row:2,'カテゴリー':'A','名前(あだ名)':'あいこ','次会う日':'8/20','次会う日にする事':'サシ'},
  {_row:3,'カテゴリー':'B','名前(あだ名)':'ぶんた'},
  {_row:4,'カテゴリー':'C','名前(あだ名)':'ちさと'}
];
function ui(t,people){
  const src=require("../app_sources").readApp(path.join(__dirname,'../_assets/list.html'))
    .replace('<script src="data.js"></script>','<script>let DATA='+JSON.stringify(people||PEOPLE)+';</script>');
  const d=new JSDOM(src,{runScripts:'dangerously',url:'http://localhost'});
  const w=d.window;t.after(()=>w.close());
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.confirm=()=>true;
  w.localStorage.setItem('comunitylisttolevel9','test-token');
  w.setView('list');
  return w;
}

test('selection mode puts a checkbox on every listed person',t=>{
  const w=ui(t),doc=w.document;
  const start=doc.getElementById('bulk-start');
  assert.ok(start,'リストタブに「まとめて編集」がある');
  assert.equal(doc.querySelectorAll('.bulk-check').length,0,'ふだんチェックボックスは出さない');
  start.click();
  assert.equal(doc.querySelectorAll('.bulk-check').length,3);
  assert.equal(doc.getElementById('bulk-open').disabled,true,'0人では編集に進めない');
});

function openSheet(w,pick){
  const doc=w.document;
  doc.getElementById('bulk-start').click();
  doc.querySelectorAll('.bulk-check').forEach(function(c,i){
    if(pick&&pick.indexOf(i)<0) return;
    c.checked=true;c.dispatchEvent(new w.Event('change'));
  });
  doc.getElementById('bulk-open').click();
  return doc.getElementById('bulk-dialog');
}

test('the sheet opens with one row per picked person, prefilled from the sheet',t=>{
  const w=ui(t),doc=w.document;
  const dlg=openSheet(w,[0,2]);
  assert.ok(dlg&&dlg.open,'まとめて編集シートが開く');
  assert.equal(doc.querySelectorAll('.bulk-row').length,2,'選んだ人だけ並ぶ');
  assert.equal(doc.getElementById('br0-nd').value,'2026-08-20','いまの予定が入っている');
  assert.equal(doc.getElementById('br0-nw').value,'サシ');
  assert.equal(doc.getElementById('br1-nd').value,'','予定が無い人は空');
});

test('applying to all overwrites only the fields that were filled in',t=>{
  const w=ui(t),doc=w.document;
  openSheet(w);
  doc.getElementById('ba-ad').value='2026-09-11';
  doc.getElementById('bulk-apply').click();
  assert.equal(doc.getElementById('br0-ad').value,'2026-09-11');
  assert.equal(doc.getElementById('br1-ad').value,'2026-09-11');
  assert.equal(doc.getElementById('br2-ad').value,'2026-09-11');
  assert.equal(doc.getElementById('br0-nd').value,'2026-08-20','空欄だった項目は各行の値のまま');
  assert.equal(doc.getElementById('br0-nw').value,'サシ');
});

test('a value edited on one row survives a later apply-to-all of another field',t=>{
  const w=ui(t),doc=w.document;
  openSheet(w);
  doc.getElementById('br1-nw').value='ランチ';
  doc.getElementById('ba-ac').value='状況確認';
  doc.getElementById('bulk-apply').click();
  assert.equal(doc.getElementById('br1-nw').value,'ランチ','個別に直した値は消えない');
  assert.equal(doc.getElementById('br1-ac').value,'状況確認');
});

test('saving sends a single request carrying every picked person',async t=>{
  const w=ui(t),doc=w.document;
  openSheet(w);
  doc.getElementById('ba-ad').value='2026-09-11';
  doc.getElementById('bulk-apply').click();
  let calls=0,body=null;
  w.fetch=async(url,opts)=>{calls++;body=JSON.parse(opts.body);
    return {json:async()=>({ok:true,results:body.items.map(it=>({ok:true,row:it.row,name:it.name,updated:it.values}))})};};
  doc.getElementById('bulk-save').click();
  await new Promise(r=>setImmediate(r));
  assert.equal(calls,1,'人数ぶんのリクエストに割らない');
  assert.equal(body.action,'bulk');
  assert.equal(body.token,'test-token');
  assert.equal(body.items.length,3);
  assert.deepEqual(body.items[0],{row:2,name:'あいこ',
    values:{'アクション日':'9/11','アクション内容':'','次会う日':'8/20','次会う日にする事':'サシ'}});
});

test('a successful save updates the list and leaves selection mode',async t=>{
  const w=ui(t),doc=w.document;
  openSheet(w,[0]);
  doc.getElementById('br0-nd').value='2026-09-25';
  w.fetch=async(url,opts)=>{const b=JSON.parse(opts.body);
    return {json:async()=>({ok:true,results:[{ok:true,row:2,name:'あいこ',
      updated:Object.assign({},b.items[0].values,{'履歴':'8/20 サシ'})}]})};};
  doc.getElementById('bulk-save').click();
  await new Promise(r=>setImmediate(r));
  const a=JSON.parse(w.eval('JSON.stringify(DATA)'))[0];
  assert.equal(a['次会う日'],'9/25');
  assert.equal(a['履歴'],'8/20 サシ','サーバーが返した履歴も取り込む');
  assert.equal(a['アクション内容'],undefined,'空にした項目は消す');
  assert.equal(doc.getElementById('bulk-dialog').open,false);
  assert.equal(w.eval('BULK_MODE'),false,'選択モードから抜ける');
  assert.equal(doc.querySelectorAll('.bulk-check').length,0);
});

test('rows that failed stay open with their reason and resend alone',async t=>{
  const w=ui(t),doc=w.document;
  openSheet(w);
  doc.getElementById('br1-nw').value='ランチ';
  let body=null;
  w.fetch=async(url,opts)=>{body=JSON.parse(opts.body);
    return {json:async()=>({ok:true,results:body.items.map((it,i)=>i===1
      ?{ok:false,error:'name not found',message:'「ぶんた」がシートに見つかりません。'}
      :{ok:true,row:it.row,name:it.name,updated:it.values})})};};
  doc.getElementById('bulk-save').click();
  await new Promise(r=>setImmediate(r));
  assert.equal(doc.getElementById('bulk-dialog').open,true,'失敗が残っていれば閉じない');
  assert.equal(doc.querySelectorAll('.bulk-row').length,1,'成功した人は消え、失敗した人だけ残る');
  assert.match(doc.getElementById('bulk-message').textContent,/1 ?人/);
  assert.match(doc.getElementById('br0-msg').textContent,/見つかりません/);
  assert.equal(doc.getElementById('br0-nw').value,'ランチ','送った入力が消えない');
  assert.equal(doc.getElementById('bulk-save').disabled,false,'押し直せる');
  doc.getElementById('bulk-save').click();
  await new Promise(r=>setImmediate(r));
  assert.equal(body.items.length,1,'失敗した人だけ再送する');
  assert.equal(body.items[0].name,'ぶんた');
});

test('saving asks for confirmation and counts who gets a history entry',async t=>{
  const w=ui(t),doc=w.document;
  openSheet(w);
  doc.getElementById('br0-nd').value='2026-09-25';  // あいこ 8/20→9/25 は履歴が積まれる
  doc.getElementById('br1-nd').value='2026-09-26';  // ぶんた は予定なし → 積まれない
  let asked=null,calls=0;
  w.confirm=m=>{asked=m;return false;};
  w.fetch=async()=>{calls++;return {json:async()=>({ok:true,results:[]})};};
  doc.getElementById('bulk-save').click();
  assert.equal(calls,0,'断ったら送らない');
  assert.equal(doc.getElementById('bulk-save').disabled,false,'断ったら押し直せる');
  assert.match(asked,/3\s*人/,'更新する人数');
  assert.match(asked,/1\s*人/,'履歴が積まれる人数');
});

test('a row whose next date changes says so before saving',t=>{
  const w=ui(t),doc=w.document;
  openSheet(w,[0]);
  assert.equal(doc.getElementById('br0-warn').textContent,'','いまは変えていない');
  const nd=doc.getElementById('br0-nd');
  nd.value='2026-09-25';nd.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.match(doc.getElementById('br0-warn').textContent,/8\/20 サシ/,'いまの予定が履歴に積まれると伝える');
  nd.value='2026-08-20';nd.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(doc.getElementById('br0-warn').textContent,'','戻したら消える');
});

test('picking more than 50 people blocks the sheet',t=>{
  const many=Array.from({length:52},(_,i)=>({_row:i+2,'カテゴリー':'A','名前(あだ名)':'人'+i}));
  const w=ui(t,many),doc=w.document;
  doc.getElementById('bulk-start').click();
  doc.querySelectorAll('.bulk-check').forEach(c=>{c.checked=true;c.dispatchEvent(new w.Event('change'));});
  assert.equal(doc.getElementById('bulk-open').disabled,true,'GASの上限を超えた選択では進ませない');
  assert.match(doc.getElementById('bulk-count').textContent,/50/);
});

test('a wrong passphrase is not remembered',async t=>{
  const w=ui(t),doc=w.document;
  openSheet(w,[0]);
  w.fetch=async()=>({json:async()=>({ok:false,error:'unauthorized'})});
  doc.getElementById('bulk-save').click();
  await new Promise(r=>setImmediate(r));
  assert.equal(w.localStorage.getItem('comunitylisttolevel9'),null);
  assert.match(doc.getElementById('bulk-message').textContent,/合言葉/);
  assert.equal(doc.getElementById('bulk-save').disabled,false,'入れ直して押し直せる');
});

test('a category head picks or drops everyone in that category',t=>{
  const w=ui(t,[
    {_row:2,'カテゴリー':'A','名前(あだ名)':'あいこ'},
    {_row:3,'カテゴリー':'B','名前(あだ名)':'ぶんた'},
    {_row:4,'カテゴリー':'B','名前(あだ名)':'びより'},
    {_row:5,'カテゴリー':'C','名前(あだ名)':'ちさと'}
  ]),doc=w.document;
  doc.getElementById('bulk-start').click();
  const b=doc.querySelector('.cat.B .bulk-cat');
  assert.ok(b,'カテゴリ見出しに全選択がある');
  b.checked=true;b.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.match(doc.getElementById('bulk-count').textContent,/^2 人/);
  assert.equal(doc.querySelector('.cat.B').classList.contains('collapsed'),false,'見出しは畳まれない');
  b.checked=false;b.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.match(doc.getElementById('bulk-count').textContent,/^0 人/);
});

/* ===================== 画面（ガーデンタブのまとめて編集） ===================== */

test('the selection bar is not locked inside the list view',t=>{
  const w=ui(t),doc=w.document;
  assert.equal(doc.getElementById('bulk-bar').closest('#listwrap'),null,
    'リストの中に置くとガーデンでは親ごと隠れてしまう');
});

test('garden tiles select instead of opening the panel while picking',t=>{
  const w=ui(t),doc=w.document;
  w.setView('garden');
  doc.getElementById('bulk-start').click();
  doc.querySelector('.plant').click();
  assert.equal(w.eval('SELECTED'),null,'まとめて編集中は詳細パネルを開かない');
  assert.match(doc.getElementById('bulk-count').textContent,/^1 人/);
  assert.ok(doc.querySelector('.plant.picked'),'選んだ株が見てわかる');
  doc.querySelector('.plant.picked').click();
  assert.match(doc.getElementById('bulk-count').textContent,/^0 人/,'もう一度押すと外れる');
  assert.equal(doc.querySelector('.plant.picked'),null);
});

test('leaving selection mode gives the tile its panel back',t=>{
  const w=ui(t),doc=w.document;
  w.setView('garden');
  doc.getElementById('bulk-start').click();
  doc.getElementById('bulk-cancel').click();
  doc.querySelector('.plant').click();
  assert.ok(w.eval('SELECTED'),'選択をやめたら元どおりパネルが開く');
});

test('a garden group head picks everyone in that category',t=>{
  const w=ui(t,[
    {_row:2,'カテゴリー':'A','名前(あだ名)':'あいこ'},
    {_row:3,'カテゴリー':'B','名前(あだ名)':'ぶんた'},
    {_row:4,'カテゴリー':'B','名前(あだ名)':'びより'},
    {_row:5,'カテゴリー':'C','名前(あだ名)':'ちさと'}
  ]),doc=w.document;
  w.setView('garden');
  doc.getElementById('bulk-start').click();
  const b=doc.querySelector('.bulk-gcat[data-cat="B"]');
  assert.ok(b,'カテゴリ見出しに全選択がある');
  b.checked=true;b.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.match(doc.getElementById('bulk-count').textContent,/^2 人/);
  const b2=doc.querySelector('.bulk-gcat[data-cat="B"]');
  b2.checked=false;b2.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.match(doc.getElementById('bulk-count').textContent,/^0 人/);
});

test('a pick made in the garden is already there in the list',t=>{
  const w=ui(t),doc=w.document;
  w.setView('garden');
  doc.getElementById('bulk-start').click();
  doc.querySelector('.plant').click();
  w.setView('list');
  assert.equal(doc.querySelectorAll('.bulk-check:checked').length,1,'選び直さずに続けられる');
  assert.match(doc.getElementById('bulk-count').textContent,/^1 人/);
});

const ctrlClick=(w,el)=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true}));

test('ctrl-clicking a tile starts selection without the button',t=>{
  const w=ui(t),doc=w.document;
  w.setView('garden');
  assert.equal(doc.getElementById('bulk-bar').hidden,true,'まだ選択モードではない');
  ctrlClick(w,doc.querySelector('.plant'));
  assert.equal(w.eval('BULK_MODE'),true,'その場で選択モードに入る');
  assert.equal(doc.getElementById('bulk-bar').hidden,false);
  assert.match(doc.getElementById('bulk-count').textContent,/^1 人/);
  assert.equal(w.eval('SELECTED'),null,'詳細パネルは開かない');
  assert.ok(doc.querySelector('.plant.picked'));
});

test('a plain click still opens the panel when nothing is being picked',t=>{
  const w=ui(t),doc=w.document;
  w.setView('garden');
  doc.querySelector('.plant').click();
  assert.equal(w.eval('BULK_MODE'),false,'ふつうのクリックは選択モードに入らない');
  assert.ok(w.eval('SELECTED'));
});

test('ctrl-clicking while already picking toggles just once',t=>{
  const w=ui(t),doc=w.document;
  w.setView('garden');
  ctrlClick(w,doc.querySelector('.plant'));
  ctrlClick(w,doc.querySelector('.plant.picked'));
  assert.match(doc.getElementById('bulk-count').textContent,/^0 人/,'1回ぶんだけ効く');
  assert.equal(w.eval('BULK_MODE'),true,'選択モードからは抜けない');
});
