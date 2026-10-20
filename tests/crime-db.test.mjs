import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {crimeCards} from '../src/lib/crime-content.ts';
let db;
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  for(const file of ['migrations/001_lamma.sql','fatin-crime-upgrade.sql'])await db.exec(await readFile(new URL(`../supabase/${file}`,import.meta.url),'utf8'));
});
after(async()=>{await db?.close();});
async function user(){const id=randomUUID();await db.query('insert into auth.users values($1)',[id]);return id;}
async function as(uid,query,args=[]){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid??'']);await db.exec(`set role ${uid?'authenticated':'anon'}`);
  try{return await db.query(query,args);}finally{await db.exec('reset role');}
}
async function rpc(uid,action,code='',round=null,payload={}){
  return (await as(uid,'select public.crime_action($1,$2,$3,$4) as data',[action,code,round,JSON.stringify(payload)])).rows[0].data;
}
async function old(uid,action,code='',round=null,name=null){
  return (await as(uid,'select public.game_action($1,$2,$3,null,$4,120) as data',[action,code,name,round])).rows[0].data;
}
async function group(n=4){
  const users=[];for(let i=0;i<n;i++)users.push(await user());
  let room=await rpc(users[0],'create','',null,{name:'المضيف'});
  for(let i=1;i<n;i++)await rpc(users[i],'join',room.code,null,{name:`لاعب ${i}`});
  room=await rpc(users[0],'state',room.code);
  const byId=new Map();
  for(const u of users){const s=await rpc(u,'state',room.code);byId.set(s.me,u);}
  return {users,room,code:room.code,byId};
}
async function start(g,narrator=g.room.me){
  const state=await rpc(g.users[0],'state',g.code);
  g.room=await rpc(g.users[0],'start',g.code,state.round,{narrator});
  g.roles=[];
  for(const [id,uid] of g.byId)g.roles.push({id,uid,...await rpc(uid,'role',g.code,g.room.round)});
  g.killer=g.roles.find(p=>p.role==='killer');g.narrator=g.roles.find(p=>p.role==='narrator');g.investigator=g.roles.find(p=>p.role==='investigator');
  g.hand=g.room.hands.find(h=>h.player_id===g.killer.id);
  return g.room;
}
async function investigate(g){
  await start(g);
  await rpc(g.killer.uid,'choose',g.code,g.room.round,{weapon:g.hand.weapons[0],evidence:g.hand.evidence[0]});
  for(const u of g.users)await rpc(u,'ready',g.code,g.room.round);
  return rpc(g.users[0],'investigate',g.code,g.room.round);
}
test('migration seeded the same 128 cards; old game and universal join still work',async()=>{
  const rows=(await db.query('select id,kind,name from private.crime_cards order by id')).rows;
  assert.deepEqual(rows,crimeCards.map(({id,kind,name})=>({id,kind,name})).sort((a,b)=>a.id.localeCompare(b.id)));
  const uid=await user(),room=await old(uid,'create','',null,'برا السالفة');
  assert.equal((await old(uid,'state',room.code)).phase,'lobby');
  await assert.rejects(()=>rpc(uid,'state',room.code),/WRONG_GAME/);
  const g=await group(),extra=await user();
  assert.equal((await old(extra,'join',g.code,null,'ضيف جديد')).game,'crime');
  await assert.rejects(()=>old(g.users[0],'start',g.code,0),/WRONG_GAME/);
});
test('auth, room membership, private tables and internal functions are protected',async()=>{
  const g=await group(),outsider=await user();
  await assert.rejects(()=>rpc(null,'create','',null,{name:'زائر'}),/permission denied/);
  for(const action of ['state','role','choose','start','clue','accuse'])await assert.rejects(()=>rpc(outsider,action,g.code,0),/NOT_MEMBER/);
  await assert.rejects(()=>as(g.users[0],'select * from private.crime_rounds'),/permission denied/);
  await assert.rejects(()=>as(g.users[0],'select private.crime_state($1,$2)',[g.room.id,g.users[0]]),/permission denied/);
  assert.equal((await as(outsider,'select * from public.room_events where room_id=$1',[g.room.id])).rows.length,0);
});
test('minimum players, valid narrator, host-only start and no late joins',async()=>{
  const g=await group(3);
  await assert.rejects(()=>rpc(g.users[0],'start',g.code,0,{narrator:g.room.me}),/CRIME_NEED_PLAYERS/);
  const extra=await user();await rpc(extra,'join',g.code,null,{name:'رابع'});
  await assert.rejects(()=>rpc(g.users[1],'start',g.code,0,{narrator:g.room.me}),/HOST_ONLY/);
  await assert.rejects(()=>rpc(g.users[0],'start',g.code,0,{narrator:randomUUID()}),/INVALID_NARRATOR/);
  await rpc(g.users[0],'start',g.code,0,{narrator:g.room.me});
  const late=await user();
  await assert.rejects(()=>rpc(late,'join',g.code,null,{name:'متأخر'}),/ROUND_IN_PROGRESS/);
});
test('one killer, distinct narrator, unique hands and no secret in public state',async()=>{
  const g=await group(12);await start(g);
  assert.equal(g.roles.filter(r=>r.role==='killer').length,1);assert.equal(g.roles.filter(r=>r.role==='narrator').length,1);
  assert.equal(g.room.hands.length,11);assert.equal(new Set(g.room.hands.flatMap(h=>[...h.weapons,...h.evidence])).size,88);
  for(const u of g.users) {
    const s=await rpc(u,'state',g.code);
    assert.equal(s.killer_id,undefined);assert.equal(s.solution,undefined);assert.equal(s.result,null);
    assert.equal(s.players.some(p=>'role'in p),false);
  }
});
test('only killer chooses from their own cards; secret immutable and narrator-only visibility',async()=>{
  const g=await group();await start(g);
  const payload={weapon:g.hand.weapons[0],evidence:g.hand.evidence[0]};
  await assert.rejects(()=>rpc(g.investigator.uid,'choose',g.code,1,payload),/KILLER_ONLY/);
  const other=g.room.hands.find(h=>h.player_id!==g.killer.id);
  await assert.rejects(()=>rpc(g.killer.uid,'choose',g.code,1,{...payload,weapon:other.weapons[0]}),/INVALID_CARDS/);
  await rpc(g.killer.uid,'choose',g.code,1,payload);
  await rpc(g.killer.uid,'choose',g.code,1,payload);
  await assert.rejects(()=>rpc(g.killer.uid,'choose',g.code,1,{...payload,weapon:g.hand.weapons[1]}),/SOLUTION_LOCKED/);
  assert.equal((await rpc(g.narrator.uid,'role',g.code,1)).solution.killer_id,g.killer.id);
  assert.equal((await rpc(g.investigator.uid,'role',g.code,1,{actor:g.narrator.id})).solution,null);
  assert.equal((await rpc(g.users[0],'state',g.code)).result,null);
});
test('all players ready and solution required before investigation; repeat ready safe',async()=>{
  const g=await group();await start(g);
  await assert.rejects(()=>rpc(g.killer.uid,'ready',g.code,1),/SOLUTION_REQUIRED/);
  await assert.rejects(()=>rpc(g.users[0],'investigate',g.code,1),/SOLUTION_REQUIRED/);
  await rpc(g.killer.uid,'choose',g.code,1,{weapon:g.hand.weapons[0],evidence:g.hand.evidence[0]});
  await assert.rejects(()=>rpc(g.users[0],'investigate',g.code,1),/NOT_READY/);
  for(const u of g.users){await rpc(u,'ready',g.code,1);await rpc(u,'ready',g.code,1);}
  assert.equal((await rpc(g.users[0],'investigate',g.code,1)).phase,'investigate');
});
test('narrator controls clues and closure independently of host',async()=>{
  const g=await group(),narratorId=[...g.byId.keys()][1];await start(g,narratorId);
  await rpc(g.killer.uid,'choose',g.code,1,{weapon:g.hand.weapons[0],evidence:g.hand.evidence[0]});
  for(const u of g.users)await rpc(u,'ready',g.code,1);
  await rpc(g.users[0],'investigate',g.code,1);
  await assert.rejects(()=>rpc(g.users[0],'clue',g.code,1,{board:'place',choice:'منزل'}),/NARRATOR_ONLY/);
  await assert.rejects(()=>rpc(g.narrator.uid,'clue',g.code,1,{board:'place',choice:'اسم المجرم'}),/INVALID_CLUE/);
  assert.equal((await rpc(g.narrator.uid,'clue',g.code,1,{board:'place',choice:'منزل'})).clues.place,'منزل');
  assert.equal((await rpc(g.narrator.uid,'close',g.code,1)).result.caught,false);
});
test('accusation uses authenticated actor, cannot target self, and needs matching hand',async()=>{
  const g=await group();await investigate(g);
  const good={target:g.killer.id,weapon:g.hand.weapons[0],evidence:g.hand.evidence[0]};
  await assert.rejects(()=>rpc(g.narrator.uid,'accuse',g.code,1,{...good,actor:g.investigator.id}),/INVALID_ACCUSATION/);
  await assert.rejects(()=>rpc(g.killer.uid,'accuse',g.code,1,good),/INVALID_ACCUSATION/);
  await assert.rejects(()=>rpc(g.investigator.uid,'accuse',g.code,1,{...good,weapon:'w999'}),/INVALID_CARDS/);
  const result=await rpc(g.investigator.uid,'accuse',g.code,1,good);
  assert.equal(result.phase,'result');assert.equal(result.result.caught,true);
  assert.equal(result.result.killer_id,g.killer.id);
});
test('wrong accusation stays private about correctness parts; retries do not spend another attempt',async()=>{
  const g=await group();await investigate(g);
  const payload={target:g.killer.id,weapon:g.hand.weapons[1],evidence:g.hand.evidence[0]};
  const s=await rpc(g.investigator.uid,'accuse',g.code,1,payload);
  assert.equal(s.phase,'investigate');assert.equal(s.result,null);assert.equal(s.accusations[0].correct,false);
  assert.equal((await rpc(g.investigator.uid,'accuse',g.code,1,payload)).accusations.length,1);
  await assert.rejects(()=>rpc(g.investigator.uid,'accuse',g.code,1,{...payload,weapon:g.hand.weapons[0]}),/ALREADY_ACCUSED/);
});
test('every non-narrator can spend one attempt; exhausted attempts finish the case',async()=>{
  const g=await group();await investigate(g);let state;
  for(const role of g.roles.filter(r=>r.role!=='narrator')){
    const target=g.room.hands.find(h=>h.player_id!==role.id&&h.player_id!==g.killer.id)??g.room.hands.find(h=>h.player_id!==role.id);
    state=await rpc(role.uid,'accuse',g.code,1,{target:target.player_id,weapon:target.weapons[3],evidence:target.evidence[3]});
  }
  assert.equal(state.phase,'result');assert.equal(state.result.caught,false);
});
test('host timer controls, stale round and phase guards; expiration does not reveal secrets',async()=>{
  const g=await group();await investigate(g);
  await assert.rejects(()=>rpc(g.users[1],'timer_enable',g.code,1,{phase:'investigate'}),/HOST_ONLY/);
  await assert.rejects(()=>rpc(g.users[0],'timer_enable',g.code,0,{phase:'investigate'}),/STALE_ROUND/);
  await assert.rejects(()=>rpc(g.users[0],'timer_enable',g.code,1,{phase:'reveal'}),/STALE_PHASE/);
  await rpc(g.users[0],'timer_enable',g.code,1,{phase:'investigate'});
  await rpc(g.users[0],'timer_pause',g.code,1,{phase:'investigate'});
  let s=await rpc(g.users[0],'timer_set',g.code,1,{phase:'investigate',seconds:45});
  assert.equal(s.timer.remaining_seconds,45);assert.equal(s.deadline,null);
  await rpc(g.users[0],'timer_resume',g.code,1,{phase:'investigate'});
  await db.query("update private.rooms set deadline=now()-interval '5 seconds' where id=$1",[g.room.id]);
  s=await rpc(g.users[0],'state',g.code);assert.equal(s.phase,'investigate');assert.equal(s.result,null);
});
test('cancel hides hands/solution; stale actions cannot affect replay; membership survives reconnect',async()=>{
  const g=await group();await investigate(g);const old=g.killer.id;
  const cancelled=await rpc(g.users[0],'cancel',g.code,1);
  assert.equal(cancelled.phase,'lobby');assert.deepEqual(cancelled.hands,[]);assert.equal(cancelled.result,null);
  await assert.rejects(()=>rpc(g.killer.uid,'role',g.code,1),/WRONG_PHASE/);
  await start(g);assert.notEqual(g.killer.id,old);assert.equal(g.room.round,2);
  await assert.rejects(()=>rpc(g.killer.uid,'choose',g.code,1,{weapon:g.hand.weapons[0],evidence:g.hand.evidence[0]}),/STALE_ROUND/);
  const again=await rpc(g.users[1],'join',g.code,null,{name:'اسم مختلف'});assert.equal(again.players.length,4);
});
test('host transfer gives no role powers, active removals are forbidden, departed access revoked',async()=>{
  const g=await group();await investigate(g);
  await assert.rejects(()=>rpc(g.users[0],'remove',g.code,1,{target:g.investigator.id}),/CANNOT_REMOVE/);
  await db.query("update private.players set last_seen=now()-interval '70 seconds' where id=$1",[g.room.me]);
  const transferred=await rpc(g.investigator.uid,'claim_host',g.code,1);assert.equal(transferred.is_host,true);
  assert.equal((await rpc(g.investigator.uid,'role',g.code,1)).solution,null);
  await rpc(g.investigator.uid,'cancel',g.code,1);
  await rpc(g.killer.uid,'leave',g.code,1);
  await assert.rejects(()=>rpc(g.killer.uid,'state',g.code),/NOT_MEMBER/);
});
test('re-running additive migration preserves active crime and original game dispatch',async()=>{
  const g=await group();await investigate(g);
  const before=await rpc(g.narrator.uid,'role',g.code,1);
  await db.exec(await readFile(new URL('../supabase/migrations/003_closed_case.sql',import.meta.url),'utf8'));
  assert.deepEqual(await rpc(g.narrator.uid,'role',g.code,1),before);
  assert.equal((await rpc(g.users[0],'state',g.code)).phase,'investigate');
  const uid=await user();assert.equal((await old(uid,'create','',null,'غرفة ثانية')).phase,'lobby');
});
test('repeated combined upgrade preserves existing games and dispatch',async()=>{
  const g=await group();await investigate(g);
  const before=await rpc(g.narrator.uid,'role',g.code,1);
  const upgrade=await readFile(new URL('../supabase/fatin-crime-upgrade.sql',import.meta.url),'utf8');
  for(let i=0;i<2;i++)await db.exec(upgrade);
  assert.deepEqual(await rpc(g.narrator.uid,'role',g.code,1),before);
  assert.equal((await rpc(g.users[0],'state',g.code)).phase,'investigate');
  await assert.rejects(()=>old(g.users[0],'state',g.code),/WRONG_GAME/);
  const uid=await user();
  const outsider=await old(uid,'create','',null,'اختبار التحديث');
  assert.equal(outsider.phase,'lobby');
  assert.equal((await old(uid,'state',outsider.code)).timer_version,2);
});
