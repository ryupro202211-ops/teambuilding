// Private state is stored only in the owner's spreadsheet, never in a public JSON.
var FIELD_GOALS_SHEET_NAME = '目標達成管理';
var FIELD_GOALS_HEADERS = ['状態JSON', '更新番号', '最終リクエストID', '最終要求SHA256'];
var FIELD_GOALS_CHUNK_SIZE = 20000;
var FIELD_GOALS_MAX_CHARACTERS = 1000000;
function setupFieldGoalsSheet() {
  return withMaterialLock_(function(){
    var book=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID),sh=book.getSheetByName(FIELD_GOALS_SHEET_NAME);
    if(!sh)sh=book.insertSheet(FIELD_GOALS_SHEET_NAME);
    if(sh.getLastRow()>0){
      if(!fieldGoalsReady_(sh))throw Error('目標達成管理には既存データがあります。設定を中止しました。');
      fieldGoalsRead_();return {ok:true,sheet:FIELD_GOALS_SHEET_NAME,alreadyReady:true};
    }
    sh.getRange(1,1,1,4).setValues([FIELD_GOALS_HEADERS]);
    sh.getRange(2,1,1,4).setValues([[JSON.stringify(FieldGoalsModel.empty()),0,'','']]);SpreadsheetApp.flush();
    return {ok:true,sheet:FIELD_GOALS_SHEET_NAME};
  });
}
function fieldGoalsReady_(sh){var h=sh.getRange(1,1,1,4).getValues()[0];return FIELD_GOALS_HEADERS.every(function(v,i){return h[i]===v;});}
function fieldGoalsDigest_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function fieldGoalsSnapshot_(){
  var sh=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(FIELD_GOALS_SHEET_NAME);
  if(!sh||!fieldGoalsReady_(sh))throw Error('field goals not ready');
  var rows=sh.getRange(2,1,Math.max(1,sh.getLastRow()-1),4).getValues(),cells=rows[0];
  if(rows.slice(1).some(function(r){return r.slice(1).some(function(v){return v!=='';});}))throw Error('目標管理の保存範囲に別のデータがあります。確認してください');
  if(!Number.isInteger(cells[1])||cells[1]<0)throw Error('目標管理の更新番号が不正です');
  var raw=rows.map(function(r){return String(r[0]||'');}).join('');if(raw.length>FIELD_GOALS_MAX_CHARACTERS)throw Error('目標管理の保存上限です');
  var data=FieldGoalsModel.validate(JSON.parse(raw));
  return {sheet:sh,cells:cells,rowCount:rows.length,state:data,version:fieldGoalsDigest_(raw+'\n'+cells[1])};
}
function fieldGoalsRead_(){var s=fieldGoalsSnapshot_();return {ok:true,state:s.state,version:s.version,requestId:s.cells[2]||''};}
function fieldGoalsWrite_(body){
  var s=fieldGoalsSnapshot_();
  if(typeof body.requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId))return {ok:false,error:'invalid request'};
  var data=FieldGoalsModel.validate(body.state),serialized=JSON.stringify(data),digest=fieldGoalsDigest_(serialized);
  if(serialized.length>FIELD_GOALS_MAX_CHARACTERS)return {ok:false,error:'capacity',message:'記録の保存上限です。管理者に確認してください。'};
  if(s.cells[2]===body.requestId){if(s.cells[3]!==digest)return {ok:false,error:'request mismatch'};return fieldGoalsRead_();}
  if(!body.version)return {ok:false,error:'version required'};
  if(body.version!==s.version)return {ok:false,error:'conflict',state:s.state,version:s.version};
  var today=Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd');
  if(data.records.some(function(r){return r.status==='completed'&&r.date>today;}))return {ok:false,error:'future completion',message:'未来の日付を実施済みにできません。予定として保存してください。'};
  var newPeople=data.persons.filter(function(p){return !s.state.persons.some(function(old){return old.id===p.id;});});
  if(newPeople.length){var contacts=readContacts_();if(newPeople.some(function(p){return contacts.filter(function(c){return c['名前(あだ名)']===p.name;}).length!==1;}))return {ok:false,error:'person unknown',message:'新しい人物IDの対象を人脈リストで一意に確認できません。最新データを確認してください。'};}
  if(s.state.persons.some(function(p){return !data.persons.some(function(x){return x.id===p.id&&x.name===p.name;});}))return {ok:false,error:'identity changed'};
  if(s.state.records.some(function(r){return !data.records.some(function(x){return x.id===r.id&&x.personId===r.personId;});}))return {ok:false,error:'record removed',message:'記録は削除せず、取消として残してください。'};
  if(s.state.missions.some(function(w){return !data.missions.some(function(x){return x.id===w.id&&JSON.stringify(x)===JSON.stringify(w);});}))return {ok:false,error:'mission changed',message:'確定した週ミッションは変更・削除せず残してください。'};
  if(data.missions.some(function(w){return !s.state.missions.some(function(x){return x.id===w.id;})&&w.startDate!==today;}))return {ok:false,error:'invalid mission date'};
  if(data.missions.some(function(w){return !s.state.missions.some(function(x){return x.id===w.id;})&&JSON.stringify(w.baseline)!==JSON.stringify(FieldGoalsModel.missionBaseline(data,w.month,today));}))return {ok:false,error:'invalid mission baseline'};
  var chunks=[];for(var offset=0;offset<serialized.length;offset+=FIELD_GOALS_CHUNK_SIZE)chunks.push(serialized.slice(offset,offset+FIELD_GOALS_CHUNK_SIZE));
  var count=Math.max(chunks.length,s.rowCount),matrix=[];for(var i=0;i<count;i++)matrix.push([chunks[i]||'',i===0?s.cells[1]+1:'',i===0?body.requestId:'',i===0?digest:'']);
  if(s.sheet.getMaxRows&&s.sheet.getMaxRows()<count+1)s.sheet.insertRowsAfter(s.sheet.getMaxRows(),count+1-s.sheet.getMaxRows());
  s.sheet.getRange(2,1,count,4).setValues(matrix);SpreadsheetApp.flush();
  return fieldGoalsRead_();
}
