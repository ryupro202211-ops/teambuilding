'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process'),{JSDOM}=require('jsdom');
test('予定詳細は暗号化後にだけ表示し、公開HTML・manifest・asset・ログへ漏らさない',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'calendar-private-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const secrets=['FIXTURE_CALENDAR_SECRET_TITLE','FIXTURE_CALENDAR_SECRET_PLACE','FIXTURE_CALENDAR_SECRET_DESCRIPTION'];
 const root=path.resolve(__dirname,'..'),args=[path.join(root,'build.js'),'--today','2026-10-04','--now','08:00','--master',path.join(root,'_assets/list.html'),'--pass','fixture-calendar-pass'];
 const advice='FIXTURE_PRIVATE_FRIEND_ADVICE';secrets.push(advice);
 const values={contacts:[{_row:2,'名前(あだ名)':'Fixture contact','カテゴリー':'A','仲間づくりアドバイス':advice}],events:[],calendar:[['2026-10-03T00:00','2026-10-04T23:59',{source:'primary',eventId:'fixture-private',title:secrets[0],location:secrets[1],description:secrets[2],allDay:false,detailsAvailable:true}]],tasks:{date:'2026-10-04',tasks:[],sources:{calendar:{ok:true},notion:{ok:true},gmail:{ok:true,checkedThreads:0,uniqueThreads:0}}}};
 const files={};for(const [name,value]of Object.entries(values)){const filename=path.join(temp,name+'.json'),bytes=Buffer.from(JSON.stringify(value));fs.writeFileSync(filename,bytes);args.push('--'+name,filename);if(name!=='tasks')files[name]={path:name+'.json',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};}
 fs.writeFileSync(path.join(temp,'snapshot_success.json'),JSON.stringify({version:1,result:'OK',source:'snapshot',generatedAt:new Date().toISOString(),files}));
 const out=path.join(temp,'comlist.html');args.push('--out',out);const result=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const bundle=require('../artifact_bundle').verifyBundle(out);for(const file of [out,...bundle.files.map(f=>path.join(temp,f.path)),path.join(temp,bundle.manifestPath)]){const content=fs.readFileSync(file);for(const secret of secrets)assert.equal(content.includes(secret),false);}
 for(const secret of secrets)assert.equal((result.stdout+result.stderr).includes(secret),false);
 const expanded=require('../app_sources').readApp(out),enc=JSON.parse(expanded.match(/const ENC = (\{[\s\S]*?\});/)[1]);
 const key=await crypto.webcrypto.subtle.importKey('raw',new TextEncoder().encode('fixture-calendar-pass'),'PBKDF2',false,['deriveKey']);
 const derived=await crypto.webcrypto.subtle.deriveKey({name:'PBKDF2',salt:Buffer.from(enc.salt,'base64'),iterations:250000,hash:'SHA-256'},key,{name:'AES-GCM',length:256},false,['decrypt']);
 const payload=JSON.parse(new TextDecoder().decode(await crypto.webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(enc.iv,'base64')},derived,Buffer.from(enc.ct,'base64'))));
 assert.equal(payload.dailyTasks.calendar[0].title,secrets[0]);assert.equal(payload.dailyTasks.calendar[0].description,secrets[2]);assert.match(payload.dailyTasks.calendar[0].time,/継続中/);
 assert.equal(payload.contacts[0]['仲間づくりアドバイス'],advice);
 const source=require('../app_sources').readApp(path.join(root,'_assets/list.html')).replace('<script src="data.js"></script>','<script>let DATA=[];let DAILY_TASKS=[];</script>');
 const dom=new JSDOM(source,{runScripts:'dangerously',url:'http://localhost'});t.after(()=>dom.window.close());dom.window.DAILY_TASKS=payload.dailyTasks;dom.window.renderTodayTasks();
 const schedule=dom.window.document.querySelector('[data-section="schedule"]');assert.ok(schedule);assert.match(schedule.textContent,/FIXTURE_CALENDAR_SECRET_TITLE/);assert.match(schedule.textContent,/FIXTURE_CALENDAR_SECRET_PLACE/);assert.equal(dom.window.document.querySelectorAll('.today-schedule-description').length,1);
});
test('予定詳細のHTMLを実行せず、空白の詳細は展開欄を作らない',t=>{
 const src=require('../app_sources').readApp(path.resolve(__dirname,'../_assets/list.html')).replace('<script src="data.js"></script>','<script>let DATA=[];let DAILY_TASKS=[];</script>');const dom=new JSDOM(src,{runScripts:'dangerously',url:'http://localhost'});t.after(()=>dom.window.close());
 dom.window.DAILY_TASKS={date:'2026-10-04',tasks:[],calendar:[{time:'08:00〜08:30',title:'<img onerror="window.__calendarXss=1">',location:'<script>bad()</script>',description:'   '}]};dom.window.renderTodayTasks();assert.equal(dom.window.__calendarXss,undefined);assert.equal(dom.window.document.querySelectorAll('.today-schedule-description').length,0);assert.equal(dom.window.document.querySelectorAll('.today-schedule-item img').length,0);
});
