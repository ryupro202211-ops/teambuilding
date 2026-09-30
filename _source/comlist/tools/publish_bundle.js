'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {verifyBundle}=require('../artifact_bundle'),{localFile}=require('../app_sources');
function publishBundle(source,target){
  source=path.resolve(source);target=path.resolve(target);
  if(source===target||target.startsWith(source+path.sep+'_deploy'))throw Error('invalid publish target');
  const deploy=path.join(source,'_deploy'),manifest=verifyBundle(path.join(deploy,'comlist.html'));
  function copy(base,ref,to){const src=localFile(base,ref),dst=localFile(to,ref);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);}
  for(const file of [...manifest.files.map(f=>f.path),manifest.manifestPath])copy(deploy,file,target);
  // A positive allowlist prevents contacts, OAuth, tokens and generated personal notes being copied.
  const sourceTarget=path.join(target,'_source/comlist');
  const rootFiles=['.gitignore','analysis_history.js','app_sources.js','append_quote.js','artifact_bundle.js','brief_icons.js','build_brief.js','build.js','compose_daily_tasks.js','daily_tasks.js','event_records.js','fetch_gmail_tasks.js','fetch_materials.js','garden_paths.js','gmail_tasks.js','material_snapshot.js','migrate_events.js','parse_events.js','resolved_tasks.js','package.json','package-lock.json','sheet-api.gs'];
  for(const ref of rootFiles)if(fs.existsSync(path.join(source,ref)))copy(source,ref,sourceTarget);
  function collect(dir){if(!fs.existsSync(path.join(source,dir)))return;for(const entry of fs.readdirSync(path.join(source,dir),{withFileTypes:true})){const ref=dir+'/'+entry.name;if(entry.isSymbolicLink())throw Error('source symlink refused');if(entry.isDirectory())collect(ref);else if(/\.(?:js|cjs|css|html|json|md|png|jpg|ps1)$/.test(entry.name))copy(source,ref,sourceTarget);}}
  for(const dir of ['_assets/js','_assets/css','test','tools'])collect(dir);
  if(fs.existsSync(path.join(source,'tools/comlist-tests.yml')))copy(source,'tools/comlist-tests.yml',sourceTarget);
  if(fs.existsSync(path.join(source,'tools/comlist-tests.yml')))copy(path.join(source,'tools'),'comlist-tests.yml',path.join(target,'.github/workflows'));
  if(fs.existsSync(path.join(source,'_assets/list.html')))copy(source,'_assets/list.html',sourceTarget);
  for(const image of ['garden-icons-v1.png','menu-icons-v1.png','brief-icons-v2.png','brief-hero-morning-v2.jpg','victory-icons-v1.png','victory-banner-v1.jpg'])if(fs.existsSync(path.join(source,'_assets',image)))copy(source,'_assets/'+image,sourceTarget);
  for(const doc of ['docs/comlist-refactor-analysis.md','docs/comlist-refactor-report.md'])if(fs.existsSync(path.join(source,doc)))copy(source,doc,sourceTarget);
  fs.mkdirSync(sourceTarget,{recursive:true});fs.writeFileSync(path.join(sourceTarget,'README.md'),'# Comlist source\n\nThe public entry point is `/comlist.html`. Edit `_assets/list.html`, `_assets/css/`, and `_assets/js/`; build.js generates the hashed deployment bundle. Google Sheets remains authoritative; private material and credentials are not included.\n\nRun `npm ci` then `npm test`. Real-browser fixture tests: `node tools/test_browser.cjs` with `CODEX_NODE_MODULES` pointing to a runtime containing Playwright.\n');
  // Switch the HTML last; all referenced immutable dependencies already exist.
  const destination=path.join(target,'comlist.html'),temporary=destination+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
  try{fs.copyFileSync(path.join(deploy,'comlist.html'),temporary);fs.renameSync(temporary,destination);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  verifyBundle(destination);
  return manifest;
}
if(require.main===module){try{const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];if(args.includes('--verify')){verifyBundle(path.resolve(arg('--verify')));console.log('BUNDLE_VERIFY: OK');}else{if(!args.includes('--source')||!args.includes('--target'))throw Error('--source and --target required');publishBundle(arg('--source'),arg('--target'));console.log('BUNDLE_COPY: OK');}}catch(error){console.error('BUNDLE_ERROR: '+error.message);process.exitCode=1;}}
module.exports={publishBundle};
