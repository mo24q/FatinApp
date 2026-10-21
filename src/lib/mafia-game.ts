import type { TimerState } from './local-game';

export type MafiaRole = 'narrator'|'mafia'|'doctor'|'detective'|'citizen';
export type MafiaPhase = 'lobby'|'reveal'|'night'|'day'|'vote'|'result';
export type MafiaConfig = { moderator:boolean; mafia:number; doctor:boolean; detective:boolean; reveal:boolean };
export type MafiaPerson = {id:string;name:string;alive:boolean;online:boolean;done:boolean;role:MafiaRole|null};
export type MafiaLog = {cycle:number;kind:'night'|'vote';eliminated:string|null;tally?:Record<string,number>};
export type MafiaScan = {cycle:number;target:string;mafia:boolean};
export type MafiaSecret = {role:MafiaRole;allies:string[];roles:Record<string,MafiaRole>|null;actions:Record<string,string>|null;scans:MafiaScan[];last_save:string|null;choice:string|null};
export type MafiaView = {
  game:'mafia';id:string;code:string;round:number;revision:number;step:number;cycle:number;phase:MafiaPhase;
  me:string;is_host:boolean;host_offline:boolean;narrator_id:string|null;
  players:MafiaPerson[];members:MafiaPerson[];config:MafiaConfig;log:MafiaLog[];winner:'town'|'mafia'|null;
  timer:TimerState;deadline:string|null;server_time:string;
};
export type MafiaLocal = {
  version:1;created_at:number;round:number;step:number;cycle:number;phase:Exclude<MafiaPhase,'lobby'>;
  narrator_id:string|null;players:{id:string;name:string;alive:boolean}[];roles:Record<string,MafiaRole>;
  ready:string[];actions:Record<string,string>;votes:Record<string,string>;scans:MafiaScan[];
  last_save:string|null;config:MafiaConfig;log:MafiaLog[];winner:'town'|'mafia'|null;timer:TimerState;deadline:string|null;
};
export const mafiaRoles:Record<MafiaRole,{name:string;detail:string;color:string}>={
  narrator:{name:'الراوي',detail:'تدير الليل والنهار وتعرف الأدوار. لا تشارك في التصويت.',color:'purple'},
  mafia:{name:'مافيا',detail:'اتفق مع فريقك على هدف ليلي، واندس بين أهل المدينة نهارًا.',color:'red'},
  doctor:{name:'الطبيب',detail:'تحمي لاعبًا كل ليلة، ويمكنك حماية نفسك. لا تحمِ نفس الشخص ليلتين متتاليتين.',color:'green'},
  detective:{name:'المحقق',detail:'تتحقق من انتماء لاعب كل ليلة. النتيجة تظهر لك وحدك عند طلوع النهار.',color:'blue'},
  citizen:{name:'مواطن',detail:'راقب الكلام وصوّت بذكاء. في الليل أكّد نومك مثل بقية اللاعبين.',color:'gold'},
};
export const mafiaDefaults=(count:number):MafiaConfig=>({moderator:false,mafia:count>=8?2:1,doctor:true,detective:true,reveal:false});
function fail(message:string):never {throw new Error(message);}
export function validateMafiaConfig(count:number,c:MafiaConfig) {
  if(count<(c.moderator?6:5)||count>12)fail('MAFIA_NEED_PLAYERS');
  if(!Number.isInteger(c.mafia)||c.mafia<1||c.mafia>Math.floor((count-(c.moderator?1:0))/3)||typeof c.moderator!=='boolean'||typeof c.doctor!=='boolean'||typeof c.detective!=='boolean'||typeof c.reveal!=='boolean')fail('MAFIA_CONFIG');
}
function shuffle<T>(items:T[]):T[]{
  const out=[...items],word=new Uint32Array(1);
  for(let i=out.length-1;i>0;i--){const limit=0x100000000-(0x100000000%(i+1));do{crypto.getRandomValues(word);}while(word[0]>=limit);const j=word[0]%(i+1);[out[i],out[j]]=[out[j],out[i]];}
  return out;
}
export function newMafia(names:string[],narrator:number,config:MafiaConfig,previous?:MafiaLocal):MafiaLocal {
  const clean=names.map(n=>n.trim());validateMafiaConfig(clean.length,config);
  if(clean.some(n=>n.length<2||n.length>20||/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(n)))fail('NAME_INVALID');
  if(new Set(clean.map(n=>n.toLowerCase())).size!==clean.length)fail('NAME_TAKEN');
  if(config.moderator&&(!Number.isInteger(narrator)||!clean[narrator]))fail('INVALID_NARRATOR');
  const players=clean.map((name,i)=>({id:'p'+i,name,alive:!config.moderator||i!==narrator}));
  const deck:MafiaRole[]=[...Array<MafiaRole>(config.mafia).fill('mafia'),...(config.doctor?['doctor' as const]:[]),...(config.detective?['detective' as const]:[])];
  while(deck.length<players.length-(config.moderator?1:0))deck.push('citizen');
  const randomized=shuffle(deck);const roles:Record<string,MafiaRole>={};
  for(const p of players)roles[p.id]=config.moderator&&p.id===players[narrator].id?'narrator':randomized.pop()!;
  return {version:1,created_at:Date.now(),round:(previous?.round??0)+1,step:1,cycle:1,phase:'reveal',narrator_id:config.moderator?players[narrator].id:null,players,roles,ready:[],actions:{},votes:{},scans:[],last_save:null,config:{...config},log:[],winner:null,timer:{enabled:previous?.timer.enabled??true,paused:false,remaining_seconds:null,duration_seconds:previous?.timer.duration_seconds??180},deadline:null};
}
export function mafiaPublic(g:MafiaLocal):MafiaView {
  const players=g.players.map(p=>({...p,online:true,done:g.phase==='reveal'?g.ready.includes(p.id):g.phase==='night'?Object.hasOwn(g.actions,p.id):g.phase==='vote'?Object.hasOwn(g.votes,p.id):false,role:g.phase==='result'||p.id===g.narrator_id||g.config.reveal&&!p.alive?g.roles[p.id]:null}));
  return {game:'mafia',id:'local',code:'',round:g.round,revision:g.step,step:g.step,cycle:g.cycle,phase:g.phase,me:g.narrator_id??g.players[0].id,is_host:true,host_offline:false,narrator_id:g.narrator_id,players,members:players,config:g.config,log:g.log,winner:g.winner,timer:g.timer,deadline:g.deadline,server_time:new Date().toISOString()};
}
export function mafiaSecret(g:MafiaLocal,actor:string):MafiaSecret {
  const role=g.roles[actor];if(!role)fail('NOT_MEMBER');
  return {role,allies:role==='mafia'?g.players.filter(p=>p.id!==actor&&g.roles[p.id]==='mafia').map(p=>p.id):[],roles:role==='narrator'?g.roles:null,actions:role==='narrator'?g.actions:role==='mafia'?Object.fromEntries(Object.entries(g.actions).filter(([id])=>g.roles[id]==='mafia')):null,scans:role==='detective'?g.scans:[],last_save:role==='doctor'?g.last_save:null,choice:(g.phase==='vote'?g.votes:g.actions)[actor]??null};
}
export function mafiaPending(g:MafiaView){return g.players.filter(p=>g.phase==='reveal'?!p.done:p.alive&&!p.done);}
function leader(values:string[]):string|null {
  const counts:Record<string,number>={};for(const v of values)counts[v]=(counts[v]??0)+1;
  const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  return sorted.length&&sorted[0][0]!=='skip'&&(sorted.length===1||sorted[0][1]>sorted[1][1])?sorted[0][0]:null;
}
export function mafiaLocalAction(old:MafiaLocal,actor:string,action:string,payload:Record<string,unknown>={}):MafiaLocal {
  const g=structuredClone(old);const me=g.players.find(p=>p.id===actor);if(!me)fail('NOT_MEMBER');
  const role=g.roles[actor];const target=typeof payload.target==='string'?payload.target:'skip';
  const alive=g.players.filter(p=>p.alive);
  const narrator=()=>{if(actor!==(g.narrator_id??g.players[0].id))fail('NARRATOR_ONLY');};
  const phase=(value:MafiaPhase)=>{if(g.phase!==value)fail('WRONG_PHASE');};
  const transition=(next:MafiaLocal['phase'])=>{g.phase=next;g.step++;g.timer.paused=false;g.timer.remaining_seconds=null;g.deadline=g.timer.enabled&&next==='day'?new Date(Date.now()+g.timer.duration_seconds*1000).toISOString():null;};
  const finish=()=>{const live=g.players.filter(p=>p.alive);const mafia=live.filter(p=>g.roles[p.id]==='mafia').length;if(mafia===0)g.winner='town';else if(mafia>=live.length-mafia)g.winner='mafia';if(g.winner)transition('result');};
  if(action==='ready'){phase('reveal');if(!g.ready.includes(actor))g.ready.push(actor);}
  else if(action==='begin'){narrator();phase('reveal');if(g.ready.length!==g.players.length)fail('NOT_READY');transition('night');}
  else if(action==='night_action'){
    phase('night');if(!me.alive)fail('ELIMINATED');
    if(target!=='skip'){
      if(!alive.some(p=>p.id===target))fail('INVALID_TARGET');
      if(role==='citizen'||role==='narrator'||role==='mafia'&&g.roles[target]==='mafia'||role==='detective'&&target===actor||role==='doctor'&&target===g.last_save)fail('INVALID_TARGET');
    }
    g.actions[actor]=target;
  }else if(action==='resolve_night'){
    narrator();phase('night');if(!payload.force&&alive.some(p=>!Object.hasOwn(g.actions,p.id)))fail('WAIT_ACTIONS');
    let victim=leader(alive.filter(p=>g.roles[p.id]==='mafia').map(p=>g.actions[p.id]??'skip'));
    const doctor=alive.find(p=>g.roles[p.id]==='doctor');const saved=doctor?g.actions[doctor.id]:undefined;
    g.last_save=saved&&saved!=='skip'?saved:null;if(victim===saved)victim=null;
    const detective=alive.find(p=>g.roles[p.id]==='detective');const inspected=detective?g.actions[detective.id]:undefined;
    if(inspected&&inspected!=='skip')g.scans.push({cycle:g.cycle,target:inspected,mafia:g.roles[inspected]==='mafia'});
    if(victim)g.players.find(p=>p.id===victim)!.alive=false;
    g.log.push({cycle:g.cycle,kind:'night',eliminated:victim});g.actions={};transition('day');finish();
  }else if(action==='open_vote'){narrator();phase('day');g.votes={};transition('vote');}
  else if(action==='vote'){
    phase('vote');if(!me.alive)fail('ELIMINATED');if(Object.hasOwn(g.votes,actor))fail('ALREADY_VOTED');
    if(target!=='skip'&&(target===actor||!alive.some(p=>p.id===target)))fail('INVALID_TARGET');g.votes[actor]=target;
  }else if(action==='resolve_vote'){
    narrator();phase('vote');if(!payload.force&&alive.some(p=>!Object.hasOwn(g.votes,p.id)))fail('WAIT_ACTIONS');
    const choices=alive.map(p=>g.votes[p.id]??'skip'),victim=leader(choices),tally:Record<string,number>={};
    for(const v of choices)tally[v]=(tally[v]??0)+1;
    if(victim)g.players.find(p=>p.id===victim)!.alive=false;
    g.log.push({cycle:g.cycle,kind:'vote',eliminated:victim,tally});g.cycle++;g.votes={};g.actions={};transition('night');finish();
  }else if(action.startsWith('timer_')){
    narrator();if(g.phase!=='day')fail('WRONG_PHASE');
    const remaining=g.timer.paused?g.timer.remaining_seconds??0:g.deadline?Math.max(0,Math.ceil((Date.parse(g.deadline)-Date.now())/1000)):g.timer.duration_seconds;
    if(action==='timer_disable'){g.timer.enabled=false;g.timer.paused=false;g.timer.remaining_seconds=null;g.deadline=null;}
    else if(action==='timer_pause'){if(g.timer.enabled&&!g.timer.paused){g.timer.paused=true;g.timer.remaining_seconds=remaining;g.deadline=null;}}
    else if(action==='timer_resume'){if(g.timer.enabled&&g.timer.paused){g.deadline=new Date(Date.now()+remaining*1000).toISOString();g.timer.paused=false;g.timer.remaining_seconds=null;}}
    else if(action==='timer_set'){const n=Number(payload.seconds);if(!Number.isInteger(n)||n<15||n>900)fail('INVALID_SECONDS');g.timer.duration_seconds=n;if(g.timer.paused)g.timer.remaining_seconds=n;else if(g.timer.enabled)g.deadline=new Date(Date.now()+n*1000).toISOString();}
    else if(action==='timer_enable'||action==='timer_reset'){g.timer.enabled=true;g.timer.paused=false;g.timer.remaining_seconds=null;g.deadline=new Date(Date.now()+g.timer.duration_seconds*1000).toISOString();}
    else fail('ACTION_INVALID');
  }else fail('ACTION_INVALID');
  if(!g.config.moderator){
    const controller=g.players[0].id;
    if(g.phase==='reveal'&&g.players.every(p=>g.ready.includes(p.id)))return mafiaLocalAction(g,controller,'begin');
    if(g.phase==='night'&&g.players.filter(p=>p.alive).every(p=>Object.hasOwn(g.actions,p.id)))return mafiaLocalAction(g,controller,'resolve_night');
    if(g.phase==='vote'&&g.players.filter(p=>p.alive).every(p=>Object.hasOwn(g.votes,p.id)))return mafiaLocalAction(g,controller,'resolve_vote');
  }
  return g;
}
export function restoreMafia(raw:string|null):MafiaLocal|null {
  if(!raw||raw.length>120000)return null;
  try {const g=JSON.parse(raw) as MafiaLocal;if(g.version!==1||!Number.isFinite(g.created_at)||Date.now()-g.created_at>86400000||g.created_at>Date.now()+60000)return null;
    validateMafiaConfig(g.players.length,g.config);
    if(!['reveal','night','day','vote','result'].includes(g.phase)||!Number.isInteger(g.round)||g.round<1||!Number.isInteger(g.step)||!Number.isInteger(g.cycle))return null;
    const ids=new Set(g.players.map(p=>p.id));if(ids.size!==g.players.length||(g.config.moderator?(!g.narrator_id||!ids.has(g.narrator_id)||g.roles[g.narrator_id]!=='narrator'):g.narrator_id!==null))return null;
    if(g.players.some(p=>typeof p.name!=='string'||p.name.length>20||typeof p.alive!=='boolean'||!Object.hasOwn(mafiaRoles,g.roles[p.id])))return null;
    if(!Array.isArray(g.ready)||!Array.isArray(g.log)||!Array.isArray(g.scans)||!g.actions||!g.votes||!g.timer||!Number.isFinite(g.timer.duration_seconds))return null;
    if(g.deadline!==null&&!Number.isFinite(Date.parse(g.deadline)))return null;
    return g;
  }catch{return null;}
}
