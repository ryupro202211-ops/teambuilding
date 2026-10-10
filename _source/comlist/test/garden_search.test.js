const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {JSDOM}=require('jsdom');

function setup(t){
  const records=[{_row:2,'カテゴリー':'A','名前(あだ名)':'Alpha'},{_row:3,'カテゴリー':'B','名前(あだ名)':'Beta'}];
  const html=require('../app_sources').readApp(path.join(__dirname,'../_assets/list.html')).replace('<script src="data.js"></script>','<script>let DATA='+JSON.stringify(records)+';</script>');
  const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost'});
  t.after(()=>dom.window.close());
  dom.window.setView('garden');
  dom.window.document.querySelector('.plant').click();
  return dom.window;
}
function search(w,value){
  const input=w.document.getElementById('search');
  input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));
}

test('typing hides the previous detail and selecting a search result opens its detail',t=>{
  const w=setup(t),doc=w.document,panel=doc.getElementById('gdpanel');
  assert.equal(panel.hidden,false);
  search(w,'Beta');
  assert.equal(panel.hidden,true);
  assert.equal(doc.querySelectorAll('.plant').length,1);
  assert.equal(doc.querySelector('.plant-name').textContent,'Beta');
  w.render();assert.equal(panel.hidden,true);
  doc.querySelector('.plant').click();
  assert.equal(panel.hidden,false);
  assert.equal(doc.querySelector('.gd-panel-name').textContent,'Beta');
  search(w,'missing');assert.equal(panel.hidden,true);
  assert.equal(doc.querySelectorAll('.plant').length,0);
  search(w,'');assert.equal(panel.hidden,false);
  assert.equal(doc.querySelectorAll('.plant').length,2);
});

test('searching and clearing preserves an open editor draft',t=>{
  const w=setup(t),doc=w.document;
  doc.getElementById('pe-open').click();
  const input=doc.querySelector('#gdpanel input');
  input.value='Unsaved draft';
  search(w,'Beta');
  assert.equal(doc.getElementById('gdpanel').hidden,true);
  search(w,'');
  assert.equal(doc.getElementById('gdpanel').hidden,false);
  assert.equal(doc.querySelector('#gdpanel input'),input);
  assert.equal(input.value,'Unsaved draft');
});
