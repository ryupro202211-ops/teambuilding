// Recover the existing content locally and rebuild without refreshing task data.
const fs = require('node:fs');
const {webcrypto: crypto} = require('node:crypto');
const {spawnSync} = require('node:child_process');
(async () => {
  const original = fs.readFileSync('morningblief.html', 'utf8');
  const E = JSON.parse(original.match(/const ENC=(\{[^\n]+\});/)[1]);
  const bk = await crypto.subtle.importKey('raw', Buffer.from('levelup'), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({name:'PBKDF2',salt:Buffer.from(E.salt,'base64'),iterations:E.it,hash:'SHA-256'},bk,{name:'AES-GCM',length:256},false,['decrypt']);
  const body = Buffer.from(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(E.iv,'base64')},key,Buffer.from(E.ct,'base64'))).toString();
  const sections = body.match(/<div class="wrap">\s*([\s\S]*?)<div class="foot">/)[1].trim();
  const today = original.match(/const SKEY='brief-([^']+)'/)[1];
  const dayjp = body.match(/<h1>([^<]+)/)[1];
  const quote = body.match(/<div class="q">([\s\S]*?)<\/div>/)[1];
  const source = body.match(/<div class="s">([\s\S]*?)<\/div>/)[1];
  fs.mkdirSync('_work', {recursive:true});
  fs.copyFileSync('morningblief.html','_work/brief-before-icons.encrypted.html');
  const file = '_work/brief-restyle-sections.html';
  fs.writeFileSync(file, sections);
  try {
    const result = spawnSync(process.execPath, ['build_brief.js','--today',today,'--dayjp',dayjp,'--quote',quote,'--source',source,'--self',String((sections.match(/data-id="self-/g)||[]).length),'--mem',String((sections.match(/data-id="mem-/g)||[]).length),'--sections',file,'--out','morningblief.html'],{encoding:'utf8'});
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    if(result.status !== 0) throw new Error('Build failed');
  } finally { fs.unlinkSync(file); }
})().catch(e=>{console.error(e);process.exitCode=1;});
