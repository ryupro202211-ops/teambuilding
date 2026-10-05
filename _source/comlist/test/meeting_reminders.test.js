'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../_assets/js/meeting-reminders');
test('Four stages become due separately, survive the meeting date and do not return after completion',()=>{
 const today=new Date().toISOString().slice(0,10),date=M.shift(today,7),person={_row:2,'名前(あだ名)':'友達','次会う日':date};
 let state=[];M.update(state,[person],today);assert.deepEqual(state.map(r=>r.offset),[7]);
 M.update(state,[person],M.shift(date,-3));assert.equal(state.length,2);
 M.update(state,[person],M.shift(date,-1));assert.equal(state.length,3);
 M.update(state,[person],date);assert.equal(state.length,4);
 state[0].done=true;M.update(state,[person],M.shift(date,1));assert.equal(state.length,4);assert.equal(state.filter(r=>!r.done).length,3);
 M.update(state,[person],M.shift(date,2));assert.equal(state[0].done,true);
});
test('Past appointments are not newly created; separate friends and rescheduled dates have separate reminders',()=>{
 const today=new Date().toISOString().slice(0,10),state=[];
 M.update(state,[{_row:2,'名前(あだ名)':'過去','次会う日':M.shift(today,-1)},{_row:3,'名前(あだ名)':'未定','次会う日':''}],today);assert.equal(state.length,0);
 const p={_row:4,'名前(あだ名)':'友達','次会う日':M.shift(today,7)};M.update(state,[p,{...p,_row:5}],today);assert.equal(state.length,2);
 state[0].done=true;p['次会う日']=M.shift(today,3);M.update(state,[p],today);assert.equal(state.length,4);assert.equal(state.filter(r=>r.done).length,1);
 assert.equal(new Set(state.map(r=>r.id)).size,state.length);
});
test('Cache validation accepts completion records and rejects malformed dates or duplicate IDs',()=>{
 const today=new Date().toISOString().slice(0,10),s=[];M.update(s,[{_row:2,'名前(あだ名)':'友達','次会う日':today}],today);assert.deepEqual(M.validate(s),s);
 assert.throws(()=>M.validate([s[0],s[0]]));assert.throws(()=>M.validate([{...s[0],meeting:'2026-02-30'}]));assert.throws(()=>M.validate([{...s[0],done:'true'}]));
});
