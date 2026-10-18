import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

let db;
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/001_lamma.sql',import.meta.url),'utf8'));
});
after(async () => { await db?.close(); });

async function user() {
  const id=randomUUID(); await db.query('insert into auth.users(id) values($1)',[id]); return id;
}
async function as(uid, query, params=[]) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid || '']);
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  try { return await db.query(query,params); }
  finally { await db.exec('reset role'); }
}
async function rpc(uid, kind, code='', extra={}) {
  const {rows} = await as(uid,'select public.game_action($1,$2,$3,$4,$5,$6) as data',[
    kind,code,extra.name ?? null,extra.target ?? null,extra.round ?? null,extra.seconds ?? 120
  ]); return rows[0].data;
}
async function group(count=3) {
  const users=await Promise.all(Array.from({length:count},()=>user()));
  const room=await rpc(users[0],'create','',{name:'مضيف اللمة'});
  for(let i=1;i<count;i++) await rpc(users[i],'join',room.code,{name:`لاعب ${i}`});
  const state=await rpc(users[0],'state',room.code);
  return {users,code:room.code,ids:state.players.map(p=>p.id),state};
}
async function start(g) {
  const current=await rpc(g.users[0],'state',g.code);
  return rpc(g.users[0],'start',g.code,{round:current.round});
}
async function voting(g) {
  const state=await start(g);
  for(const u of g.users) await rpc(u,'ready',g.code,{round:state.round});
  await rpc(g.users[0],'discuss',g.code,{round:state.round});
  return rpc(g.users[0],'open_vote',g.code,{round:state.round});
}

