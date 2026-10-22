import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database} from './helpers/database.mjs';
import {roundScores} from '../src/lib/round-scores.ts';
import {arabicLetters} from '../src/lib/party-game.ts';
let h;
before(async()=>{h=await database();});after(async()=>await h?.db.close());

test('all migrations + content install; latest upgrades preserve active sessions and are repeatable',async()=>{
  const g=await h.group('wrong',4);await g.act('start');
  const own=await g.act('secret');
  for(const file of ['007_polish.sql','008_readiness.sql','008_readiness.sql']){
    await h.db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  }
  assert.deepEqual(await g.act('secret'),own);
  assert.equal((await g.act('state')).players.length,4);
});

test('008 recovers a database at 003 and preserves customized content and six active sessions',async()=>{
  const older=await database({through:3,content:false});
  const upgrade=await readFile(new URL('../supabase/migrations/008_readiness.sql',import.meta.url),'utf8');
  try{
    await older.db.exec(upgrade);
    await older.db.query("update private.party_bank set a='سؤال خاص بصاحب الموقع' where game='wrong' and id=0");
    await older.db.query("update private.wave_pairs set low_label='طرف مخصص' where id=0");
    const groups=[];
    for(const [kind,n] of [['outsider',3],['crime',4],['mafia',5],['wave',2],['wrong',4],['letters',1]]){
      const g=await older.group(kind,n);
      await g.act('start',kind==='crime'?{narrator:g.state.me}:kind==='mafia'?{config:{moderator:false,mafia:1,doctor:true,detective:true,reveal:false}}:kind==='wave'?{total:4}:{});
      groups.push(g);
    }
    const before=(await older.db.query("select (select jsonb_agg(data order by room_id) from private.mafia_sessions) mafia,(select jsonb_agg(data order by room_id) from private.wave_sessions) wave,(select jsonb_agg(data order by room_id) from private.party_sessions) party")).rows;
    await older.db.exec(upgrade);
    assert.deepEqual((await older.db.query("select (select jsonb_agg(data order by room_id) from private.mafia_sessions) mafia,(select jsonb_agg(data order by room_id) from private.wave_sessions) wave,(select jsonb_agg(data order by room_id) from private.party_sessions) party")).rows,before);
    for(const g of groups){const state=await g.act('state');assert.equal(state.round,1);assert.notEqual(state.phase,'lobby');}
    assert.equal((await older.db.query("select a from private.party_bank where game='wrong' and id=0")).rows[0].a,'سؤال خاص بصاحب الموقع');
    assert.equal((await older.db.query('select low_label from private.wave_pairs where id=0')).rows[0].low_label,'طرف مخصص');
  }finally{await older.db.close();}
});

test('wave deadline settles only previously confirmed guesses, without counting a late request',async()=>{
  const g=await h.group('wave',3);await g.act('start',{total:4});const giver=g.state.giver,guessers=g.users.filter(u=>u!==g.byId.get(giver));
  await g.act('clue',{clue:'مثال جميل'},g.byId.get(giver));await g.act('guess',{value:10},guessers[0]);
  await h.db.query("update private.wave_sessions set data=jsonb_set(data,'{deadline}',to_jsonb((now()-interval '1 second')::text)) where room_id=$1",[g.state.id]);
  await g.act('guess',{value:100},guessers[1]);assert.equal(g.state.result.average,10);assert.equal(Object.keys(g.state.result.guesses).length,1);
});

test('latest crime: private solution, owned cards, all-ready barrier, correct accusation and replay',async()=>{
  const g=await h.group('crime',4);const narrator=g.state.me;await g.act('start',{narrator});const roles={};
  for(const [id,uid] of g.byId)roles[id]=await g.act('role',{},uid);
  const killer=Object.keys(roles).find(id=>roles[id].role==='killer'),investigator=Object.keys(roles).find(id=>roles[id].role==='investigator');
  const hand=g.state.hands.find(h=>h.player_id===killer),choice={weapon:hand.weapons[0],evidence:hand.evidence[0]};
  await assert.rejects(()=>g.act('choose',choice,g.byId.get(investigator)),/KILLER_ONLY/);
  await g.act('choose',choice,g.byId.get(killer));assert.equal((await g.act('role',{},g.byId.get(investigator))).solution,null);assert.equal((await g.act('role',{},g.byId.get(narrator))).solution.killer_id,killer);
  await assert.rejects(()=>g.act('investigate'),/NOT_READY/);for(const uid of g.users)await g.act('ready',{},uid);await g.act('investigate');assert.equal(g.state.result,null);
  await g.act('accuse',{target:killer,...choice},g.byId.get(investigator));assert.equal(g.state.phase,'result');assert.equal(g.state.result.caught,true);
  await g.act('start',{narrator});assert.equal(g.state.round,2);assert.equal(g.state.result,null);
});

