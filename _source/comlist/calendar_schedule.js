'use strict';

// Authenticated material only. These strings belong inside the encrypted payload.
function wallTime(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw Error('Invalid calendar time');
  const parsed = new Date(value + ':00+09:00');
  if (!Number.isFinite(parsed.getTime()) || new Date(parsed.getTime() + 9 * 3600000).toISOString().slice(0,16) !== value) throw Error('Invalid calendar date');
  return value;
}
function text(value, max) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max) throw Error('Invalid calendar detail');
  return value.trim();
}
function normalizeCalendar(rows) {
  if (!Array.isArray(rows)) throw Error('Invalid calendar material');
  if (rows.length && !rows.some(row => Array.isArray(row) && row[2] && typeof row[2] === 'object')) return null;
  const seen = new Set();
  return rows.map(row => {
    if (!Array.isArray(row)) throw Error('Invalid calendar entry');
    const start = wallTime(row[0]), end = wallTime(row[1]);
    if (end <= start) throw Error('Invalid calendar interval');
    const meta = row[2];
    if (!meta || meta.source !== 'primary' || typeof meta.allDay !== 'boolean' || typeof meta.detailsAvailable !== 'boolean') throw Error('Invalid calendar metadata');
    const eventId = text(meta.eventId, 500);
    if (!eventId) throw Error('Missing calendar identity');
    const id = 'calendar:' + eventId;
    if (seen.has(id)) throw Error('Duplicate calendar identity');
    seen.add(id);
    const available = meta.detailsAvailable;
    return {id, start, end, allDay:meta.allDay, detailsAvailable:available,
      title:available ? text(meta.title, 1000) || '無題の予定' : '予定名未取得',
      location:available ? text(meta.location, 2000) : '',
      description:available ? text(meta.description, 20000) : ''};
  });
}
function dayAfter(day) {
  const d = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== day) throw Error('Invalid schedule date');
  d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);
}
function displayTime(event, today) {
  const startDay=event.start.slice(0,10), endDay=event.end.slice(0,10);
  const md=day=>day.slice(5).replace('-', '/');
  if(event.allDay){
    const last=new Date(endDay+'T00:00:00Z');last.setUTCDate(last.getUTCDate()-1);
    const lastDay=last.toISOString().slice(0,10);
    return startDay===lastDay?'終日':'終日（'+md(startDay)+'〜'+md(lastDay)+'）';
  }
  if(startDay===endDay)return event.start.slice(11)+'〜'+event.end.slice(11);
  return md(startDay)+' '+event.start.slice(11)+'〜'+md(endDay)+' '+event.end.slice(11)+(startDay<today?'（継続中）':'');
}
function applyCalendarSchedule(daily, rows, today) {
  const events=normalizeCalendar(rows);
  if(events===null)return daily;
  const next=dayAfter(today), schedule=events.filter(e=>e.start<next+'T00:00'&&e.end>today+'T00:00')
    .sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end))
    .map(e=>({...e,time:displayTime(e,today)}));
  const tasks=daily.tasks.filter(t=>t.type!=='calendar');
  for(const e of events.filter(e=>e.start.slice(0,10)>today)){
    tasks.push({id:e.id,type:'calendar',title:e.title,detail:[e.start.slice(5,10).replace('-','/'),displayTime(e,today),e.location,e.description].filter(Boolean).join(' / '),due:e.start.slice(0,10),section:'upcoming',priority:null,overdueDays:0,url:null});
  }
  return {...daily,calendar:schedule,tasks,sources:{...daily.sources,calendar:{...daily.sources.calendar,ok:true,count:events.length,detailsAvailable:true}}};
}
module.exports={normalizeCalendar,applyCalendarSchedule,displayTime};