test('migration installs; guests create and join with short codes and persisted identity',async()=>{
  const g=await group(); assert.match(g.code,/^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(g.state.players.length,3); assert.equal(g.state.is_host,true);
  const other=await rpc(g.users[1],'state',g.code);
  assert.equal(other.is_host,false); assert.notEqual(other.me,g.state.me);
  const rejoin=await rpc(g.users[1],'join',g.code.toLowerCase(),{name:'اسم جديد'});
  assert.equal(rejoin.players.length,3); assert.equal(rejoin.me,other.me);
});
test('anonymous API key alone cannot call game RPC; missing auth uid is rejected',async()=>{
  await assert.rejects(()=>rpc(null,'create','',{name:'زائر'}),/permission denied/);
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(()=>db.query("select public.game_action('create','','زائر')"),/AUTH_REQUIRED/);
  await db.exec('reset role');
});
test('validates names, duration and minimum players on the server',async()=>{
  const u=await user();
  await assert.rejects(()=>rpc(u,'create','',{name:'x'}),/NAME_INVALID/);
  await assert.rejects(()=>rpc(u,'create','',{name:'a'.repeat(21)}),/NAME_INVALID/);
  await assert.rejects(()=>rpc(u,'create','',{name:'اسم',seconds:1}),/INVALID_SECONDS/);
  const r=await rpc(u,'create','',{name:'اسم صحيح'});
  await assert.rejects(()=>rpc(u,'start',r.code,{round:0}),/NEED_PLAYERS/);
});
test('duplicate names and late joins are rejected; reconnection during a round is allowed',async()=>{
  const g=await group(); const stranger=await user();
  await assert.rejects(()=>rpc(stranger,'join',g.code,{name:'لاعب 1'}),/NAME_TAKEN/);
  await start(g);
  await assert.rejects(()=>rpc(stranger,'join',g.code,{name:'متأخر'}),/ROUND_IN_PROGRESS/);
  const again=await rpc(g.users[1],'join',g.code,{name:'لاعب 1'});
  assert.equal(again.phase,'reveal'); assert.equal(again.players.length,3);
});
test('exactly one outsider; all others share a word; state never contains any role or word',async()=>{
  const g=await group(4); const r=await start(g); const roles=[];
  for(const u of g.users) roles.push(await rpc(u,'role',g.code,{round:r.round,target:g.ids[0]}));
  assert.equal(roles.filter(x=>x.outsider).length,1);
  assert.equal(roles.find(x=>x.outsider).word,null);
  assert.equal(new Set(roles.filter(x=>!x.outsider).map(x=>x.word)).size,1);
  assert.equal(new Set(roles.map(x=>x.category)).size,1);
  for(const u of g.users) {
    const s=await rpc(u,'state',g.code); assert.equal(s.result,null);
    assert.ok(!JSON.stringify(s).includes('outsider')); assert.ok(!JSON.stringify(s).includes('word'));
    assert.ok(!JSON.stringify(s).includes(roles.find(x=>!x.outsider).word));
  }
});
test('nonmembers cannot fetch state, role or issue actions even with a valid room code',async()=>{
  const g=await group(); await start(g); const u=await user();
  for(const kind of ['state','role','ready','start','vote','claim_host']) await assert.rejects(()=>rpc(u,kind,g.code,{round:1}),/NOT_MEMBER/);
});
test('host authority, ready barrier, and stale round guard are enforced',async()=>{
  const g=await group();
  await assert.rejects(()=>rpc(g.users[1],'start',g.code,{round:0}),/HOST_ONLY/);
  await start(g);
  await assert.rejects(()=>rpc(g.users[0],'discuss',g.code,{round:1}),/NOT_READY/);
  for(const u of g.users) await rpc(u,'ready',g.code,{round:1});
  await assert.rejects(()=>rpc(g.users[1],'discuss',g.code,{round:1}),/HOST_ONLY/);
  await rpc(g.users[0],'discuss',g.code,{round:1});
  await assert.rejects(()=>rpc(g.users[0],'open_vote',g.code,{round:0}),/STALE_ROUND/);
  await assert.rejects(()=>rpc(g.users[0],'role',g.code,{round:0}),/STALE_ROUND/);
});
test('one immutable vote, no self vote, no foreign target; interim totals hide selections',async()=>{
  const g=await group(); await voting(g);
  await assert.rejects(()=>rpc(g.users[0],'vote',g.code,{round:1,target:g.ids[0]}),/INVALID_VOTE/);
  await assert.rejects(()=>rpc(g.users[0],'vote',g.code,{round:1,target:randomUUID()}),/INVALID_VOTE/);
  const s=await rpc(g.users[0],'vote',g.code,{round:1,target:g.ids[1]});
  assert.equal(s.voted,true); assert.equal(s.votes_count,1); assert.equal(s.result,null);
  await assert.rejects(()=>rpc(g.users[0],'vote',g.code,{round:1,target:g.ids[2]}),/ALREADY_VOTED/);
  const other=await rpc(g.users[2],'state',g.code); assert.equal(other.my_vote,null); assert.equal(other.voted,false);
  await assert.rejects(()=>rpc(g.users[0],'finish_vote',g.code,{round:1}),/VOTING_OPEN/);
});
test('majority catching outsider reveals word and counts only after all votes',async()=>{
  const g=await group(4); await voting(g);
  let outsider;
  for(let i=0;i<4;i++) if((await rpc(g.users[i],'role',g.code,{round:1})).outsider) outsider=i;
  let s;
  for(let i=0;i<4;i++) s=await rpc(g.users[i],'vote',g.code,{round:1,target:g.ids[i===outsider ? (i+1)%4 : outsider]});
  assert.equal(s.phase,'result'); assert.equal(s.result.caught,true); assert.equal(s.result.outsider_id,g.ids[outsider]);
  assert.ok(s.result.word); assert.equal(s.result.votes.reduce((sum,v)=>sum+v.count,0),4);
});
test('ties and zero votes let the outsider win; expired votes settle on a read',async()=>{
  const g=await group(); await voting(g);
  for(let i=0;i<3;i++) await rpc(g.users[i],'vote',g.code,{round:1,target:g.ids[(i+1)%3]});
  const tied=await rpc(g.users[0],'state',g.code); assert.equal(tied.result.tied,true); assert.equal(tied.result.caught,false);
  const h=await group(); await voting(h);
  await db.query("update private.rooms set deadline=now()-interval '1 second' where code=$1",[h.code]);
  const result=await rpc(h.users[1],'state',h.code);
  assert.equal(result.phase,'result'); assert.equal(result.result.caught,false); assert.equal(result.votes_count,0);
});
test('replay chooses a different word and outsider; stale votes cannot affect next round',async()=>{
  const g=await group(); await voting(g);
  await db.query("update private.rooms set deadline=now()-interval '1 second' where code=$1",[g.code]);
  const old=await rpc(g.users[0],'state',g.code); const next=await start(g);
  assert.equal(next.round,2); assert.equal(next.votes_count,0); assert.equal(next.result,null);
  for(let i=0;i<3;i++) {
    const role=await rpc(g.users[i],'role',g.code,{round:2});
    if(role.outsider) assert.notEqual(g.ids[i],old.result.outsider_id);
    else assert.notEqual(role.word,old.result.word);
  }
  await assert.rejects(()=>rpc(g.users[1],'vote',g.code,{round:1,target:g.ids[0]}),/STALE_ROUND/);
});
test('server presence checks block starting with absent players; host takeover requires 60s absence',async()=>{
  const g=await group();
  await assert.rejects(()=>rpc(g.users[1],'claim_host',g.code),/HOST_ONLINE/);
  await db.query("update private.players set last_seen=now()-interval '61 seconds' where id=$1",[g.ids[0]]);
  const s=await rpc(g.users[1],'claim_host',g.code); assert.equal(s.is_host,true);
  await assert.rejects(()=>rpc(g.users[1],'start',g.code,{round:0}),/PLAYER_OFFLINE/);
  await rpc(g.users[0],'state',g.code);
  const started=await rpc(g.users[1],'start',g.code,{round:0}); assert.equal(started.phase,'reveal');
  await assert.rejects(()=>rpc(g.users[0],'cancel',g.code,{round:1}),/HOST_ONLY/);
});
test('cancel hides roles; removes only between rounds; removed user immediately loses access',async()=>{
  const g=await group(); await start(g);
  await assert.rejects(()=>rpc(g.users[0],'remove',g.code,{round:1,target:g.ids[1]}),/CANNOT_REMOVE/);
  const lobby=await rpc(g.users[0],'cancel',g.code,{round:1}); assert.equal(lobby.phase,'lobby'); assert.equal(lobby.result,null);
  await assert.rejects(()=>rpc(g.users[0],'role',g.code,{round:1}),/WRONG_PHASE/);
  await rpc(g.users[0],'remove',g.code,{round:1,target:g.ids[1]});
  await assert.rejects(()=>rpc(g.users[1],'state',g.code),/NOT_MEMBER/);
  assert.equal((await as(g.users[1],'select * from public.room_events')).rows.length,0);
});
test('RLS protects Realtime membership; all direct secret table/function access is denied',async()=>{
  const g=await group(); const stranger=await user();
  const events=await as(g.users[0],'select * from public.room_events'); assert.equal(events.rows.length,1);
  assert.deepEqual(Object.keys(events.rows[0]).sort(),['revision','room_id']);
  assert.equal((await as(stranger,'select * from public.room_events')).rows.length,0);
  for(const table of ['rooms','players','rounds','round_players','votes','words','guest_limits']) await assert.rejects(()=>as(g.users[0],`select * from private.${table}`),/permission denied/);
  await assert.rejects(()=>as(g.users[0],"select private.room_state($1,$2)",[g.state.id,g.users[1]]),/permission denied/);
  await assert.rejects(()=>as(g.users[0],"update public.room_events set revision=999"),/permission denied/);
  await assert.rejects(()=>as(null,'select * from public.room_events'),/permission denied/);
});
test('maximum 12 players and live room TTL are enforced',async()=>{
  const g=await group(12); const u=await user();
  await assert.rejects(()=>rpc(u,'join',g.code,{name:'زائد'}),/ROOM_FULL/);
  await db.query("update private.rooms set expires_at=now()-interval '1 second' where code=$1",[g.code]);
  await assert.rejects(()=>rpc(g.users[0],'state',g.code),/ROOM_NOT_FOUND/);
  assert.equal((await as(g.users[0],'select * from public.room_events')).rows.length,0);
  await db.exec('select private.cleanup_expired_rooms()');
  assert.equal((await db.query('select * from private.rooms where code=$1',[g.code])).rows.length,0);
});
test('leaving transfers host and revokes old membership',async()=>{
  const g=await group();
  await rpc(g.users[0],'leave',g.code,{round:0});
  await assert.rejects(()=>rpc(g.users[0],'state',g.code),/NOT_MEMBER/);
  const states=[]; for(const u of g.users.slice(1)) states.push(await rpc(u,'state',g.code));
  assert.equal(states.filter(s=>s.is_host).length,1); assert.equal(states[0].players.length,2);
});
test('creation quota survives leaving and deleting rooms',async()=>{
  const u=await user();
  for(let i=0;i<5;i++) {
    const r=await rpc(u,'create','',{name:'مضيف'});
    await rpc(u,'leave',r.code,{round:0});
  }
  await assert.rejects(()=>rpc(u,'create','',{name:'مضيف'}),/CREATE_LIMIT/);
  await db.query("update private.guest_limits set window_start=now()-interval '61 minutes' where user_id=$1",[u]);
  assert.equal((await rpc(u,'create','',{name:'مضيف'})).phase,'lobby');
});
