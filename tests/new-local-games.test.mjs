import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newMafia,mafiaDefaults,mafiaLocalAction,mafiaSecret,mafiaPublic,restoreMafia} from '../src/lib/mafia-game.ts';
import {newParty,partyLocalAction,partyPublic,partySecret,restoreParty,arabicLetters} from '../src/lib/party-game.ts';
import {newWave,waveLocalAction,wavePublic,restoreWave} from '../src/lib/wave-game.ts';
const names=n=>Array(n).fill('');
test('local mafia: two passes, immediate detective scan, final handoff, counted skips and doctor restriction',()=>{
  let g=newMafia(names(8),0,mafiaDefaults(8));const ids=g.players.map(p=>p.id),host=ids[0];
  assert.deepEqual(g.players.map(p=>p.name),Array.from({length:8},(_,i)=>`لاعب ${i+1}`));
  for(const id of ids){assert.equal(g.phase,'reveal');g=mafiaLocalAction(g,id,'ready');}
  assert.equal(g.phase,'night');assert.equal(g.deadline,null);
  const maf=ids.filter(id=>g.roles[id]==='mafia'),doc=ids.find(id=>g.roles[id]==='doctor'),det=ids.find(id=>g.roles[id]==='detective');
  for(const id of ids){g=mafiaLocalAction(g,id,'night_action',{target:id===det?maf[0]:id===doc?doc:'skip'});assert.equal(g.phase,'night');if(id===det){assert.equal(mafiaSecret(g,id).scans[0].mafia,true);assert.throws(()=>mafiaLocalAction(g,id,'night_action',{target:'skip'}),/ACTION_LOCKED/);}assert.equal(mafiaPublic(g).players.find(p=>p.id===id).done,false);g=mafiaLocalAction(g,id,'night_ready');}
  assert.equal(g.phase,'day');assert.ok(g.deadline);assert.equal(g.last_save,doc);
  assert.equal(mafiaSecret(g,maf[0]).scans.length,0);assert.ok(mafiaPublic(g).players.every(p=>p.role===null));
  g=mafiaLocalAction(g,host,'timer_pause');g=mafiaLocalAction(g,host,'timer_set',{seconds:45});assert.equal(g.timer.remaining_seconds,45);
  g=mafiaLocalAction(g,host,'timer_resume');g=mafiaLocalAction(g,host,'timer_disable');assert.equal(g.deadline,null);
  g=mafiaLocalAction(g,host,'open_vote');for(const id of ids)g=mafiaLocalAction(g,id,'vote',{target:'skip'});
  assert.equal(g.phase,'night');assert.deepEqual(g.log.at(-1).tally,{skip:8});assert.throws(()=>mafiaLocalAction(g,doc,'night_action',{target:doc}),/INVALID_TARGET/);
  assert.deepEqual(restoreMafia(JSON.stringify(g)),g);
});
test('local mafia: one victim from split mafia choices and both win conditions',()=>{
  let g=newMafia(names(8),0,mafiaDefaults(8));for(const p of g.players)g=mafiaLocalAction(g,p.id,'ready');
  const maf=g.players.filter(p=>g.roles[p.id]==='mafia'),cit=g.players.filter(p=>g.roles[p.id]==='citizen');
  for(const p of g.players){g=mafiaLocalAction(g,p.id,'night_action',{target:maf[0].id===p.id?cit[0].id:maf[1].id===p.id?cit[1].id:'skip'});g=mafiaLocalAction(g,p.id,'night_ready');}
  assert.equal(g.players.filter(p=>!p.alive).length,1);assert.ok(cit.some(p=>p.id===g.log[0].eliminated));
  for(const win of ['town','mafia']){
    let s=newMafia(names(5),0,mafiaDefaults(5));for(const p of s.players)s=mafiaLocalAction(s,p.id,'ready');
    const killer=s.players.find(p=>s.roles[p.id]==='mafia').id;
    if(win==='mafia'){
      // A reachable final night with one mafia and two townspeople alive.
      const town=s.players.filter(p=>p.id!==killer);town.slice(2).forEach(p=>s.players.find(x=>x.id===p.id).alive=false);
      for(const p of s.players.filter(p=>p.alive)){s=mafiaLocalAction(s,p.id,'night_action',{target:p.id===killer?town[0].id:'skip'});s=mafiaLocalAction(s,p.id,'night_ready');}
    }else{
      for(const p of s.players){s=mafiaLocalAction(s,p.id,'night_action',{target:'skip'});s=mafiaLocalAction(s,p.id,'night_ready');}
      s=mafiaLocalAction(s,'p0','open_vote');for(const p of s.players)s=mafiaLocalAction(s,p.id,'vote',{target:p.id===killer?'skip':killer});
    }
    assert.equal(s.phase,'result');assert.equal(s.winner,win);
  }
});
test('local wrong: secrets, all answers together, self-vote, score and fresh question',()=>{
  let g=newParty('wrong',names(4));const initial=g.bank_id,odd=g.odd;
  for(const p of g.players){assert.equal(partyPublic(g).answers,null);const q=partySecret(g,p.id);g=partyLocalAction(g,p.id,'answer',{answer:q.input==='number'?'٢٥':'قهوة'});}
  assert.equal(g.phase,'discuss');assert.equal(Object.keys(partyPublic(g).answers).length,4);assert.ok(partyPublic(g).question);
  g=partyLocalAction(g,'p0','open_vote');for(const p of g.players)g=partyLocalAction(g,p.id,'vote',{target:odd});
  const result=partyPublic(g).result;assert.equal(result.caught,true);assert.equal(result.scores.find(p=>p.id===odd).score,-1);
  assert.deepEqual(restoreParty(JSON.stringify(g),'wrong'),g);g=newParty('wrong',names(4),g);assert.notEqual(g.bank_id,initial);assert.equal(partyPublic(g).question,null);
});
test('local letters: all 28 letters, stable question, undo and invalid input',()=>{
  let g=newParty('letters',names(1)),q=partyPublic(g).question;assert.throws(()=>partyLocalAction(g,'p0','letter',{letter:'ء'}),/LETTER_INVALID/);
  for(const letter of arabicLetters)g=partyLocalAction(g,'p0','letter',{letter});assert.equal(g.phase,'result');assert.equal(partyPublic(g).question,q);
  g=partyLocalAction(g,'p0','undo',{letter:arabicLetters.at(-1)});assert.equal(g.phase,'letters');assert.equal(g.used.length,27);assert.deepEqual(restoreParty(JSON.stringify(g),'letters'),g);
});
test('local wave: full game, turn rotation, secret target, scores and late guess excluded',()=>{
  let g=newWave(names(3),4),givers=[];
  for(let turn=1;turn<=4;turn++){
    const giver=g.players[g.giver_index].id;givers.push(giver);assert.equal(wavePublic(g).target,undefined);
    g=waveLocalAction(g,giver,'clue',{clue:'قهوة ساخنة'});
    for(const p of g.players.filter(p=>p.id!==giver))g=waveLocalAction(g,p.id,'guess',{value:g.target});
    assert.equal(g.score,turn*4);if(turn<4)g=waveLocalAction(g,'p0','next');
  }
  assert.equal(g.phase,'complete');assert.equal(new Set(givers.slice(0,3)).size,3);assert.deepEqual(restoreWave(JSON.stringify(g)),g);
  g=newWave(names(3),4);const giver=g.players[g.giver_index].id,guessers=g.players.filter(p=>p.id!==giver);
  g=waveLocalAction(g,giver,'clue',{clue:'مثال جميل'});g=waveLocalAction(g,guessers[0].id,'guess',{value:10});g.deadline=new Date(Date.now()-1000).toISOString();g.timer.enabled=true;
  g=waveLocalAction(g,guessers[1].id,'guess',{value:100});assert.equal(g.history[0].average,10);assert.equal(g.history[0].guesses[guessers[1].id],undefined);
});
test('corrupt and expired local saves fail closed',()=>{
  const fixtures=[[newMafia(names(5),0,mafiaDefaults(5)),restoreMafia],[newParty('wrong',names(4)),raw=>restoreParty(raw,'wrong')],[newWave(names(3),4),restoreWave]];
  for(const [g,restore] of fixtures){for(const raw of ['{','null','[]',JSON.stringify({...g,players:[]}),JSON.stringify({...g,created_at:0}),JSON.stringify({...g,phase:'unknown'})])assert.equal(restore(raw),null);}
  const mafia=fixtures[0][0];for(const patch of [{log:[null]},{scans:[{cycle:1,target:'missing',mafia:true}]},{actions:[]},{ready:['missing']},{timer:{...mafia.timer,enabled:'yes'}}])assert.equal(restoreMafia(JSON.stringify({...mafia,...patch})),null);
  const party=fixtures[1][0];for(const patch of [{bank_used:[999]},{answers:[]},{votes:[]}])assert.equal(restoreParty(JSON.stringify({...party,...patch}),'wrong'),null);
});
