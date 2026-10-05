'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {localFile}=require('./app_sources');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function writeBundle(out,expanded,assetRoot,io=fs){
  const root=path.dirname(out),files=new Map();
  function asset(name,ext,bytes){
    if((ext==='js'||ext==='css')&&name!=='payload')bytes=String(bytes).replace(/\r\n/g,'\n').replace(/\s+$/,'')+'\n';
    bytes=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
    const digest=hash(bytes),ref='assets/comlist/'+name+'.'+digest.slice(0,20)+'.'+ext;
    files.set(ref,{path:ref,bytes:bytes.length,sha256:digest,content:bytes});return ref;
  }
  let html=expanded.replace(/<style(?: data-comlist="([a-z-]+)")?>([\s\S]*?)<\/style>/g,(_m,name,css)=>{
    css=css.replace(/url\("([^"/]+\.(?:png|jpg))"\)/g,(_url,image)=>{
      const ext=path.extname(image).slice(1),ref=asset(path.basename(image,path.extname(image)),ext,io.readFileSync(localFile(assetRoot,image)));
      return 'url("'+path.posix.basename(ref)+'")';
    });
    const ref=asset(name||'comlist','css',css);return '<link data-comlist="'+(name||'comlist')+'" rel="stylesheet" href="'+ref+'">';
  });
  html=html.replace(/(<img\b[^>]*data-comlist-image="([a-z-]+)"[^>]*\bsrc=")([^"/]+\.(?:png|jpg|webp))("[^>]*>)/g,(_m,before,name,image,after)=>before+asset(name,path.extname(image).slice(1),io.readFileSync(localFile(assetRoot,image)))+after);
  html=html.replace(/(<link\b[^>]*data-comlist-image="([a-z-]+)"[^>]*\bhref=")([^"/]+\.(?:png|jpg))("[^>]*>)/g,(_m,before,name,image,after)=>before+asset(name,path.extname(image).slice(1),io.readFileSync(localFile(assetRoot,image)))+after);
  html=html.replace(/<script(?: data-comlist="([a-z-]+)")?>([\s\S]*?)<\/script>/g,(_m,name,js)=>{
    if(name==='lock'){
      const match=js.match(/let DATA = \[\];\s*let DAILY_TASKS = \[\];\s*const ENC = (\{[\s\S]*?\});/);
      if(!match)throw Error('missing encrypted payload');
      const data=asset('payload','js',match[0]);
      const lock=asset('lock','js',js.replace(match[0],''));
      return '<script data-comlist="payload" src="'+data+'"></script>\n<script data-comlist="lock" src="'+lock+'"></script>';
    }
    const ref=asset(name||'app','js',js);return '<script data-comlist="'+(name||'app')+'" src="'+ref+'"></script>';
  });
  if(/data:image\/[^;]+;base64/.test(html))throw Error('base64 image remained in HTML');
  html=html.replace(/\r\n/g,'\n');
  const manifest={version:1,files:[...files.values()].map(({content,...entry})=>entry)};
  const manifestBytes=JSON.stringify(manifest,null,2)+'\n';
  const manifestRef='assets/comlist/manifest.'+hash(manifestBytes).slice(0,20)+'.json';
  html=html.replace(/<head>/,'<head>\n<meta name="comlist-manifest" content="'+manifestRef+'">');
  // Immutable dependencies first; the HTML is the only pointer that switches generation.
  for(const entry of files.values()){
    const file=localFile(root,entry.path);io.mkdirSync(path.dirname(file),{recursive:true});io.writeFileSync(file,entry.content);
  }
  const manifestPath=localFile(root,manifestRef);io.mkdirSync(path.dirname(manifestPath),{recursive:true});io.writeFileSync(manifestPath,manifestBytes);
  const temporary=out+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
  try{io.writeFileSync(temporary,html);io.renameSync(temporary,out);}finally{if(io.existsSync(temporary))io.unlinkSync(temporary);}
  verifyBundle(out,io);
  return manifest;
}
function verifyBundle(out,io=fs){
  const root=path.dirname(out),html=io.readFileSync(out,'utf8');
  const match=html.match(/<meta name="comlist-manifest" content="(assets\/comlist\/manifest\.([a-f0-9]{20})\.json)">/);
  if(!match)throw Error('bundle manifest missing');
  const bytes=io.readFileSync(localFile(root,match[1]));if(!hash(bytes).startsWith(match[2]))throw Error('manifest hash mismatch');
  const manifest=JSON.parse(bytes);if(manifest.version!==1||!Array.isArray(manifest.files))throw Error('invalid bundle manifest');
  const listed=new Set();
  for(const entry of manifest.files){
    if(!/^assets\/comlist\/[a-z0-9-]+\.[a-f0-9]{20}\.(?:js|css|png|jpg)$/.test(entry.path))throw Error('invalid bundle entry');
    if(listed.has(entry.path))throw Error('duplicate bundle entry');listed.add(entry.path);
    const content=io.readFileSync(localFile(root,entry.path));if(content.length!==entry.bytes||hash(content)!==entry.sha256)throw Error('asset hash mismatch: '+entry.path);
    if(entry.path.endsWith('.css'))for(const url of content.toString().matchAll(/url\("([^"]+)"\)/g)){if(!listed.has('assets/comlist/'+url[1])&&!manifest.files.some(f=>f.path==='assets/comlist/'+url[1]))throw Error('unlisted CSS dependency');}
  }
  for(const ref of html.matchAll(/(?:src|href)="(assets\/comlist\/[^"]+)"/g))if(!listed.has(ref[1]))throw Error('unlisted HTML dependency');
  return {...manifest,manifestPath:match[1]};
}
module.exports={writeBundle,verifyBundle};
