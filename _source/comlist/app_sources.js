'use strict';
const fs=require('node:fs'),path=require('node:path');
function localFile(root,ref){
  if(typeof ref!=='string'||!ref||/[?#\\]/.test(ref)||path.isAbsolute(ref))throw Error('invalid local asset path');
  const target=path.resolve(root,ref),relative=path.relative(path.resolve(root),target);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('asset path escapes root');
  return target;
}
// Tests execute the same separated sources; the build expands them only in memory.
function readApp(file){
  const root=path.dirname(file);let html=fs.readFileSync(file,'utf8');
  html=html.replace(/<script data-comlist="([a-z-]+)" src="([^"]+)"><\/script>/g,(_m,name,src)=>'<script data-comlist="'+name+'">\n'+fs.readFileSync(localFile(root,src),'utf8')+'\n</script>');
  html=html.replace(/<link data-comlist="([a-z-]+)" rel="stylesheet" href="([^"]+)">/g,(_m,name,href)=>'<style data-comlist="'+name+'">\n'+fs.readFileSync(localFile(root,href),'utf8')+'\n</style>');
  return html;
}
module.exports={readApp,localFile};
