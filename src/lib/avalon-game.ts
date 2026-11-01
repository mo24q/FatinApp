import {randomIndex} from './local-game.ts';
import {defaultPlayerNames} from './player-names.ts';
export type AvalonRole='merlin'|'percival'|'morgana'|'assassin'|'mordred'|'oberon'|'loyal'|'minion';
export type AvalonConfig={percival:boolean;morgana:boolean;mordred:boolean;oberon:boolean};
export type AvalonPhase='lobby'|'reveal'|'propose'|'ballot'|'quest'|'review'|'assassinate'|'result';
export const avalonRoles:Record<AvalonRole,{name:string;evil:boolean;detail:string}>={
  merlin:{name:'المرشد',evil:false,detail:'تعرف الخونة ما عدا الخفي. وجّه فريقك بحذر؛ القاتل يبحث عنك.'},
  percival:{name:'البصير',evil:false,detail:'ترى المرشد والمخادع دون معرفة أيهما المرشد. احمِ المرشد الحقيقي.'},
  morgana:{name:'المخادع',evil:true,detail:'تظهر للبصير مع المرشد. أوهمه بأنك صاحب المعرفة الصادقة.'},
  assassin:{name:'القاتل',evil:true,detail:'بعد نجاح ثلاث مهمات، لك محاولة واحدة لاكتشاف المرشد وقلب النتيجة.'},
  mordred:{name:'الخفي',evil:true,detail:'أنت خائن لا يراك المرشد، ويعرفك زملاؤك عدا المنبوذ.'},
  oberon:{name:'المنبوذ',evil:true,detail:'أنت خائن لا تعرف زملاءك ولا يعرفونك، لكن المرشد يراك.'},
  loyal:{name:'المخلص',evil:false,detail:'لا تعرف أدوار الآخرين. استدل من النقاش والتصويت ونتائج المهمات.'},
  minion:{name:'الخائن',evil:true,detail:'تعرف زملاءك عدا المنبوذ. شارك في الفرق وخرب المهمات بذكاء.'}
};
export const avalonDefaults: AvalonConfig={percival:false,morgana:false,mordred:false,oberon:false};
export const questSizes:Record<number,number[]>={5:[2,3,2,3,3],6:[2,3,4,3,4],7:[2,3,3,4,4],8:[3,4,4,5,5],9:[3,4,4,5,5],10:[3,4,4,5,5]};
export const evilCount=(n:number)=>n===10?4:n>=7?3:2;
export const failThreshold=(n:number,mission:number)=>n>=7&&mission===4?2:1;
export type AvalonPlayer={id:string;name:string;online?:boolean};
export type QuestResult={mission:number;team:string[];fails:number;success:boolean};
export type TeamVote={mission:number;leader:string;team:string[];votes:Record<string,boolean>;approved:boolean};
export type AvalonLocal={version:1;created_at:number;round:number;step:number;phase:Exclude<AvalonPhase,'lobby'>;players:AvalonPlayer[];roles:Record<string,AvalonRole>;config:AvalonConfig;leader:number;mission:number;rejects:number;team:string[];ready:string[];ballots:Record<string,boolean>;cards:Record<string,boolean>;final_ready:string[];target:string|null;history:QuestResult[];vote_history:TeamVote[];winner:'good'|'evil'|null;reason:string|null};
export type AvalonSecret={role:AvalonRole;known:string[];candidates:string[]};
export type AvalonView={game:'avalon';id:string;code:string;round:number;step:number;revision:number;server_time:string;phase:AvalonPhase;players:AvalonPlayer[];members:AvalonPlayer[];me:string;is_host:boolean;host_offline:boolean;config:AvalonConfig;leader:number;mission:number;rejects:number;team:string[];pending:string[];history:QuestResult[];vote_history:TeamVote[];winner:'good'|'evil'|null;reason:string|null;roles:Record<string,AvalonRole>|null;target:string|null};
function fail(code:string):never{throw new Error(code);}
export function validateAvalon(n:number,c:AvalonConfig){
  if(!questSizes[n])fail('AVALON_PLAYERS');
  if(!c||Object.keys(c).sort().join(',')!=='mordred,morgana,oberon,percival'||Object.values(c).some(v=>typeof v!=='boolean')||1+Number(c.morgana)+Number(c.mordred)+Number(c.oberon)>evilCount(n))fail('AVALON_CONFIG');
}
export function newAvalon(names:string[],config:AvalonConfig={...avalonDefaults},previous?:AvalonLocal):AvalonLocal{
  const clean=defaultPlayerNames(names);validateAvalon(clean.length,config);
  if(clean.some(n=>n.length<2||n.length>20||/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(n)))fail('NAME_INVALID');
  if(new Set(clean.map(n=>n.toLowerCase())).size!==clean.length)fail('NAME_TAKEN');
  const n=clean.length,deck:AvalonRole[]=['assassin'];
  for(const role of ['morgana','mordred','oberon'] as const)if(config[role])deck.push(role);
  while(deck.length<evilCount(n))deck.push('minion');deck.push('merlin');if(config.percival)deck.push('percival');while(deck.length<n)deck.push('loyal');
  for(let i=n-1;i>0;i--){const j=randomIndex(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];}
  const players=clean.map((name,i)=>({id:'p'+i,name}));
  return {version:1,created_at:Date.now(),round:(previous?.round??0)+1,step:1,phase:'reveal',players,roles:Object.fromEntries(players.map((p,i)=>[p.id,deck[i]])),config:{...config},leader:randomIndex(n),mission:1,rejects:0,team:[],ready:[],ballots:{},cards:{},final_ready:[],target:null,history:[],vote_history:[],winner:null,reason:null};
}
export function avalonSecret(g:AvalonLocal,actor:string):AvalonSecret{
  const role=g.roles[actor];if(!role)fail('NOT_MEMBER');
  return {role,known:g.players.filter(p=>p.id!==actor&&(role==='merlin'?avalonRoles[g.roles[p.id]].evil&&g.roles[p.id]!=='mordred':avalonRoles[role].evil&&role!=='oberon'?avalonRoles[g.roles[p.id]].evil&&g.roles[p.id]!=='oberon':false)).map(p=>p.id),candidates:role==='percival'?g.players.filter(p=>['merlin','morgana'].includes(g.roles[p.id])).map(p=>p.id):[]};
}
export function avalonPending(g:AvalonLocal):string[]{return g.players.filter(p=>g.phase==='reveal'?!g.ready.includes(p.id):g.phase==='ballot'?!Object.hasOwn(g.ballots,p.id):g.phase==='quest'?g.team.includes(p.id)&&!Object.hasOwn(g.cards,p.id):g.phase==='assassinate'?!g.final_ready.includes(p.id):false).map(p=>p.id);}
export function avalonPublic(g:AvalonLocal):AvalonView{
  return {game:'avalon',id:'local',code:'',round:g.round,step:g.step,revision:g.step,server_time:new Date().toISOString(),phase:g.phase,players:g.players,members:g.players,me:g.players[0].id,is_host:true,host_offline:false,config:g.config,leader:g.leader,mission:g.mission,rejects:g.rejects,team:g.team,pending:avalonPending(g),history:g.history,vote_history:g.vote_history,winner:g.winner,reason:g.reason,roles:g.phase==='result'?g.roles:null,target:g.phase==='result'?g.target:null};
}
export function avalonAction(old:AvalonLocal,actor:string,action:string,p:Record<string,unknown>={}):AvalonLocal{
  const g=structuredClone(old),n=g.players.length,ids=g.players.map(x=>x.id);
  if(!ids.includes(actor))fail('NOT_MEMBER');
  const phase=(s:AvalonPhase)=>{if(g.phase!==s)fail('WRONG_PHASE');};
  const transition=(s:AvalonLocal['phase'])=>{g.phase=s;g.step++;};
  const finish=(winner:'good'|'evil',reason:string)=>{g.winner=winner;g.reason=reason;transition('result');};
  const lock=(map:Record<string,boolean>,value:unknown)=>{if(typeof value!=='boolean')fail('INVALID_CHOICE');if(Object.hasOwn(map,actor)&&map[actor]!==value)fail('ACTION_LOCKED');map[actor]=value;};
  if(action==='ready'){phase('reveal');if(!g.ready.includes(actor))g.ready.push(actor);if(g.ready.length===n)transition('propose');}
  else if(action==='propose'){
    phase('propose');if(actor!==ids[g.leader])fail('LEADER_ONLY');
    if(!Array.isArray(p.team)||p.team.length!==questSizes[n][g.mission-1]||new Set(p.team).size!==p.team.length||p.team.some(id=>typeof id!=='string'||!ids.includes(id)))fail('INVALID_TEAM');
    g.team=p.team as string[];g.ballots={};transition('ballot');
  }else if(action==='vote'){
    phase('ballot');lock(g.ballots,p.approve);
    if(Object.keys(g.ballots).length===n){const approved=Object.values(g.ballots).filter(Boolean).length>n/2;g.vote_history.push({mission:g.mission,leader:ids[g.leader],team:[...g.team],votes:{...g.ballots},approved});g.ballots={};
      if(approved){g.rejects=0;g.cards={};transition('quest');}else{g.rejects++;g.leader=(g.leader+1)%n;g.team=[];if(g.rejects===5)finish('evil','rejections');else transition('propose');}}
  }else if(action==='quest'){
    phase('quest');if(!g.team.includes(actor))fail('TEAM_ONLY');if(p.success===false&&!avalonRoles[g.roles[actor]].evil)fail('GOOD_MUST_SUCCEED');lock(g.cards,p.success);
    if(Object.keys(g.cards).length===g.team.length){const fails=Object.values(g.cards).filter(v=>!v).length;g.history.push({mission:g.mission,team:[...g.team],fails,success:fails<failThreshold(n,g.mission)});g.cards={};transition('review');}
  }else if(action==='next'){
    phase('review');if(actor!==ids[0])fail('HOST_ONLY');const won=g.history.filter(q=>q.success).length,lost=g.history.length-won;
    if(lost>=3)finish('evil','quests');else if(won>=3){g.final_ready=[];transition('assassinate');}else{g.mission++;g.leader=(g.leader+1)%n;g.team=[];transition('propose');}
  }else if(action==='final'){
    phase('assassinate');
    if(g.roles[actor]==='assassin'){if(typeof p.target!=='string'||!ids.includes(p.target)||p.target===actor)fail('INVALID_TARGET');if(g.target&&g.target!==p.target)fail('ACTION_LOCKED');g.target=p.target;}
    else if(p.target!==undefined)fail('ASSASSIN_ONLY');
    if(!g.final_ready.includes(actor))g.final_ready.push(actor);
    if(g.final_ready.length===n){if(!g.target)fail('NOT_READY');finish(g.roles[g.target]==='merlin'?'evil':'good',g.roles[g.target]==='merlin'?'assassination':'protected');}
  }else fail('ACTION_INVALID');
  return g;
}
export function restoreAvalon(raw:string|null):AvalonLocal|null{
  if(!raw||raw.length>100000)return null;
  try{const g=JSON.parse(raw) as AvalonLocal;validateAvalon(g.players.length,g.config);const ids=g.players.map(p=>p.id),has=(id:unknown)=>typeof id==='string'&&ids.includes(id),list=(v:unknown):v is string[]=>Array.isArray(v)&&new Set(v).size===v.length&&v.every(has),votes=(v:unknown)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.entries(v).every(([k,b])=>has(k)&&typeof b==='boolean');
    if(g.version!==1||!Number.isFinite(g.created_at)||Date.now()-g.created_at>86400000||g.created_at>Date.now()+60000||!Number.isInteger(g.round)||g.round<1||!Number.isInteger(g.step)||g.step<1)return null;
    if(!['reveal','propose','ballot','quest','review','assassinate','result'].includes(g.phase)||new Set(ids).size!==ids.length||g.players.some(p=>typeof p.id!=='string'||typeof p.name!=='string'||p.name.length<2||p.name.length>20))return null;
    if(!g.roles||Object.keys(g.roles).length!==ids.length||ids.some(id=>!Object.hasOwn(avalonRoles,g.roles[id])))return null;
    const roles=Object.values(g.roles);if(roles.filter(r=>avalonRoles[r].evil).length!==evilCount(ids.length)||roles.filter(r=>r==='merlin').length!==1||roles.filter(r=>r==='assassin').length!==1)return null;
    for(const r of ['percival','morgana','mordred','oberon'] as const)if(roles.filter(v=>v===r).length!==Number(g.config[r]))return null;
    if(!Number.isInteger(g.leader)||g.leader<0||g.leader>=ids.length||!Number.isInteger(g.mission)||g.mission<1||g.mission>5||!Number.isInteger(g.rejects)||g.rejects<0||g.rejects>5)return null;
    if(![g.team,g.ready,g.final_ready].every(list)||!votes(g.ballots)||!votes(g.cards)||Object.keys(g.cards).some(id=>!g.team.includes(id)))return null;
    if(!Array.isArray(g.history)||g.history.length>5||g.history.some(q=>!Number.isInteger(q.mission)||q.mission<1||q.mission>5||!list(q.team)||q.team.length!==questSizes[ids.length][q.mission-1]||!Number.isInteger(q.fails)||q.fails<0||q.fails>q.team.length||q.success!==(q.fails<failThreshold(ids.length,q.mission))))return null;
    if(!Array.isArray(g.vote_history)||g.vote_history.length>25||g.vote_history.some(v=>!has(v.leader)||!list(v.team)||!votes(v.votes)||typeof v.approved!=='boolean'))return null;
    if(![null,'good','evil'].includes(g.winner)||g.target!==null&&!has(g.target)||g.reason!==null&&!['quests','rejections','assassination','protected'].includes(g.reason))return null;
    if((g.phase==='result')!==(g.winner!==null)||['ballot','quest','review'].includes(g.phase)&&g.team.length!==questSizes[ids.length][g.mission-1])return null;
    return g;
  }catch{return null;}
}
