import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceRole, castLocalVote, changeLocalTimer, localResult, newLocalRound, openLocalVote, remainingSeconds, restoreLocalRound, validateNames } from '../src/lib/local-game.ts';

const names=['نورة','محمد','سارة','عمر'];
const now=1_800_000_000_000;
const pick=()=>0;
function round(){return newLocalRound(names,120,undefined,now,pick);}
function discussion(){let r=round();for(const _ of names)r=advanceRole(r,now);return r;}

test('local setup validates counts, distinct names and control characters',()=>{
  assert.throws(()=>validateNames(['أ','ب','ج']));
  assert.throws(()=>validateNames(['نورة','نورة','عمر']));
  assert.throws(()=>validateNames(['نورة','عمر']));
  assert.throws(()=>validateNames([...names,'اسم\u202eمخفي']));
  assert.equal(validateNames([' نورة ','عمر','  أبو  علي '])[2],'أبو علي');
  assert.throws(()=>newLocalRound(names,901));
});
test('roles are dealt in order; final acknowledgement starts discussion timer',()=>{
  let r=round();assert.equal(r.cursor,0);assert.equal(r.deadline,null);
  for(let i=1;i<names.length;i++){r=advanceRole(r,now);assert.equal(r.cursor,i);assert.equal(r.phase,'reveal');}
  r=advanceRole(r,now);assert.equal(r.phase,'discuss');assert.equal(r.deadline,now+120000);
  assert.throws(()=>advanceRole(r));
});
test('local votes are immutable and reject self votes; results require explicit reveal',()=>{
  let r=openLocalVote(discussion());
  assert.throws(()=>castLocalVote(r,0));assert.throws(()=>castLocalVote(r,4));
  assert.throws(()=>localResult(r));
  for(let i=0;i<4;i++){r=castLocalVote(r,i===0?1:0);}
  assert.equal(r.phase,'summary');assert.throws(()=>localResult(r));assert.throws(()=>castLocalVote(r,0));
  const result=localResult({...r,phase:'result'});
  assert.equal(result.caught,true);assert.deepEqual(result.counts,[3,1,0,0]);
});
test('ties let outsider win; replay changes both word and outsider',()=>{
  let r=openLocalVote(discussion());for(let i=0;i<4;i++)r=castLocalVote(r,(i+1)%4);
  assert.equal(localResult({...r,phase:'result'}).tied,true);
  assert.equal(localResult({...r,phase:'result'}).caught,false);
  const next=newLocalRound(names,120,r,now+5000,pick);
  assert.notEqual(next.wordIndex,r.wordIndex);assert.notEqual(next.outsider,r.outsider);
  assert.equal(next.round,2);assert.deepEqual(next.votes,[]);assert.equal(next.cursor,0);
});
test('local pause, resume, disable and changing durations survive time and restore',()=>{
  let r=discussion();
  r=changeLocalTimer(r,'timer_pause',120,now+30000);
  assert.equal(remainingSeconds(r.timer,r.deadline,now+90000),90);
  assert.equal(r.deadline,null);
  assert.deepEqual(restoreLocalRound(JSON.stringify(r),now+90000),r);
  r=changeLocalTimer(r,'timer_set',180,now+90000);assert.equal(r.timer.remaining_seconds,180);
  r=changeLocalTimer(r,'timer_resume',120,now+90000);assert.equal(r.deadline,now+270000);
  r=changeLocalTimer(r,'timer_disable',120,now);assert.equal(r.timer.enabled,false);assert.equal(r.deadline,null);
  r=changeLocalTimer(r,'timer_enable',120,now);assert.equal(r.deadline,now+180000);
  r=changeLocalTimer(r,'timer_reset',120,now+10000);assert.equal(r.deadline,now+190000);
});
test('elapsed local discussion stays discussion; voting is untimed for passing the phone',()=>{
  const r=discussion();assert.equal(remainingSeconds(r.timer,r.deadline,now+999000),0);assert.equal(r.phase,'discuss');
  const vote=openLocalVote(r);assert.equal(vote.deadline,null);assert.throws(()=>changeLocalTimer(vote,'timer_pause'));
});
test('refresh restores session but never has a visible role field; invalid/expired data rejected',()=>{
  const r=round();assert.deepEqual(restoreLocalRound(JSON.stringify(r),now),r);
  assert.equal('shown' in r,false);
  for(const raw of ['bad','{}','null',JSON.stringify({...r,wordIndex:900}),JSON.stringify({...r,votes:[0]}),JSON.stringify({...r,players:[1,2,3]}),JSON.stringify({...r,timer:null})]) assert.equal(restoreLocalRound(raw,now),null);
  assert.equal(restoreLocalRound(JSON.stringify(r),now+86400001),null);
});
