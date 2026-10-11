const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');

test('calendar and events share one menu and a single workspace',t=>{
  const html=require('../app_sources').readApp('_assets/list.html').replace('<script src="data.js"></script>','<script>let DATA=[];</script>');
  const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost'});t.after(()=>dom.window.close());
  const w=dom.window,doc=w.document;
  assert.equal(doc.querySelector('[data-view="events"]'),null);
  assert.equal(doc.getElementById('calwrap').parentElement.id,'calendar-events');
  assert.equal(doc.getElementById('events').parentElement.id,'calendar-events');
  let calendars=0,events=0,refreshes=0;
  w.loadCalendar=()=>calendars++;w.renderEvents=()=>events++;w.refreshEventsFromApi=()=>refreshes++;
  w.setView('calendar');
  assert.equal(calendars,1);assert.equal(events,1);assert.equal(refreshes,1);
  assert.equal(w.getComputedStyle(doc.getElementById('calendar-events')).display,'grid');
  assert.equal(w.getComputedStyle(doc.getElementById('events')).display,'block');
  w.setView('today');assert.equal(w.getComputedStyle(doc.getElementById('calendar-events')).display,'none');
  w.setView('events');assert.equal(w.VIEW,'calendar');
  assert.ok(doc.getElementById('tab-cal').classList.contains('active'));
});
