const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
test('each navigation item has a leading decorative icon and still switches views',t=>{
  const src=require("../app_sources").readApp(path.join(__dirname,'../_assets/list.html')).replace('<script src="data.js"></script>','<script>let DATA=[];</script>');
  const dom=new JSDOM(src,{runScripts:'dangerously',url:'http://localhost'});t.after(()=>dom.window.close());
  const doc=dom.window.document;
  assert.equal(doc.body.className,'view-today');
  assert.ok(doc.querySelector('[data-view="today"]').classList.contains('active'));
  assert.equal(doc.querySelector('[data-view="list"]'),null);
  for(const view of ['today','garden','calendar','events']){
    doc.documentElement.scrollTop=300;
    doc.body.scrollTop=300;
    const button=doc.querySelector('[data-view="'+view+'"]');
    assert.ok(button.firstElementChild?.classList.contains('menu-icon'));
    assert.equal(button.firstElementChild.getAttribute('aria-hidden'),'true');
    button.firstElementChild.click();
    assert.ok(button.classList.contains('active'));
    assert.equal(doc.body.className,'view-'+view);
    if(view==='today'){
      assert.equal(doc.documentElement.scrollTop,0);
      assert.equal(doc.body.scrollTop,0);
      assert.equal(dom.window.getComputedStyle(doc.querySelector('#todaywrap')).display,'block');
    }
    if(view==='calendar'){
      const frame=doc.querySelector('#calframe');
      assert.equal(frame.tagName,'IFRAME');
      assert.match(frame.getAttribute('src'),/^https:\/\/calendar\.google\.com\/calendar\/embed\?/);
    }
  }
});

test('all 25 brief sprite cells have a 5 by 5 position and escaped accessible markup',t=>{
  const src=require("../app_sources").readApp(path.join(__dirname,'../_assets/list.html')).replace('<script src="data.js"></script>','<script>let DATA=[];</script>');
  const dom=new JSDOM(src,{runScripts:'dangerously',url:'http://localhost'});t.after(()=>dom.window.close());
  const w=dom.window;
  const holder=w.document.createElement('div');
  w.document.body.append(holder);
  for(let i=0;i<25;i++){
    holder.innerHTML=w.briefIcon(i,'<画像 "ラベル">');
    const icon=holder.firstElementChild;
    assert.equal(icon.getAttribute('aria-label'),'<画像 "ラベル">');
    assert.equal(icon.getAttribute('role'),'img');
    assert.equal(holder.children.length,1);
    assert.equal(w.getComputedStyle(icon).backgroundPosition,`${i%5*25}% ${Math.floor(i/5)*25}%`);
    assert.equal(w.getComputedStyle(icon).backgroundSize,'500% 500%');
  }
  assert.match(src,/renderEvents\(\);\s*\nsetView\("today"\);/);
});
