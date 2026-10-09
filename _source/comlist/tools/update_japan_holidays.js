'use strict';
const fs=require('node:fs'),path=require('node:path');
const source='https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv';
function parse(csv){
 const rows=csv.trim().split(/\r?\n/);if(!rows.shift().includes('国民の祝日'))throw Error('Unexpected holiday CSV header');
 const holidays={};for(const row of rows){const match=/^(\d{4})\/(\d{1,2})\/(\d{1,2}),([^,]+)$/.exec(row);if(!match)throw Error('Invalid holiday CSV row');const date=match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');if(new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||holidays[date])throw Error('Invalid holiday date');holidays[date]=match[4];}
 const dates=Object.keys(holidays).sort(),lastYear=Number(dates.at(-1)?.slice(0,4));if(dates.length<1000||!lastYear||dates.filter(d=>d.startsWith(lastYear+'-')).length<16)throw Error('Incomplete holiday CSV');return {holidays,lastYear};
}
async function main(){
 const input=process.argv.indexOf('--input');let csv;
 if(input>=0)csv=fs.readFileSync(process.argv[input+1],'utf8');else{const response=await fetch(source,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Holiday CSV HTTP '+response.status);csv=new TextDecoder('shift_jis').decode(await response.arrayBuffer());}
 const {holidays,lastYear}=parse(csv),file=path.join(__dirname,'../_assets/js/calendar-availability.js'),old=fs.readFileSync(file,'utf8'),marker=/  \/\/ BEGIN GENERATED JAPAN HOLIDAYS[\s\S]*?  \/\/ END GENERATED JAPAN HOLIDAYS/;
 if(!marker.test(old))throw Error('Missing holiday data marker');if(lastYear<Number((old.match(/holidayLastYear=(\d+)/)||[])[1]||0))throw Error('Older holiday data');
 fs.writeFileSync(file,old.replace(marker,'  // BEGIN GENERATED JAPAN HOLIDAYS\n  // Source: '+source+'\n  var holidays='+JSON.stringify(holidays)+',holidayLastYear='+lastYear+';\n  // END GENERATED JAPAN HOLIDAYS'));console.log('HOLIDAYS_UPDATE: OK through '+lastYear+' ('+Object.keys(holidays).length+' days)');
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={parse};