for(const [kind,n] of [['outsider',3],['crime',4],['mafia',5],['wave',2],['wrong',4],['letters',1]]){
  test(`${kind}: guest join, outsider denial, cross-game dispatch, host recovery and revoked access`,async()=>{
    const g=await h.group(kind,n),stranger=await h.user();
    await assert.rejects(()=>h.rpc(kind,stranger,'state',g.code),/NOT_MEMBER/);
    await assert.rejects(()=>h.rpc(kind,null,'state',g.code),/permission denied/);
    await assert.rejects(()=>h.rpc(kind,stranger,'start',g.code,0,{step:0}),/NOT_MEMBER/);
    const joined=await h.rpc('outsider',stranger,'join',g.code,null,{name:'ضيف جديد'});
    assert.equal(joined.players.length,n+1);
    if(kind!=='outsider')await assert.rejects(()=>h.rpc('outsider',stranger,'state',g.code),/WRONG_GAME/);
    await assert.rejects(()=>g.act('claim_host',{},stranger),/HOST_ONLINE/);
    await h.db.query("update private.players set last_seen=now()-interval '70 seconds' where id=$1",[g.state.me]);
    const claimed=await g.act('claim_host',{},stranger);assert.equal(claimed.is_host,true);
    await g.act('remove',{target:[...g.byId.keys()][0]},stranger);
    await assert.rejects(()=>h.rpc(kind,g.users[0],'state',g.code),/NOT_MEMBER/);
    await assert.rejects(()=>h.as(stranger,'select * from private.rooms'),/permission denied/);
    assert.equal((await h.as(g.users[0],'select * from public.room_events where room_id=$1',[g.state.id])).rows.length,0);
  });
}

test('wrong: independent secret questions, all-answer barrier, common question, immutable answers and scores',async()=>{
  const g=await h.group('wrong',4);await g.act('start');
  const questions=[];for(const uid of g.users)questions.push(await g.act('secret',{},uid));
  const counts=new Map();for(const q of questions)counts.set(q.question,(counts.get(q.question)??0)+1);
  assert.deepEqual([...counts.values()].sort(),[1,3]);
  const common=[...counts].find(([,n])=>n===3)[0],oddIndex=questions.findIndex(q=>q.question!==common),ids=[...g.byId.keys()],odd=ids[oddIndex];
  assert.equal(g.state.question,null);assert.equal(g.state.answers,null);
  await assert.rejects(()=>g.act('open_vote'),/WRONG_PHASE/);
  for(let i=0;i<4;i++){
    await g.act('answer',{answer:questions[i].input==='number'?String(20+i):'إجابة '+i},g.users[i]);
    if(i<3){assert.equal(g.state.answers,null);assert.equal(g.state.question,null);}
    if(i===0){await assert.rejects(()=>g.act('answer',{answer:'99'},g.users[0]),/ANSWER_LOCKED/);}
  }
  assert.equal(g.state.phase,'discuss');assert.equal(g.state.question,common);assert.equal(Object.keys(g.state.answers).length,4);assert.equal(g.state.result,null);
  await assert.rejects(()=>g.act('open_vote',{},g.users[1]),/HOST_ONLY/);await g.act('open_vote');
  const votes={};for(let i=0;i<4;i++){const target=i===oddIndex?ids[(i+1)%4]:odd;votes[ids[i]]=target;await g.act('vote',{target},g.users[i]);if(i<3)assert.equal(g.state.result,null);}
  assert.equal(g.state.phase,'result');assert.equal(g.state.result.odd,odd);assert.equal(g.state.result.common,common);
  assert.deepEqual(g.state.result.scores,roundScores(g.state.players,odd,votes));
  const previous=g.state.round;await g.act('start');assert.equal(g.state.question,null);
  await assert.rejects(()=>h.rpc('wrong',g.users[0],'vote',g.code,previous,{step:1,target:odd}),/STALE_ROUND/);
});

