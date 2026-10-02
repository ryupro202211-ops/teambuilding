'use strict';
// Rebuild presentation from source without reading plaintext materials or a passphrase.
const fs=require('node:fs'),path=require('node:path');
const {readApp}=require('../app_sources'),{verifyBundle,writeBundle}=require('../artifact_bundle');
function rebuildUI({from,out,master=path.resolve(__dirname,'../_assets/list.html')}){
  from=path.resolve(from);out=path.resolve(out);master=path.resolve(master);
  verifyBundle(from);
  const previous=readApp(from),gate=previous.match(/(<div id="lockgate"[\s\S]*?)<script data-comlist="payload">([\s\S]*?)<\/script>\s*<script data-comlist="lock">([\s\S]*?)<\/script>/);
  if(!gate)throw Error('Existing encrypted gate is missing');
  let html=readApp(master).replace('<script src="data.js"></script>',gate[1]+'<script data-comlist="lock">\n'+gate[2].trim()+'\n'+gate[3].trim()+'\n</script>');
  for(const name of ['EVENTS','FREE_SLOTS']){
    const pattern=new RegExp('const '+name+' = (\\[[\\s\\S]*?\\]);'),value=previous.match(pattern);
    if(!value||!pattern.test(html))throw Error('Generated '+name+' is missing');
    html=html.replace(pattern,()=>value[0]);
  }
  const trail=/renderEvents\(\);\s*\nsetView\("today"\);/;
  if(!trail.test(html))throw Error('Unlock rendering marker is missing');
  html=html.replace(trail,'/* 描画は復号後に行う */');
  html=html.replace(/\r\n/g,'\n');
  const manifest=writeBundle(out,html,path.dirname(master));
  const after=readApp(out),enc=s=>s.match(/const ENC = (\{[\s\S]*?\});/)[1];
  if(enc(previous)!==enc(after))throw Error('Encrypted payload changed');
  return manifest;
}
if(require.main===module){
  try{const args=process.argv.slice(2),arg=n=>args[args.indexOf(n)+1];if(!args.includes('--from')||!args.includes('--out'))throw Error('--from and --out are required');rebuildUI({from:arg('--from'),out:arg('--out'),master:args.includes('--master')?arg('--master'):undefined});console.log('UI_REBUILD: OK (ciphertext preserved)');}catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={rebuildUI};
