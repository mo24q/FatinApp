import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database} from './helpers/database.mjs';
import {avalonAction,avalonDefaults,avalonPending,avalonPublic,avalonSecret,avalonRoles,evilCount,failThreshold,newAvalon,questSizes,restoreAvalon} from '../src/lib/avalon-game.ts';
let h;before(async()=>{h=await database();});after(async()=>{await h?.db.close();});
const names=n=>Array.from({length:n},(_,i)=>`لاعب ${i+1}`);
test('Avalon: 5–10 player balance, valid optional roles, one-word names, and private knowledge',()=>{
  for(let n=5;n<=10;n++)for(let mask=0;mask<16;mask++){
    const c=Object.fromEntries(['percival','morgana','mordred','oberon'].map((r,i)=>[r,!!(mask&(1<<i))]));
    if(1+Number(c.morgana)+Number(c.mordred)+Number(c.oberon)>evilCount(n)){assert.throws(()=>newAvalon(names(n),c),/CONFIG/);continue;}
    const g=newAvalon(names(n),c),roles=Object.values(g.roles);assert.equal(roles.filter(r=>avalonRoles[r].evil).length,evilCount(n));assert.equal(roles.filter(r=>r==='merlin').length,1);
    for(const p of g.players){const s=avalonSecret(g,p.id),r=g.roles[p.id];assert.equal(s.role,r);assert.ok(s.known.every(id=>avalonRoles[g.roles[id]].evil));if(r==='merlin')assert.ok(s.known.every(id=>g.roles[id]!=='mordred'));if(r==='oberon'||r==='loyal'||r==='percival')assert.equal(s.known.length,0);if(r==='percival')assert.deepEqual(new Set(s.candidates),new Set(g.players.filter(p=>['merlin','morgana'].includes(g.roles[p.id])).map(p=>p.id)));}
    assert.equal(avalonPublic(g).roles,null);assert.deepEqual(restoreAvalon(JSON.stringify(g)),g);
  }
  for(const r of Object.values(avalonRoles))assert.equal(r.name.split(/\s+/).length,1);
  assert.throws(()=>newAvalon(names(4)),/PLAYERS/);assert.throws(()=>newAvalon(names(11)),/PLAYERS/);
  assert.equal(restoreAvalon('{}'),null);const g=newAvalon(names(5));g.roles.p0='invalid';assert.equal(restoreAvalon(JSON.stringify(g)),null);
});

async function parity(start){let g=start;return {get state(){return g;},async act(actor,action,payload={}){const expected=avalonAction(g,actor,action,payload);const actual=(await h.db.query('select private.avalon_apply($1,$2,$3,$4,$5) g',[JSON.stringify(g),actor,action,JSON.stringify(payload),g.players[0].id])).rows[0].g;assert.deepEqual(actual,expected);g=expected;return g;}};}
for(let n=5;n<=10;n++)test(`Avalon ${n}: complete local/SQL parity through success, assassination and replay`,async()=>{
  const c={...avalonDefaults,percival:true,morgana:true},m=await parity(newAvalon(names(n),c));
  for(const id of avalonPending(m.state))await m.act(id,'ready');
  for(let q=1;q<=3;q++){
    const team=m.state.players.slice(0,questSizes[n][q-1]).map(p=>p.id);await m.act(m.state.players[m.state.leader].id,'propose',{team});
    for(const p of m.state.players)await m.act(p.id,'vote',{approve:true});
    for(const id of team)await m.act(id,'quest',{success:true});assert.equal(m.state.phase,'review');await m.act(m.state.players[0].id,'next');
  }
  assert.equal(m.state.phase,'assassinate');const target=m.state.players.find(p=>m.state.roles[p.id]===(n%2?'merlin':'loyal')).id;
  for(const p of m.state.players)await m.act(p.id,'final',m.state.roles[p.id]==='assassin'?{target}:{});
  assert.equal(m.state.winner,n%2?'evil':'good');assert.equal(m.state.phase,'result');const next=newAvalon(names(n),c,m.state);assert.equal(next.round,2);assert.deepEqual(next.history,[]);
});

test('Avalon: tie rejects, five consecutive rejections win for evil, leadership rotates',async()=>{
  const m=await parity(newAvalon(names(6)));for(const p of m.state.players)await m.act(p.id,'ready');
  for(let round=0;round<5;round++){const leader=m.state.leader;await m.act(m.state.players[leader].id,'propose',{team:['p0','p1']});for(let i=0;i<6;i++)await m.act('p'+i,'vote',{approve:i<3});assert.equal(m.state.leader,(leader+1)%6);assert.equal(m.state.rejects,round+1);}
  assert.equal(m.state.reason,'rejections');assert.equal(m.state.winner,'evil');
});
test('Avalon: three failed missions end the game without assassination; SQL knowledge matches every role',async()=>{
  const initial=newAvalon(names(10),{percival:true,morgana:true,mordred:true,oberon:true});
  for(const p of initial.players){const actual=(await h.db.query('select private.avalon_secret($1,$2) s',[JSON.stringify(initial),p.id])).rows[0].s;assert.deepEqual(actual,avalonSecret(initial,p.id));}
  const m=await parity(initial);for(const p of m.state.players)await m.act(p.id,'ready');
  for(let mission=1;mission<=3;mission++){
    const evil=m.state.players.find(p=>avalonRoles[m.state.roles[p.id]].evil).id;
    const team=[evil,...m.state.players.filter(p=>p.id!==evil).map(p=>p.id)].slice(0,questSizes[10][mission-1]);
    await m.act(m.state.players[m.state.leader].id,'propose',{team});for(const p of m.state.players)await m.act(p.id,'vote',{approve:true});
    assert.equal(m.state.rejects,0);for(const id of team)await m.act(id,'quest',{success:id!==evil});await m.act(m.state.players[0].id,'next');
  }
  assert.equal(m.state.phase,'result');assert.equal(m.state.reason,'quests');assert.equal(m.state.winner,'evil');assert.equal(m.state.target,null);
});
test('Avalon: fourth mission needs two fails at 7+, good cannot fail and invalid actions are rejected',async()=>{
  for(const n of [6,7,10])for(const fails of [1,2]){
    const g=newAvalon(names(n));g.phase='quest';g.mission=4;const bad=g.players.filter(p=>avalonRoles[g.roles[p.id]].evil).map(p=>p.id),good=g.players.filter(p=>!avalonRoles[g.roles[p.id]].evil).map(p=>p.id);g.team=[...bad.slice(0,2),...good].slice(0,questSizes[n][3]);
    const m=await parity(g);for(let i=0;i<g.team.length;i++)await m.act(g.team[i],'quest',{success:i>=fails});assert.equal(m.state.history[0].success,fails<failThreshold(n,4));assert.deepEqual(m.state.cards,{});
    assert.throws(()=>avalonAction(g,good[0],'quest',{success:false}),/GOOD_MUST_SUCCEED/);
    await assert.rejects(()=>h.db.query('select private.avalon_apply($1,$2,$3,$4,$5)',[JSON.stringify(g),good[0],'quest',JSON.stringify({success:false}),g.players[0].id]),/GOOD_MUST_SUCCEED/);
  }
  const g=newAvalon(names(5));assert.throws(()=>avalonAction(g,'p0','propose',{team:['p0','p0']}),/WRONG_PHASE/);
});

