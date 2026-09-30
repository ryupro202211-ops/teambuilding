'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
test('master separates styles and application responsibilities',()=>{
  const html=fs.readFileSync('_assets/list.html','utf8');
  assert.doesNotMatch(html,/<style>|function saveEdit/);
  for(const name of ['storage','api','contacts','events','tasks','analytics','app'])assert.ok(html.includes('js/'+name+'.js'));
});
test('bundle writes hashed dependencies and original image bytes before switching HTML',t=>{
  const {writeBundle,verifyBundle}=require('../artifact_bundle');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'comlist-bundle-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const out=path.join(dir,'comlist.html');
  const html='<html><head><style data-comlist="comlist">.x{background:url("brief-hero-morning-v2.jpg")}</style></head><body><script data-comlist="app">var fixture=1;</script></body></html>';
  writeBundle(out,html,path.resolve('_assets'));
  const published=fs.readFileSync(out,'utf8');assert.doesNotMatch(published,/base64|var fixture/);
  const manifest=verifyBundle(out);assert.equal(manifest.files.length,3);
  const image=manifest.files.find(f=>f.path.endsWith('.jpg'));assert.deepEqual(fs.readFileSync(path.join(dir,image.path)),fs.readFileSync('_assets/brief-hero-morning-v2.jpg'));
  const js=manifest.files.find(f=>f.path.endsWith('.js'));fs.writeFileSync(path.join(dir,js.path),'corrupted');assert.throws(()=>verifyBundle(out),/hash mismatch/);
});
test('dependency write failure preserves the previous HTML',t=>{
  const {writeBundle}=require('../artifact_bundle');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'comlist-failure-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const out=path.join(dir,'comlist.html');fs.writeFileSync(out,'previous');const failing=Object.create(fs);failing.writeFileSync=()=>{throw Error('disk full')};assert.throws(()=>writeBundle(out,'<script data-comlist="app">1</script>',path.resolve('_assets'),failing),/disk full/);assert.equal(fs.readFileSync(out,'utf8'),'previous');
});
