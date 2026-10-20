import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crimeCards,clueBoards} from '../src/lib/crime-content.ts';
import {newCrime,crimeSecret,chooseCrime,advanceCrimeRole,accuseCrime,setCrimeClue,closeCrime,crimeTimer,publicCrime,shareCrimeHand,parseCrimeHand,restoreCrime} from '../src/lib/crime-game.ts';
const names=['محمد','سعود','خالد','نواف'];
function investigation() {
  let game=newCrime(names,0);
  const hand=game.hands.find(h=>h.player_id===game.killer_id);
  game=chooseCrime(game,game.killer_id,hand.weapons[0],hand.evidence[0]);
  while(game.phase==='reveal')game=advanceCrimeRole(game);
  return game;
}
test('original 128-card deck supports 12 players with unique four-plus-four hands',()=>{
  assert.equal(crimeCards.length,128);assert.equal(new Set(crimeCards.map(c=>c.id)).size,128);
  const game=newCrime(Array.from({length:12},(_,i)=>`لاعب ${i+1}`),3);
  assert.equal(game.hands.length,11);
  for(const h of game.hands){assert.equal(h.weapons.length,4);assert.equal(h.evidence.length,4);}
  assert.equal(new Set(game.hands.flatMap(h=>[...h.weapons,...h.evidence])).size,88);
  assert.equal(game.order.at(-1),game.narrator_id);assert.notEqual(game.killer_id,game.narrator_id);
});
test('names, narrator and minimal group are validated',()=>{
  assert.throws(()=>newCrime(names.slice(0,3),0));
  assert.throws(()=>newCrime(['محمد','محمد','خالد','نواف'],0));
  assert.throws(()=>newCrime(names,99));
  assert.throws(()=>newCrime(['محمد\u202e','سعود','خالد','نواف'],0));
});
test('private role, own-hand choice and narrator handoff are enforced',()=>{
  let game=newCrime(names,0);
  const h=game.hands.find(h=>h.player_id===game.killer_id);
  const other=game.hands.find(h=>h.player_id!==game.killer_id);
  assert.throws(()=>chooseCrime(game,other.player_id,h.weapons[0],h.evidence[0]),/KILLER_ONLY/);
  assert.throws(()=>chooseCrime(game,game.killer_id,other.weapons[0],h.evidence[0]),/INVALID_CARDS/);
  game=chooseCrime(game,game.killer_id,h.weapons[0],h.evidence[0]);
  assert.equal(crimeSecret(game,other.player_id).solution,null);
  assert.equal(crimeSecret(game,game.narrator_id).solution.killer_id,game.killer_id);
  assert.throws(()=>chooseCrime(game,game.killer_id,h.weapons[1],h.evidence[1]),/WRONG_PHASE/);
  while(game.phase==='reveal')game=advanceCrimeRole(game);
  assert.equal(game.phase,'investigate');assert.ok(game.players.every(p=>p.ready));
  const visible=publicCrime(game);
  assert.equal(visible.result,null);assert.equal(visible.solution,undefined);assert.equal(visible.killer_id,undefined);
});
test('clues are from the allowlist and narrator-only',()=>{
  let game=investigation();
  assert.throws(()=>setCrimeClue(game,game.killer_id,'place','منزل'),/NARRATOR_ONLY/);
  assert.throws(()=>setCrimeClue(game,game.narrator_id,'place','اسم المجرم'),/INVALID_CLUE/);
  game=setCrimeClue(game,game.narrator_id,clueBoards[0].id,clueBoards[0].options[0]);
  assert.equal(publicCrime(game).clues.place,'منزل');
});
test('accusation must match all three items; one attempt and no narrator/self guesses',()=>{
  let game=investigation();const actor=game.hands.find(h=>h.player_id!==game.killer_id).player_id;
  const h=game.hands.find(h=>h.player_id===game.killer_id);
  assert.throws(()=>accuseCrime(game,game.narrator_id,game.killer_id,h.weapons[0],h.evidence[0]),/INVALID_ACCUSATION/);
  assert.throws(()=>accuseCrime(game,actor,actor,h.weapons[0],h.evidence[0]),/INVALID_ACCUSATION/);
  const wrong=accuseCrime(game,actor,game.killer_id,h.weapons[1],h.evidence[0]);
  assert.equal(wrong.phase,'investigate');assert.equal(wrong.result,null);
  assert.throws(()=>accuseCrime(wrong,actor,game.killer_id,h.weapons[0],h.evidence[0]),/ALREADY_ACCUSED/);
  game=accuseCrime(game,actor,game.killer_id,h.weapons[0],h.evidence[0]);
  assert.equal(game.phase,'result');assert.equal(game.result.caught,true);
});
test('all incorrect guesses or narrator closure reveal a killer win; replay changes killer',()=>{
  let game=investigation();
  for(const h of game.hands) {
    const target=game.hands.find(t=>t.player_id!==h.player_id&&t.player_id!==game.killer_id)??game.hands.find(t=>t.player_id!==h.player_id);
    game=accuseCrime(game,h.player_id,target.player_id,target.weapons[3],target.evidence[3]);
  }
  assert.equal(game.phase,'result');assert.equal(game.result.caught,false);
  const next=newCrime(names,0,game);assert.notEqual(next.killer_id,game.killer_id);assert.equal(next.round,2);
  const active=investigation();assert.throws(()=>closeCrime(active,active.killer_id),/NARRATOR_ONLY/);
  assert.equal(closeCrime(active,active.narrator_id).result.caught,false);
});
test('public share payload is a hand only and rejects malformed card data',()=>{
  const game=investigation(),hand=game.hands[0];
  const fragment=shareCrimeHand('محمد',{...hand,solution:game.solution,role:'killer'});
  const raw=JSON.parse(decodeURIComponent(fragment));
  assert.deepEqual(Object.keys(raw).sort(),['evidence','name','v','weapons']);
  assert.equal(parseCrimeHand('#'+fragment).hand.weapons.length,4);
  assert.equal(parseCrimeHand('%bad'),null);
  assert.equal(parseCrimeHand(encodeURIComponent(JSON.stringify({...raw,weapons:['w01']}))),null);
});
test('reload validates state and rejects stale/corrupt secrets and invalid outcomes',()=>{
  const game=investigation();
  assert.deepEqual(restoreCrime(JSON.stringify(game)),game);
  assert.equal(restoreCrime(JSON.stringify({...game,created_at:0})),null);
  assert.equal(restoreCrime(JSON.stringify({...game,solution:{...game.solution,weapon:'w999'}})),null);
  assert.equal(restoreCrime(JSON.stringify({...game,phase:'result',result:{...game.solution,caught:true}})),null);
});
test('timer can pause, retain custom duration, resume and disable without ending case',()=>{
  let game=investigation();assert.equal(game.timer.enabled,false);
  game=crimeTimer(game,'timer_enable');game=crimeTimer(game,'timer_pause');
  game=crimeTimer(game,'timer_set',45);assert.equal(game.timer.remaining_seconds,45);assert.equal(game.timer.paused,true);
  game=crimeTimer(game,'timer_resume');assert.ok(game.deadline);assert.equal(game.timer.paused,false);
  game=crimeTimer(game,'timer_disable');assert.equal(game.deadline,null);assert.equal(game.phase,'investigate');
  assert.throws(()=>crimeTimer(game,'timer_set',901));
});
