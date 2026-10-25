import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database} from './helpers/database.mjs';
const migration=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const repair=await migration('009_foundation_repair.sql');
const games=[['outsider',3],['crime',4],['mafia',5],['wave',2],['wrong',4],['letters',1]];

async function startGames(h){
  const groups=[],stranger=await h.user();
  for(const [kind,n] of games){
    const g=await h.group(kind,n);
    await g.act('start',kind==='crime'?{narrator:g.state.me}:kind==='mafia'?{config:{moderator:false,mafia:1,doctor:true,detective:true,reveal:false}}:kind==='wave'?{total:4}:{});
    assert.equal(g.state.round,1);assert.notEqual(g.state.phase,'lobby');
    await assert.rejects(()=>h.rpc(kind,null,'state',g.code),/permission denied/);
    await assert.rejects(()=>h.rpc(kind,stranger,'state',g.code),/NOT_MEMBER/);
    groups.push(g);
  }
  return groups;
}

test('009 repairs the observed 001 + 008 installation; all six games start and private functions stay inaccessible',async()=>{
  const h=await database({through:1,content:false});
  try{
    await h.db.exec(await migration('008_readiness.sql'));
    const user=await h.user();
    await assert.rejects(()=>h.rpc('outsider',user,'create','',null,{name:'فحص'}),/outsider_action_v2/);
    await assert.rejects(()=>h.rpc('wrong',user,'create','',null,{name:'فحص'}),/game_action_v1/);
    await assert.rejects(()=>h.rpc('crime',user,'create','',null,{name:'فحص'}),/crime_action/);
    await h.db.exec(repair);
    const groups=await startGames(h);
    const outsider=groups[0];
    for(const uid of outsider.users){const own=await outsider.act('role',{},uid);assert.ok(own);}
    const forbidden=await h.db.query(`select p.oid::regprocedure::text signature from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
      and (has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE'))`);
    assert.deepEqual(forbidden.rows,[]);
    await assert.rejects(()=>h.as(user,"select private.game_action_v1('create','','فحص',null,null,120)"),/permission denied/);
    await assert.rejects(()=>h.as(user,'select * from private.crime_rounds'),/permission denied/);
  }finally{await h.db.close();}
});

for(const through of [1,2,3,8]){
  test(`009 repairs baseline ${through} and preserves custom content, secrets and active games on repeat`,async()=>{
    const h=await database({through,content:false});
    try{
      const existing=await h.group('outsider',3);await existing.act('start');
      const secret=await existing.act('role');
      await h.db.exec(repair);
      assert.deepEqual(await existing.act('role'),secret);
      const groups=await startGames(h);
      await h.db.exec(`update private.crime_cards set name='اسم خاص' where id='w01';
        update private.crime_clues set options='["خيار خاص"]' where id=(select id from private.crime_clues limit 1);
        update private.party_bank set a='سؤال خاص' where game='wrong' and id=0;
        update private.wave_pairs set low_label='طرف خاص' where id=0;
        insert into private.words(category,word) values('خاص','كلمة خاصة بالفحص');`);
      const snapshot=async()=>{
        const tables=['rooms','players','rounds','round_players','votes','crime_rounds','mafia_sessions','wave_sessions','party_sessions','crime_cards','crime_clues','party_bank','wave_pairs','words'];
        const result={};for(const table of tables)result[table]=(await h.db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') data from private.${table} t`)).rows[0].data;
        return result;
      };
      const before=await snapshot();
      await h.db.exec(repair);await h.db.exec(repair);
      assert.deepEqual(await snapshot(),before);
      for(const g of groups){assert.equal((await g.act('state')).round,1);}
      assert.deepEqual(await existing.act('role'),secret);
    }finally{await h.db.close();}
  });
}
