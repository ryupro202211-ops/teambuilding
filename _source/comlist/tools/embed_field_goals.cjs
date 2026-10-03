'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),target=path.join(root,'sheet-api.gs');
const start='// BEGIN GENERATED FIELD GOALS',end='// END GENERATED FIELD GOALS';
const content=[fs.readFileSync(path.join(root,'_assets/js/field-model.js'),'utf8'),fs.readFileSync(path.join(root,'field_goals_api.gs'),'utf8')].map(s=>s.replace(/\r\n/g,'\n').trim()).join('\n\n');
function embed(source,text){
  source=source.replace(/\r\n/g,'\n');const block=start+'\n'+text+'\n'+end+'\n',at=source.indexOf(start);
  if(at<0)return source.trimEnd()+'\n\n'+block;
  const stop=source.indexOf(end,at);if(stop<0||source.indexOf(start,at+start.length)>=0)throw Error('Generated region is incomplete or duplicated');
  return source.slice(0,at)+block.trimEnd()+source.slice(stop+end.length);
}
if(require.main===module){fs.writeFileSync(target,embed(fs.readFileSync(target,'utf8'),content));console.log('FIELD_GOALS_GAS_EMBED: OK');}
module.exports={embed};
