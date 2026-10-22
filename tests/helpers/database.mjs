import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export async function database({through=999,content=true}={}){
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  const folder=new URL('../../supabase/migrations/',import.meta.url);
  for(const file of (await readdir(folder)).filter(f=>f.endsWith('.sql')&&Number(f.slice(0,3))<=through).sort()){
    try{await db.exec(await readFile(new URL(file,folder),'utf8'));}
    catch(e){await db.close();throw new Error(`${file}: ${e.message}`);}
  }
  if(content)await db.exec(await readFile(new URL('../../supabase/content-update.sql',import.meta.url),'utf8'));
  const user=async()=>{const id=randomUUID();await db.query('insert into auth.users values($1)',[id]);return id;};
  const as=(uid,query,args=[])=>db.transaction(async tx=>{
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid??'']);
    await tx.exec(`set local role ${uid?'authenticated':'anon'}`);
    return tx.query(query,args);
  });
  async function rpc(kind,uid,action,code='',round=null,payload={}){
    const fn=kind==='outsider'?'game_action':['wrong','letters'].includes(kind)?'party_action':`${kind}_action`;
    const args=kind==='outsider'?[action,code,payload.name??payload.phase??null,payload.target??null,round,payload.seconds??120]:[action,code,round,JSON.stringify({...payload,...(['wrong','letters'].includes(kind)?{game:kind}:{})})];
    return (await as(uid,`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) data`,args)).rows[0].data;
  }
  async function group(kind,n){
    const users=[];for(let i=0;i<n;i++)users.push(await user());
    let state=await rpc(kind,users[0],'create','',null,{name:'لاعب 1'});
    for(let i=1;i<n;i++)await rpc(kind,users[i],'join',state.code,null,{name:`لاعب ${i+1}`});
    state=await rpc(kind,users[0],'state',state.code);
    const byId=new Map();for(const uid of users)byId.set((await rpc(kind,uid,'state',state.code)).me,uid);
    const g={kind,users,byId,state,code:state.code};
    g.act=async(action,payload={},uid=users[0])=>{const next=await rpc(kind,uid,action,g.code,g.state.round,{step:g.state.step,...payload});if(next?.phase)g.state=next;return next;};
    return g;
  }
  return {db,user,as,rpc,group};
}
