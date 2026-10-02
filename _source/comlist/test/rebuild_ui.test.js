'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('UI rebuild uses current master and bundle generator while preserving ciphertext and generated events without decrypting',async t=>{
  const {gateHtmlForTest,encryptForTest}=require('../build'),{writeBundle,verifyBundle}=require('../artifact_bundle');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rebuild-ui-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const from=path.join(root,'original/comlist.html'),out=path.join(root,'result/comlist.html');fs.mkdirSync(path.dirname(from));fs.mkdirSync(path.dirname(out));
  const enc=await encryptForTest({contacts:[{_row:2,'名前(あだ名)':'PRIVATE-FIXTURE','カテゴリー':'A'}],dailyTasks:{date:'2026-10-02',tasks:[]}},'unknown-pass');
  const master=path.resolve('_assets/list.html');let source=require('../app_sources').readApp(master).replace('<script src="data.js"></script>',gateHtmlForTest(enc,'2026-10-02')).replace(/renderEvents\(\);\s*\nsetView\("today"\);/,'/* locked */');
  source=source.replace(/const EVENTS = \[[\s\S]*?\];/,'const EVENTS = [{id:"evt_fixture000000000000000",title:"Fixture event"}];');writeBundle(from,source,path.resolve('_assets'));
  require('../tools/rebuild_ui.cjs').rebuildUI({from,out,master});const expanded=require('../app_sources').readApp(out);
  assert.deepEqual(JSON.parse(expanded.match(/const ENC = (\{[\s\S]*?\});/)[1]),enc);assert.match(expanded,/Fixture event/);assert.doesNotMatch(expanded,/PRIVATE-FIXTURE/);assert.match(expanded,/contactAction/);assert.equal((expanded.match(/id="task-sync-status"/g)||[]).length,1);assert.doesNotMatch(fs.readFileSync(out,'utf8'),/\r/);verifyBundle(out);
});
