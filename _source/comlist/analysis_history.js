'use strict';
function appendAnalysisLog(previous, daily, contacts) {
  const end=Date.parse(daily.date+'T00:00:00Z');
  if(!Number.isFinite(end)) throw new Error('Invalid analysis date');
  const categories=Object.fromEntries(['A','B','C','D'].map(c=>[c,contacts.filter(p=>p['カテゴリー']===c).length]));
  const tasks=daily.tasks||[];
  const row={date:daily.date,contacts:contacts.length,categories,overdue:tasks.filter(t=>['selfOverdue','memberOverdue'].includes(t.section)).length};
  const rows=new Map();
  for(const r of Array.isArray(previous)?previous:[]) {
    const n=Date.parse(r.date+'T00:00:00Z');
    if(Number.isFinite(n)&&n<=end&&end-n<56*86400000&&Number.isInteger(r.overdue)&&r.overdue>=0) rows.set(r.date,{date:r.date,overdue:r.overdue,contacts:r.contacts,categories:r.categories});
  }
  rows.set(row.date,row);
  return [...rows.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
module.exports={appendAnalysisLog};
