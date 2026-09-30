'use strict';
// Real Chromium, synthetic data and a local API only. No production records are touched.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const {readApp}=require('../app_sources'),{writeBundle,verifyBundle}=require('../artifact_bundle');
const {gateHtmlForTest,encryptForTest}=require('../build');
const runtime=process.env.CODEX_NODE_MODULES||'C:/Users/ryupr/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(path.join(runtime,'playwright'));
async function main(){
  const day=new Date();day.setDate(day.getDate()+1);const date=day.getFullYear()+'-'+String(day.getMonth()+1).padStart(2,'0')+'-'+String(day.getDate()).padStart(2,'0');
  let contacts=[{_row:2,'カテゴリー':'A','名前(あだ名)':'ブラウザテスト','仕事(O)':'初期プロフィール','アクション日':date}];
  let events=[{id:'evt_browserfixture00000001',status:'公開',date,startTime:'19:00',endTime:'20:00',title:'テストイベント',version:1}];
  const daily={date,dayLabel:date,tasks:[{id:'notion:fixture',type:'notion',title:'テストタスク',section:'today',due:date,overdueDays:0}],sources:{}};
  const enc=await encryptForTest({contacts,dailyTasks:daily},'fixture-pass');
  const target=path.join(root,'_preview','browser-e2e');fs.mkdirSync(target,{recursive:true});
  function prepare(source){return source.replace(/const EVENTS = \[[\s\S]*?\];/,'const EVENTS = '+JSON.stringify(events)+';').replace(/const FREE_SLOTS = \[[\s\S]*?\];/,'const FREE_SLOTS = [];').replace(/const API_URL = "[^"]+"/,'const API_URL = "/api"').replace('<script src="data.js"></script>',gateHtmlForTest(enc,date)).replace(/renderEvents\(\);\s*\nsetView\("today"\);/,'/* unlock starts rendering */');}
  writeBundle(path.join(target,'comlist.html'),prepare(readApp(path.join(root,'_assets/list.html'))),path.join(root,'_assets'));
  const baselinePath=path.join(root,'_preview/list.before-refactor.html');
  let baseline=prepare(fs.existsSync(baselinePath)?fs.readFileSync(baselinePath,'utf8'):readApp(path.join(root,'_assets/list.html')));
  for(const file of fs.readdirSync(path.join(root,'_assets')).filter(f=>/^(?:garden-icons-v1|menu-icons-v1|brief-icons-v2|brief-hero-morning-v2|victory-icons-v1|victory-banner-v1)\.(png|jpg)$/.test(f)))baseline=baseline.replaceAll('url("'+file+'")','url("data:image/'+(file.endsWith('.png')?'png':'jpeg')+';base64,'+fs.readFileSync(path.join(root,'_assets',file)).toString('base64')+'")');
  fs.writeFileSync(path.join(target,'baseline.html'),baseline);
  let offline=false,done={};
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/api'){
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);let result;
      if(body.action==='read')result=offline?{ok:false,error:'offline'}:body.what==='contacts'?{ok:true,records:contacts}:{ok:true,events};
      else if(body.action==='taskState'){if(offline)result={ok:false};else{if(body.op==='set'){if(body.done)done[body.id]=true;else delete done[body.id];}result={ok:true,date:body.date,done};}}
      else if(body.action==='create'){const record={_row:contacts.length+2,...body.values};contacts.push(record);result={ok:true,record};}
      else if(body.action==='eventDelete'){events=events.filter(e=>e.id!==body.id);result={ok:true,deletedId:body.id};}
      else {Object.assign(contacts.find(c=>c._row===body.row),body.values);result={ok:true,row:body.row,updated:body.values};}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
    }
    try{const url=new URL(req.url,'http://local'),rel=url.pathname==='/'?'comlist.html':decodeURIComponent(url.pathname.slice(1));const file=path.resolve(target,rel);if(!file.startsWith(target+path.sep))throw Error('path');const bytes=fs.readFileSync(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.jpg')?'image/jpeg':'text/html');res.end(bytes);}catch(error){res.statusCode=404;res.end('not found');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  const executable=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',chromium.executablePath()].find(p=>fs.existsSync(p));
  if(!executable)throw Error('Chromium executable unavailable');
  const browser=await chromium.launch({headless:true,executablePath:executable});
  const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(()=>localStorage.setItem('comunitylisttolevel9','fixture-token'));const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('https://**/*',route=>route.abort());
  async function unlock(){await page.locator('#lockpass').fill('fixture-pass');await page.locator('#lockbtn').click();await page.waitForFunction(()=>document.getElementById('lockgate').style.display==='none');}
  async function loaded(){await page.goto(base+'/comlist.html');await unlock();}
  const measurements={};
  try{
    await page.goto(base+'/baseline.html');await unlock();await page.mouse.move(1270,0);await page.waitForTimeout(250);await page.screenshot({path:path.join(target,'before.png'),fullPage:true});measurements.before=await page.evaluate(()=>({loadMs:performance.getEntriesByType('navigation')[0].loadEventEnd,dom:document.querySelectorAll('*').length}));
    await loaded();await page.mouse.move(1270,0);await page.waitForTimeout(250);await page.screenshot({path:path.join(target,'after.png'),fullPage:true});measurements.after=await page.evaluate(()=>({loadMs:performance.getEntriesByType('navigation')[0].loadEventEnd,dom:document.querySelectorAll('*').length}));
    await page.locator('[data-view="garden"]').click();await page.locator('.plant').first().click();await page.locator('#ge-open').click();await page.locator('#ge-ad').fill(date);await page.locator('#ge-nw').fill('保存後も残る予定');await page.locator('#ge-save').click();await page.waitForFunction(()=>!PANEL_EDIT);await page.waitForFunction(()=>!!localStorage.getItem('comlist-cache:v1:/comlist.html'));
    offline=true;await page.reload();await unlock();await page.locator('[data-view="garden"]').click();assert.match(await page.locator('#app').textContent(),/保存後も残る予定/);
    // Close the page entirely and open another page in the same browser context.
    const stored=await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])));assert.ok(!JSON.stringify(stored).includes('保存後も残る予定'));
    offline=false;await page.locator('.gd-add[data-category="B"]').click();await page.locator('#person-name').fill('追加テスト');await page.locator('#person-save').click();await page.waitForFunction(()=>!CREATE_BUSY);assert.equal(await page.locator('.plant').count(),2);
    offline=true;await page.reload();await unlock();await page.locator('[data-view="garden"]').click();assert.equal(await page.locator('.plant').count(),2);
    await page.locator('#search').fill('追加テスト');assert.equal(await page.locator('.plant').count(),1);await page.locator('#search').fill('');await page.evaluate(()=>setView('list'));await page.locator('#sort').selectOption('action');assert.equal(await page.locator('#app .card').count(),2);
    offline=false;await page.locator('[data-view="events"]').click();await page.waitForFunction(()=>EVENTS_FRESH);page.once('dialog',d=>d.accept());await page.locator('[data-event-delete]').click();await page.waitForFunction(()=>!EVENT_DELETE_BUSY);assert.equal(await page.locator('.ev').count(),0);
    offline=true;await page.reload();await unlock();await page.locator('[data-view="events"]').click();assert.equal(await page.locator('.ev').count(),0);
    await page.locator('[data-view="today"]').click();await page.locator('.today-task-check').check();await page.reload();await unlock();assert.equal(await page.locator('.today-task-check').isChecked(),true);await page.locator('.today-task-check').uncheck();await page.reload();await unlock();assert.equal(await page.locator('.today-task-check').isChecked(),false);
    await page.close();const reopened=await context.newPage();await reopened.goto(base+'/comlist.html');await reopened.locator('#lockpass').fill('fixture-pass');await reopened.locator('#lockbtn').click();await reopened.waitForFunction(()=>document.getElementById('lockgate').style.display==='none');assert.equal(await reopened.locator('.today-task-check').isChecked(),false);
    await reopened.evaluate(()=>localStorage.setItem('comlist-cache:v1:/comlist.html','{broken'));await reopened.reload();await reopened.locator('#lockpass').fill('fixture-pass');await reopened.locator('#lockbtn').click();await reopened.waitForFunction(()=>document.getElementById('lockgate').style.display==='none');assert.ok(await reopened.locator('#today-dashboard').textContent());
    await reopened.setViewportSize({width:390,height:844});await reopened.locator('[data-view="analytics"]').click();assert.ok(await reopened.locator('#analyticswrap').textContent());await reopened.screenshot({path:path.join(target,'mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);const manifest=verifyBundle(path.join(target,'comlist.html'));measurements.htmlBytes=fs.statSync(path.join(target,'comlist.html')).size;measurements.totalBytes=measurements.htmlBytes+manifest.files.reduce((a,f)=>a+f.bytes,0);measurements.tests=['初回表示','予定編集と保存','通信失敗後のリロード復元','追加と復元','検索・並び替え','イベント削除と復元','完了チェック・解除の復元','閉じて再開','破損からの復帰','スマホ分析表示'];fs.writeFileSync(path.join(target,'result.json'),JSON.stringify(measurements,null,2)+'\n');console.log('BROWSER_E2E: OK '+JSON.stringify(measurements));
  }finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
