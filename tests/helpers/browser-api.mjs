// Loopback-only test adapter. Runs the real migrations/RPC/RLS in PGlite.
// It does NOT emulate GoTrue JWT verification or Realtime infrastructure.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {database} from './database.mjs';
export async function browserApi(){
  const h=await database(),tokens=new Map(),refresh=new Map();
  function session(uid){
    const now=Math.floor(Date.now()/1000),payload={sub:uid,aud:'authenticated',role:'authenticated',iat:now,exp:now+3600};
    const token=Buffer.from(JSON.stringify({alg:'TEST'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.'+randomUUID();
    const refresh_token=randomUUID();tokens.set(token,uid);refresh.set(refresh_token,uid);
    return {access_token:token,refresh_token,token_type:'bearer',expires_in:3600,expires_at:now+3600,user:{id:uid,aud:'authenticated',role:'authenticated',created_at:new Date().toISOString(),app_metadata:{provider:'anonymous',providers:['anonymous']},user_metadata:{},identities:[],is_anonymous:true}};
  }
  const server=createServer(async(req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:3035');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Content-Type','application/json');
    const send=(code,data)=>{res.writeHead(code);res.end(JSON.stringify(data));};
    if(req.method==='OPTIONS'){send(200,{});return;}
    try{
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16000)throw new Error('BODY_TOO_LARGE');}
      const body=raw?JSON.parse(raw):{},url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname==='/auth/v1/signup'){send(200,session(await h.user()));return;}
      if(url.pathname==='/auth/v1/token'){const uid=refresh.get(body.refresh_token);if(!uid)throw new Error('AUTH_REQUIRED');send(200,session(uid));return;}
      const uid=tokens.get(req.headers.authorization?.replace(/^Bearer /,''));if(!uid)throw new Error('AUTH_REQUIRED');
      if(url.pathname==='/auth/v1/user'){send(200,session(uid).user);return;}
      const fn=url.pathname.split('/').at(-1);
      const allowed={game_action:['p_action','p_code','p_name','p_target','p_round','p_seconds'],crime_action:['p_action','p_code','p_round','p_payload'],mafia_action:['p_action','p_code','p_round','p_payload'],wave_action:['p_action','p_code','p_round','p_payload'],party_action:['p_action','p_code','p_round','p_payload']};
      if(!url.pathname.startsWith('/rest/v1/rpc/')||!Object.hasOwn(allowed,fn)){send(404,{});return;}
      const args=allowed[fn].map(k=>k==='p_payload'?JSON.stringify(body[k]??{}):body[k]??null);
      const data=(await h.as(uid,`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) data`,args)).rows[0].data;send(200,data);
    }catch(e){send(400,{message:e.message,code:e.code??'TEST_ERROR',details:null,hint:null});}
  });
  server.on('upgrade',(_,socket)=>socket.destroy());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});
  return {h,session,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await h.db.close();}};
}
