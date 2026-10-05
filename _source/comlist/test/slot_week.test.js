'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
function app(t,date='2026-10-05T00:08:00+09:00'){
  const d=new JSDOM('<div id="slots"></div>',{runScripts:'outside-only'}),w=d.window;t.after(()=>w.close());
  const now=Date.parse(date);w.Date.now=()=>now;w.CalendarAvailability=require('../_assets/js/calendar-availability');
  w.esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  w.eval(fs.readFileSync('_assets/js/calendar-slots.js','utf8'));
  w.CALENDAR_SLOT_PREFS={...w.CalendarAvailability.defaults(),buffer:0,confirmed:true};
  w.CALENDAR_AVAILABILITY={events:[],info:{source:'primary',complete:true,fetchedAt:new Date(now).toISOString(),rangeStart:new Date(now-86400000).toISOString(),rangeEnd:new Date(now+32*86400000).toISOString()}};
  return w;
}
test('週間カレンダーは月曜から7日表示し、90分枠を時間に対応する位置へ置く',t=>{
  const w=app(t);w.renderSlots();const doc=w.document;
  assert.equal(doc.querySelectorAll('.slot-week-day').length,7);
  assert.equal(doc.querySelector('.slot-week-day').dataset.slotDate,'2026-10-05');
  const first=doc.querySelector('[data-slot-index="0"]');assert.equal(first.style.top,'176px');assert.equal(first.style.height,'66px');
  assert.match(first.getAttribute('aria-label'),/2026-10-05.*12:00〜13:30/);
  let selected;w.openSlotDraft=s=>{selected=s;};first.click();assert.equal(selected.start,Date.parse('2026-10-05T12:00:00+09:00'));
  assert.equal(doc.querySelector('#slot-expand'),null);
});
test('月をまたぐ翌週の候補も正しいIDで選べる',t=>{
  const w=app(t,'2026-01-31T08:00:00+09:00');w.renderSlots();w.document.getElementById('slot-week-next').click();
  assert.equal(w.document.querySelector('.slot-week-day').dataset.slotDate,'2026-02-02');
  let selected;w.openSlotDraft=s=>{selected=s;};w.document.querySelector('[data-slot-index]').click();assert.equal(selected.date,'2026-02-02');
  assert.ok(!w.document.getElementById('slot-week-next').disabled);while(!w.document.getElementById('slot-week-next').disabled)w.document.getElementById('slot-week-next').click();assert.equal(w.document.querySelector('.slot-week-day').dataset.slotDate,'2026-02-23');assert.ok(w.document.querySelector('[data-slot-index]'));while(!w.document.getElementById('slot-week-prev').disabled)w.document.getElementById('slot-week-prev').click();
  assert.equal(w.document.querySelector('.slot-week-day').dataset.slotDate,'2026-01-26');
});
test('取得失敗や古い取得では週間カレンダーの候補を表示しない',t=>{
  const w=app(t);w.calendarSlotsError='取得に失敗';w.renderSlots();assert.equal(w.document.querySelector('.slot-week-grid'),null);
  w.calendarSlotsError='';w.CALENDAR_AVAILABILITY.info.complete=false;w.renderSlots();assert.equal(w.document.querySelector('[data-slot-index]'),null);
});
test('24時終了の候補は翌日の0時として表示しない',t=>{
  const w=app(t,'2026-10-05T22:30:00+09:00');w.CALENDAR_SLOT_PREFS.weekday=[[1350,1440]];w.renderSlots();
  assert.match(w.document.querySelector('[data-slot-index="0"]').textContent,/22:30〜24:00/);
});

test('Google template carries only generic title and UTC 90-minute dates including midnight',t=>{
 const w=app(t),start=Date.parse('2026-10-09T22:30:00+09:00'),end=Date.parse('2026-10-10T00:00:00+09:00');const u=new URL(w.googleCalendarSlotURL({start,end,name:'private',token:'private'},w.Date.now()));assert.equal(u.origin,'https://calendar.google.com');assert.equal(u.searchParams.get('dates'),'20261009T133000Z/20261009T150000Z');assert.equal(u.searchParams.get('text'),'\u4e88\u5b9a');assert.equal(u.searchParams.get('ctz'),'Asia/Tokyo');assert.deepEqual([...u.searchParams.keys()],['action','text','dates','ctz']);assert.ok(!u.href.includes('private'));assert.ok(u.href.includes('%E4%BA%88%E5%AE%9A'));for(const bad of [null,{start:NaN,end},{start:'2026-10-09',end},{start,end:start},{start,end:start+89*60000},{start:0,end:90*60000},{start:1e20,end:1e20+90*60000}])assert.equal(w.googleCalendarSlotURL(bad,w.Date.now()),null);
});
test('expired or stale click stays local and changes no editor or persisted data',t=>{const w=app(t);w.renderSlots();const s=w.CalendarAvailability.compute(w.CALENDAR_AVAILABILITY,w.CALENDAR_SLOT_PREFS,w.Date.now()).slots[0];assert.equal(w.openSlotDraft(s),true);w.CALENDAR_AVAILABILITY.info.complete=false;assert.equal(w.openSlotDraft(s),false);assert.equal(w.document.querySelectorAll('.slot-candidate').length,0);});