test('Avalon online: guests, host controls, private roles, hidden cards, simultaneous votes, stale requests and recovery',async()=>{
  const g=await h.group('avalon',5),stranger=await h.user();
  await assert.rejects(()=>h.rpc('avalon',stranger,'state',g.code),/NOT_MEMBER/);
  await assert.rejects(()=>h.rpc('avalon',null,'state',g.code),/permission denied/);
  await assert.rejects(()=>g.act('start',{},g.users[1]),/HOST_ONLY/);
  await g.act('start',{config:{...avalonDefaults,percival:true,morgana:true}});
  const roleMap={};for(const [id,uid] of g.byId){const s=await g.act('secret',{actor:[...g.byId.keys()].find(other=>other!==id)},uid);roleMap[id]=s.role;assert.ok(avalonRoles[s.role]);}
  assert.equal(g.state.roles,null);assert.ok(!('cards'in g.state)&&!('ballots'in g.state));
  for(const uid of g.users)await g.act('ready',{},uid);
  const leader=g.state.players[g.state.leader].id,team=g.state.players.slice(0,2).map(p=>p.id);
  await assert.rejects(()=>g.act('propose',{team},g.users.find(u=>u!==g.byId.get(leader))),/LEADER_ONLY/);
  await g.act('propose',{team},g.byId.get(leader));const ballotStep=g.state.step;
  await g.act('vote',{approve:true},g.users[0]);assert.equal(g.state.vote_history.length,0);
  await g.act('vote',{approve:true},g.users[0]);await assert.rejects(()=>g.act('vote',{approve:false},g.users[0]),/ACTION_LOCKED/);
  await Promise.all(g.users.slice(1).map(uid=>h.rpc('avalon',uid,'vote',g.code,g.state.round,{step:ballotStep,approve:true})));
  await g.act('state');assert.equal(g.state.phase,'quest');assert.equal(Object.keys(g.state.vote_history[0].votes).length,5);
  await assert.rejects(()=>h.rpc('avalon',g.users[0],'vote',g.code,g.state.round,{step:ballotStep,approve:true}),/STALE_PHASE/);
  await assert.rejects(()=>g.act('quest',{success:true},g.byId.get(g.state.players.find(p=>!team.includes(p.id)).id)),/TEAM_ONLY/);
  for(const id of team)await g.act('quest',{success:true},g.byId.get(id));assert.equal(g.state.history[0].fails,0);assert.ok(!JSON.stringify(g.state).includes('"cards"'));
  const originalHost=g.users[0];await h.db.query("update private.players set last_seen=now()-interval '70 seconds' where room_id=$1 and user_id=$2",[g.state.id,originalHost]);
  await g.act('claim_host',{},g.users[1]);await g.act('next',{},g.users[1]);assert.equal(g.state.mission,2);
  await assert.rejects(()=>g.act('cancel',{},originalHost),/HOST_ONLY/);await g.act('cancel',{},g.users[1]);assert.equal(g.state.phase,'lobby');
  const join=await h.rpc('outsider',stranger,'join',g.code,null,{name:'ضيف جديد'});assert.equal(join.game,'avalon');
  await assert.rejects(()=>h.as(stranger,'select * from private.avalon_sessions'),/permission denied/);
  const badACL=await h.db.query("select proname from pg_proc where pronamespace='private'::regnamespace and proname like 'avalon_%' and (has_function_privilege('authenticated',oid,'EXECUTE') or has_function_privilege('anon',oid,'EXECUTE'))");assert.deepEqual(badACL.rows,[]);
});
test('Avalon upgrade is repeatable, retains active games, and caps rooms at ten',async()=>{
  const g=await h.group('avalon',10);await g.act('start',{config:{percival:true,morgana:true,mordred:true,oberon:true}});const own=await g.act('secret');
  const sql=await readFile(new URL('../supabase/migrations/010_avalon.sql',import.meta.url),'utf8');await h.db.exec(sql);await h.db.exec(sql);assert.deepEqual(await g.act('secret'),own);
  const extra=await h.user();await assert.rejects(()=>h.rpc('avalon',extra,'join',g.code,null,{name:'إضافي'}),/AVALON_FULL/);
});