test('letters: 28 valid letters, duplicate requests, undo ownership, completion and replay',async()=>{
  const g=await h.group('letters',2);await g.act('start');const question=g.state.question;
  for(const invalid of ['ء','أ','abc',''])await assert.rejects(()=>g.act('letter',{letter:invalid}),/LETTER_INVALID/);
  await g.act('letter',{letter:'ا'});await assert.rejects(()=>g.act('letter',{letter:'ا'},g.users[1]),/LETTER_USED/);
  await assert.rejects(()=>g.act('undo',{letter:'ا'},g.users[1]),/HOST_ONLY/);
  await assert.rejects(()=>g.act('undo',{letter:'ب'}),/STALE_PHASE/);
  await g.act('undo',{letter:'ا'});assert.equal(g.state.used.length,0);
  for(const letter of arabicLetters)await g.act('letter',{letter},g.users[1]);
  assert.equal(g.state.phase,'result');assert.equal(g.state.used.length,28);assert.equal(g.state.question,question);
  await g.act('undo',{letter:arabicLetters.at(-1)});assert.equal(g.state.phase,'letters');
  await g.act('letter',{letter:arabicLetters.at(-1)});await g.act('start');assert.notEqual(g.state.question,question);assert.equal(g.state.used.length,0);
});

test('wave: target isolation, non-giver guesses, full game, scoring, no repeated pairs and replay',async()=>{
  const g=await h.group('wave',3);await g.act('start',{total:4});const pairs=new Set();let score=0;
  for(let turn=1;turn<=4;turn++){
    assert.equal(g.state.turn,turn);assert.equal(g.state.phase,'clue');assert.equal(g.state.target,undefined);assert.equal(g.state.result,null);
    assert.ok(!pairs.has(g.state.pair.id));pairs.add(g.state.pair.id);
    const giver=g.state.giver,uid=g.byId.get(giver),other=g.users.find(u=>u!==uid);
    await assert.rejects(()=>g.act('secret',{},other),/WAVE_GIVER_ONLY/);
    const secret=await g.act('secret',{},uid);assert.ok(secret.target>=0&&secret.target<=100);
    await assert.rejects(()=>g.act('clue',{clue:'خمسة 5'},uid),/WAVE_CLUE/);
    await g.act('clue',{clue:'مثال جميل'},uid);await assert.rejects(()=>g.act('secret',{},uid),/WRONG_PHASE/);
    await assert.rejects(()=>g.act('guess',{value:50},uid),/WAVE_GIVER_GUESS/);
    for(const player of g.users.filter(u=>u!==uid))await g.act('guess',{value:secret.target},player);
    score+=4;assert.equal(g.state.score,score);assert.equal(g.state.result.average,secret.target);
    if(turn<4)await g.act('next');else assert.equal(g.state.phase,'complete');
  }
  await g.act('start',{total:4});assert.equal(g.state.score,0);assert.equal(g.state.history.length,0);
});

