const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
test('all category tiles render the assigned image while retaining status and selection',t=>{
  const records='ABCD'.split('').map((cat,i)=>({_row:i+2,'カテゴリー':cat,'名前(あだ名)':'Demo '+cat,'アクション日':'2020/1/1'}));
  const html=require("../app_sources").readApp(path.join(__dirname,'../_assets/list.html')).replace('<script src="data.js"></script>','<script>let DATA='+JSON.stringify(records)+';</script>');
  const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost'});t.after(()=>dom.window.close());
  const doc=dom.window.document;
  dom.window.setView('garden');
  for(const cat of 'ABCD')assert.ok(doc.querySelector('.plant .garden-icon.icon-'+cat));
  assert.equal(doc.querySelectorAll('.plant.st-dying').length,4);
  doc.querySelector('.plant').click();assert.ok(doc.querySelector('.gd-big .garden-icon'));
});
