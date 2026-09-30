const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {webcrypto}=require('node:crypto');

/* build.js のロック画面を最小のページに入れ、端末記憶の挙動だけを確かめる。 */
const {gateHtmlForTest,encryptForTest}=require('../build.js');

async function page(t,stored){
  const ENC=await encryptForTest({contacts:[],dailyTasks:{date:'2026-09-26',tasks:[]}},'secret');
  const html='<body>'+gateHtmlForTest(ENC,'2026-09-26')+'<script>var rendered=0;function renderEvents(){rendered++;}function setView(){}</script></body>';
  const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost',beforeParse(w){
    Object.defineProperty(w,'crypto',{value:webcrypto});
    w.TextEncoder=TextEncoder; w.TextDecoder=TextDecoder;
    if(stored) w.localStorage.setItem('garden-pass',JSON.stringify(stored));
  }});
  t.after(()=>dom.window.close());
  await new Promise(r=>setTimeout(r,300));
  return dom.window;
}
const hidden=w=>w.document.getElementById('lockgate').style.display==='none';

test('記憶が無ければロック画面のまま',async t=>{
  const w=await page(t,null);
  assert.equal(hidden(w),false);
});

test('期限内の記憶があれば自動でひらく',async t=>{
  const w=await page(t,{p:'secret',exp:Date.now()+60000});
  assert.equal(hidden(w),true);
});

test('期限切れの記憶は使わずに消す',async t=>{
  const w=await page(t,{p:'secret',exp:Date.now()-1});
  assert.equal(hidden(w),false);
  assert.equal(w.localStorage.getItem('garden-pass'),null);
});

test('記憶したパスフレーズで開けなければ記憶を消す',async t=>{
  const w=await page(t,{p:'wrong',exp:Date.now()+60000});
  assert.equal(hidden(w),false);
  assert.equal(w.localStorage.getItem('garden-pass'),null);
});

test('チェックして開いたときだけ記憶する',async t=>{
  const w=await page(t,null);
  w.document.getElementById('lockpass').value='secret';
  w.document.getElementById('lockremember').checked=true;
  w.document.getElementById('lockbtn').click();
  await new Promise(r=>setTimeout(r,300));
  assert.equal(hidden(w),true);
  assert.equal(JSON.parse(w.localStorage.getItem('garden-pass')).p,'secret');
});
