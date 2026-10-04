'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),{JSDOM}=require('jsdom');
function gas(header='仲間づくりアドバイス'){
 const writes=[],ranges=[],rows=[Array(45).fill(''),Array(45).fill(''),Array(45).fill('')];rows[0][26]=header;rows[1][0]='A';rows[1][2]='Fixture person';rows[1][25]='メモ原本';rows[1][26]='本人の希望：まだ未確認\n次に聞く質問：どんな生活を望みますか';rows[2][0]='B';rows[2][2]='Fixture person 2';
 const sh={getLastRow:()=>rows.length,getMaxColumns:()=>45,getRange(r,c,n=1,m=1){ranges.push({r,c,n,m});return {getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>rows[r-1+i]?.[c-1+j]??'')),setValues:v=>writes.push({r,c,v})};}};
 const ctx=vm.createContext({SpreadsheetApp:{openById:()=>({getSheetByName:()=>sh})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()]}});vm.runInContext(fs.readFileSync(path.join(__dirname,'../sheet-api.gs'),'utf8'),ctx);return {ctx,rows,writes,ranges};
}
test('AAの見出し一致時だけ人物へ助言を取込み、Zメモ・編集列・CASを変えず書込まない',()=>{
 const g=gas(),out=g.ctx.readContacts_();assert.equal(out[0]['メモ'],'メモ原本');assert.match(out[0]['仲間づくりアドバイス'],/本人の希望/);assert.equal(out[1]['仲間づくりアドバイス'],undefined);const version=out[0]._version;g.rows[1][26]='別担当が更新した助言';assert.equal(g.ctx.readContacts_()[0]._version,version);assert.equal(g.ctx.COLUMNS.length,26);assert.equal(g.ctx.EDITABLE['仲間づくりアドバイス'],undefined);assert.equal(g.writes.length,0);assert.ok(g.ranges.some(r=>r.c===27&&r.r===2&&r.m===1));
});
test('AAが別用途・空見出しなら既存内容を助言として誤取込みしない',()=>{for(const header of ['','既存の別用途']){const g=gas(header);assert.equal(g.ctx.readContacts_()[0]['仲間づくりアドバイス'],undefined);assert.equal(g.writes.length,0);assert.equal(g.ranges.some(r=>r.c===27&&r.r===2),false);}});
test('人物パネルに一度だけ読取り専用の助言を表示し、HTMLを実行せず空欄は省く',t=>{
 const source=require('../app_sources').readApp(path.resolve(__dirname,'../_assets/list.html')).replace('<script src="data.js"></script>','<script>let DATA=[];let DAILY_TASKS=[];</script>');const dom=new JSDOM(source,{runScripts:'dangerously',url:'http://localhost'});t.after(()=>dom.window.close());
 const person={_row:2,'カテゴリー':'A','名前(あだ名)':'Fixture person','仲間づくりアドバイス':'本人の希望：未確認\n次に聞く質問：<img src=x onerror="window.__adviceXss=1">'};dom.window.eval('DATA='+JSON.stringify([person])+';SELECTED=plantKey(DATA[0]);renderPanel();');
 const panel=dom.window.document.getElementById('gdpanel');assert.equal(panel.querySelectorAll('.friend-advice').length,1);assert.match(panel.textContent,/本人の希望：未確認/);assert.equal(panel.querySelectorAll('.friend-advice img').length,0);assert.equal(panel.querySelectorAll('.friend-advice input,.friend-advice textarea').length,0);assert.equal(dom.window.__adviceXss,undefined);assert.equal(dom.window.friendAdviceHTML({}),'');
});
