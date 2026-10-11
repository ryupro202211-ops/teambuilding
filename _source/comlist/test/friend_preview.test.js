const {test}=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
test('friend preview shows source fields safely and closes without changing data',t=>{
 const html=require('../app_sources').readApp('_assets/list.html').replace('<script src="data.js"></script>','<script>let DATA=[];</script>');
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost'});t.after(()=>dom.window.close());
 const w=dom.window,doc=w.document;
 const person={_row:2,'カテゴリー':'A','名前(あだ名)':'Fixture','出会い(どこで)':'読書会 <img src=x>','人物像':'一行目\n<script>bad()</script>','現在の年齢':30};
 w.eval('DATA='+JSON.stringify([person])+';');doc.body.className='view-garden';
 const button=doc.createElement('button');button.className='plant';button.setAttribute('data-k',w.plantKey(person));doc.getElementById('garden').appendChild(button);
 w.bindGardenFriendPreviews();
 const enter=new w.MouseEvent('pointerenter');Object.defineProperty(enter,'pointerType',{value:'mouse'});button.dispatchEvent(enter);
 const popup=doc.getElementById('garden-friend-preview');assert.equal(popup.hidden,false);assert.equal(popup.getAttribute('role'),'tooltip');
 assert.deepEqual([...popup.querySelectorAll('p')].map(p=>p.textContent),[person['出会い(どこで)'],person['人物像'],'30歳']);assert.equal(popup.querySelector('img,script'),null);
 assert.equal(button.getAttribute('aria-describedby'),popup.id);
 doc.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(popup.hidden,true);assert.equal(button.hasAttribute('aria-describedby'),false);
 w.eval("DATA[0]['人物像']='';DATA[0]['出会い(どこで)']='';DATA[0]['現在の年齢']='';");button.dispatchEvent(enter);assert.deepEqual([...popup.querySelectorAll('p')].map(p=>p.textContent),['未記入','未記入','未記入']);
 w.bindGardenFriendPreviews();assert.equal(popup.hidden,true);assert.equal(doc.querySelectorAll('#garden-friend-preview').length,1);
});
test('touch hold opens preview and consumes its click while taps and scrolling remain usable',async t=>{
 const html=require('../app_sources').readApp('_assets/list.html').replace('<script src="data.js"></script>','<script>let DATA=[];</script>');
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost'});t.after(()=>dom.window.close());
 const w=dom.window,doc=w.document,person={'カテゴリー':'A','名前(あだ名)':'Touch fixture','現在の年齢':'25歳'};
 w.eval('DATA='+JSON.stringify([person])+';');doc.body.className='view-garden';
 const button=doc.createElement('button');button.className='plant';button.setAttribute('data-k',w.plantKey(person));doc.getElementById('garden').appendChild(button);w.bindGardenFriendPreviews();
 let clicks=0;button.addEventListener('click',()=>clicks++);
 function pointer(type,x=0){const e=new w.MouseEvent(type,{bubbles:true,clientX:x});Object.defineProperties(e,{pointerType:{value:'touch'},pointerId:{value:1}});button.dispatchEvent(e);}
 const pause=()=>new Promise(r=>setTimeout(r,600)),popup=doc.getElementById('garden-friend-preview');
 pointer('pointerdown');pointer('pointerup');button.click();assert.equal(clicks,1);await pause();assert.equal(popup.hidden,true);
 pointer('pointerdown');pointer('pointermove',20);await pause();pointer('pointerup');assert.equal(popup.hidden,true);
 pointer('pointerdown');await pause();assert.equal(popup.hidden,false);assert.equal(popup.getAttribute('role'),'dialog');assert.equal(popup.querySelectorAll('p')[2].textContent,'25歳');
 pointer('pointerup');button.click();assert.equal(clicks,1);assert.equal(popup.hidden,false);
 popup.querySelector('.garden-preview-close').click();assert.equal(popup.hidden,true);
 pointer('pointerdown');pointer('pointerup');button.click();assert.equal(clicks,2);
 pointer('pointerdown');pointer('pointercancel');await pause();assert.equal(popup.hidden,true);
});