async function mafia(n=8,moderator=false){
  const g=await h.group('mafia',n);
  await g.act('start',{config:{moderator,mafia:n>=8?2:1,doctor:true,detective:true,reveal:false},narrator:g.state.me});
  g.roles={};for(const [id,uid] of g.byId)g.roles[id]=await g.act('role',{},uid);
  return g;
}
test('mafia: reveal barrier, instant single detective scan, secret state, handoff barrier, split kill and skip votes',async()=>{
  const g=await mafia();assert.equal(g.state.phase,'reveal');
  await assert.rejects(()=>g.act('night_action',{target:'skip'}),/WRONG_PHASE/);
  for(const uid of g.users)await g.act('ready',{},uid);
  assert.equal(g.state.phase,'night');assert.equal(g.state.deadline,null);
  const ids=Object.keys(g.roles),mafiaIds=ids.filter(id=>g.roles[id].role==='mafia'),citizens=ids.filter(id=>g.roles[id].role==='citizen'),detective=ids.find(id=>g.roles[id].role==='detective');
  let mi=0;for(const id of ids){
    const target=g.roles[id].role==='mafia'?citizens[mi++]:id===detective?mafiaIds[0]:'skip';
    await g.act('night_action',{target},g.byId.get(id));
    if(id===detective){const own=await g.act('role',{},g.byId.get(id));assert.deepEqual(own.scans,[{cycle:1,target:mafiaIds[0],mafia:true}]);await assert.rejects(()=>g.act('night_action',{target:citizens[0]},g.byId.get(id)),/ACTION_LOCKED/);}
    assert.equal(g.state.phase,'night');assert.equal(g.state.deadline,null);assert.equal(g.state.players.find(p=>p.id===id).done,false);
  }
  assert.ok(g.state.players.every(p=>p.role===null));assert.equal(g.state.actions,undefined);assert.equal(g.state.scans,undefined);
  for(let i=0;i<ids.length;i++){await g.act('night_ready',{},g.byId.get(ids[i]));if(i<ids.length-1)assert.equal(g.state.phase,'night');}
  assert.equal(g.state.phase,'day');assert.equal(g.state.players.filter(p=>!p.alive).length,1);assert.ok(g.state.deadline);
  assert.ok(citizens.slice(0,2).includes(g.state.log[0].eliminated));
  await g.act('timer_pause');assert.equal(g.state.timer.paused,true);await g.act('timer_set',{seconds:45});await g.act('timer_resume');
  await g.act('open_vote');const live=g.state.players.filter(p=>p.alive);
  for(const p of live)await g.act('vote',{target:'skip'},g.byId.get(p.id));
  assert.equal(g.state.phase,'night');assert.equal(g.state.cycle,2);assert.deepEqual(g.state.log.at(-1).tally,{skip:live.length});assert.equal(g.state.log.at(-1).eliminated,null);
});

test('mafia human narrator controls phases; roles stay private; doctor protection and town win',async()=>{
  const g=await mafia(6,true),narrator=g.state.narrator_id;
  for(const uid of g.users)await g.act('ready',{},uid);
  assert.equal(g.state.phase,'reveal');await assert.rejects(()=>g.act('begin',{},g.users[1]),/NARRATOR_ONLY/);await g.act('begin');
  const ids=Object.keys(g.roles),maf=ids.find(id=>g.roles[id].role==='mafia'),doc=ids.find(id=>g.roles[id].role==='doctor'),citizen=ids.find(id=>g.roles[id].role==='citizen');
  for(const id of ids.filter(id=>id!==narrator)){await g.act('night_action',{target:[maf,doc].includes(id)?citizen:'skip'},g.byId.get(id));await g.act('night_ready',{},g.byId.get(id));}
  assert.equal(g.state.phase,'night');await g.act('resolve_night');assert.equal(g.state.log[0].eliminated,null);
  const docSecret=await g.act('role',{},g.byId.get(doc));assert.equal(docSecret.last_save,citizen);
  await g.act('open_vote');for(const id of ids.filter(id=>id!==narrator))await g.act('vote',{target:id===maf?'skip':maf},g.byId.get(id));
  await g.act('resolve_vote');assert.equal(g.state.phase,'result');assert.equal(g.state.winner,'town');
  await g.act('start',{config:{moderator:false,mafia:1,doctor:true,detective:true,reveal:false}});assert.equal(g.state.phase,'reveal');assert.ok(g.state.players.every(p=>p.role===null));
});

test('latest outsider result scores are authoritative and remain absent before result',async()=>{
  const g=await h.group('outsider',4);await g.act('start');let odd;const ids=[...g.byId.keys()];
  for(const [id,uid] of g.byId){if((await g.act('role',{},uid)).outsider)odd=id;await g.act('ready',{},uid);}
  await g.act('discuss');await g.act('open_vote');assert.equal(g.state.result,null);const votes={};
  for(const [id,uid] of g.byId){votes[id]=id===odd?ids.find(p=>p!==odd):odd;await g.act('vote',{target:votes[id],score:999},uid);}
  assert.deepEqual([...g.state.result.scores].sort((a,b)=>a.id.localeCompare(b.id)),roundScores(g.state.players,odd,votes).sort((a,b)=>a.id.localeCompare(b.id)));
});
