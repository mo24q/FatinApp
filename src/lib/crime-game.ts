import { defaultPlayerNames } from './player-names.ts';
import { crimeCards, crimeCardById, clueBoards } from './crime-content.ts';

export type CrimePhase = 'lobby'|'reveal'|'investigate'|'result';
export type CrimeRole = 'narrator'|'killer'|'investigator';
export type CrimePlayer = {id:string;name:string;online:boolean;ready:boolean};
export type CrimeHand = {player_id:string;weapons:string[];evidence:string[]};
export type CrimeSolution = {killer_id:string;weapon:string;evidence:string};
export type CrimeAccusation = {actor:string;target:string;weapon:string;evidence:string;correct:boolean};
export type CrimeView = {
  game:'crime'; id:string;code:string;phase:CrimePhase;round:number;revision:number;
  me:string;is_host:boolean;host_offline:boolean;narrator_id:string|null;
  players:CrimePlayer[];hands:CrimeHand[];clues:Record<string,string>;accusations:CrimeAccusation[];
  solution_ready:boolean;result:null|(CrimeSolution&{caught:boolean});
  server_time:string;deadline:string|null;
  timer:{enabled:boolean;paused:boolean;remaining_seconds:number|null;duration_seconds:number};
};
export type CrimeSecret = {round:number;role:CrimeRole;solution:CrimeSolution|null};
export type LocalCrime = {
  version:1;created_at:number;round:number;phase:Exclude<CrimePhase,'lobby'>;
  players:CrimePlayer[];narrator_id:string;killer_id:string;hands:CrimeHand[];
  solution:CrimeSolution|null;clues:Record<string,string>;accusations:CrimeAccusation[];
  result:CrimeView['result'];order:string[];cursor:number;
  timer:CrimeView['timer'];deadline:string|null;
};
function randomInt(max:number) {
  if(!Number.isInteger(max)||max<1) throw new Error('INVALID_RANDOM_RANGE');
  const range=2**32,limit=range-range%max,buffer=new Uint32Array(1);
  do {crypto.getRandomValues(buffer);} while(buffer[0]>=limit);
  return buffer[0]%max;
}
function shuffled<T>(input:readonly T[]) {
  const out=[...input];
  for(let i=out.length-1;i>0;i--) {const j=randomInt(i+1);[out[i],out[j]]=[out[j],out[i]];}
  return out;
}
export function crimeNames(names:string[]) {
  const clean=names.map(n=>n.trim().replace(/\s+/g,' '));
  if(clean.length<4||clean.length>12) throw new Error('تحتاجون من ٤ إلى ١٢ لاعبًا، شامل الراوي.');
  if(clean.some(n=>n.length<2||n.length>20||/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(n))) throw new Error('اكتبوا أسماء من حرفين إلى ٢٠ حرفًا دون رموز تحكم.');
  if(new Set(clean.map(n=>n.toLocaleLowerCase())).size!==clean.length) throw new Error('كل لاعب يحتاج اسمًا مختلفًا.');
  return clean;
}
export function newCrime(names:string[],narratorIndex:number,previous?:LocalCrime):LocalCrime {
  const clean=crimeNames(defaultPlayerNames(names));
  if(!Number.isInteger(narratorIndex)||narratorIndex<0||narratorIndex>=clean.length) throw new Error('اختر الراوي.');
  const players=clean.map((name,i)=>({id:`p${i}`,name,online:true,ready:false}));
  const narrator_id=players[narratorIndex].id;
  const eligible=players.filter(p=>p.id!==narrator_id);
  const oldName=previous?.players.find(p=>p.id===previous.killer_id)?.name;
  const candidates=eligible.filter(p=>p.name!==oldName);
  const killer_id=candidates[randomInt(candidates.length)].id;
  const weapons=shuffled(crimeCards.filter(c=>c.kind==='weapon').map(c=>c.id));
  const evidence=shuffled(crimeCards.filter(c=>c.kind==='evidence').map(c=>c.id));
  return {
    version:1,created_at:Date.now(),round:(previous?.round??0)+1,phase:'reveal',players,narrator_id,killer_id,
    hands:eligible.map((p,i)=>({player_id:p.id,weapons:weapons.slice(i*4,i*4+4),evidence:evidence.slice(i*4,i*4+4)})),
    solution:null,clues:{},accusations:[],result:null,order:[...eligible.map(p=>p.id),narrator_id],cursor:0,
    timer:{enabled:previous?.timer.enabled??false,paused:false,remaining_seconds:null,duration_seconds:previous?.timer.duration_seconds??300},deadline:null,
  };
}
export function crimeSecret(state:LocalCrime,actor:string):CrimeSecret {
  if(!state.players.some(p=>p.id===actor)) throw new Error('NOT_MEMBER');
  return {round:state.round,role:actor===state.narrator_id?'narrator':actor===state.killer_id?'killer':'investigator',
    solution:actor===state.narrator_id||actor===state.killer_id?state.solution:null};
}
export function chooseCrime(state:LocalCrime,actor:string,weapon:string,evidence:string):LocalCrime {
  if(state.phase!=='reveal'||state.solution) throw new Error('WRONG_PHASE');
  if(actor!==state.killer_id) throw new Error('KILLER_ONLY');
  const hand=state.hands.find(h=>h.player_id===actor);
  if(!hand?.weapons.includes(weapon)||!hand.evidence.includes(evidence)) throw new Error('INVALID_CARDS');
  return {...state,solution:{killer_id:actor,weapon,evidence}};
}
export function advanceCrimeRole(state:LocalCrime):LocalCrime {
  if(state.phase!=='reveal') throw new Error('WRONG_PHASE');
  const id=state.order[state.cursor];
  if(id===state.killer_id&&!state.solution) throw new Error('اختر سلاح الجريمة والدليل أولًا.');
  const players=state.players.map(p=>p.id===id?{...p,ready:true}:p);
  if(state.cursor<state.order.length-1) return {...state,players,cursor:state.cursor+1};
  if(!state.solution) throw new Error('SOLUTION_REQUIRED');
  return {...state,players,phase:'investigate',deadline:state.timer.enabled?new Date(Date.now()+state.timer.duration_seconds*1000).toISOString():null};
}
export function setCrimeClue(state:LocalCrime,actor:string,board:string,value:string):LocalCrime {
  if(state.phase!=='investigate') throw new Error('WRONG_PHASE');
  if(actor!==state.narrator_id) throw new Error('NARRATOR_ONLY');
  const definition=clueBoards.find(b=>b.id===board);
  if(!definition||(definition.options as readonly string[]).includes(value)===false) throw new Error('INVALID_CLUE');
  return {...state,clues:{...state.clues,[board]:value}};
}
export function accuseCrime(state:LocalCrime,actor:string,target:string,weapon:string,evidence:string):LocalCrime {
  if(state.phase!=='investigate'||!state.solution) throw new Error('WRONG_PHASE');
  if(!state.players.some(p=>p.id===actor)||actor===state.narrator_id||actor===target||target===state.narrator_id) throw new Error('INVALID_ACCUSATION');
  if(state.accusations.some(a=>a.actor===actor)) throw new Error('ALREADY_ACCUSED');
  const hand=state.hands.find(h=>h.player_id===target);
  if(!hand?.weapons.includes(weapon)||!hand.evidence.includes(evidence)) throw new Error('INVALID_CARDS');
  const correct=target===state.killer_id&&weapon===state.solution.weapon&&evidence===state.solution.evidence;
  const accusations=[...state.accusations,{actor,target,weapon,evidence,correct}];
  if(correct||accusations.length===state.hands.length) return {...state,accusations,phase:'result',deadline:null,result:{...state.solution,caught:correct}};
  return {...state,accusations};
}
export function closeCrime(state:LocalCrime,actor:string):LocalCrime {
  if(actor!==state.narrator_id) throw new Error('NARRATOR_ONLY');
  if(state.phase!=='investigate'||!state.solution) throw new Error('WRONG_PHASE');
  return {...state,phase:'result',deadline:null,result:{...state.solution,caught:false}};
}
export function publicCrime(state:LocalCrime):CrimeView {
  return {game:'crime',id:'local',code:'',phase:state.phase,round:state.round,revision:0,me:'',is_host:true,host_offline:false,
    narrator_id:state.narrator_id,players:state.players,hands:state.hands,clues:state.clues,accusations:state.accusations,
    solution_ready:!!state.solution,result:state.result,server_time:new Date().toISOString(),timer:state.timer,deadline:state.deadline};
}
export function crimeTimer(state:LocalCrime,command:string,seconds?:number):LocalCrime {
  if(state.phase!=='investigate') throw new Error('WRONG_PHASE');
  let timer={...state.timer},deadline=state.deadline;
  const remaining=timer.paused?timer.remaining_seconds??0:deadline?Math.max(0,Math.ceil((Date.parse(deadline)-Date.now())/1000)):timer.duration_seconds;
  if(command==='timer_set') {
    if(!Number.isInteger(seconds)||seconds!<15||seconds!>900) throw new Error('اختر من ١٥ إلى ٩٠٠ ثانية.');
    timer.duration_seconds=seconds!;
    if(timer.paused) timer.remaining_seconds=seconds!;
    else if(timer.enabled) deadline=new Date(Date.now()+seconds!*1000).toISOString();
  } else if(command==='timer_disable') {timer={...timer,enabled:false,paused:false,remaining_seconds:null};deadline=null;}
  else if(command==='timer_pause') {if(!timer.enabled||timer.paused)return state;timer={...timer,paused:true,remaining_seconds:remaining};deadline=null;}
  else if(command==='timer_resume') {if(!timer.enabled||!timer.paused)return state;timer={...timer,paused:false,remaining_seconds:null};deadline=new Date(Date.now()+remaining*1000).toISOString();}
  else if(command==='timer_enable'||command==='timer_reset') {
    if(command==='timer_enable'&&timer.enabled)return state;
    timer={...timer,enabled:true,paused:false,remaining_seconds:null};deadline=new Date(Date.now()+timer.duration_seconds*1000).toISOString();
  } else throw new Error('ACTION_INVALID');
  return {...state,timer,deadline};
}
// Share a strictly allowlisted public hand. Never serialize a LocalCrime or a secret.
export function shareCrimeHand(name:string,hand:CrimeHand):string {
  return encodeURIComponent(JSON.stringify({v:1,name,weapons:[...hand.weapons],evidence:[...hand.evidence]}));
}
export function parseCrimeHand(fragment:string):{name:string;hand:CrimeHand}|null {
  try {
    if(fragment.length>3000)return null;
    const s=JSON.parse(decodeURIComponent(fragment.replace(/^#/,'')));
    if(s.v!==1||typeof s.name!=='string'||s.name.length>20||!s.name.trim())return null;
    const name:string=s.name;
    if(!validHand(s))return null;
    return {name,hand:{player_id:'shared',weapons:[...s.weapons],evidence:[...s.evidence]}};
  } catch{return null;}
}
function validHand(h:unknown):h is CrimeHand {
  if(!h||typeof h!=='object')return false;
  const s=h as CrimeHand;
  return (['weapons','evidence'] as const).every(k=>Array.isArray(s[k])&&s[k].length===4&&new Set(s[k]).size===4&&s[k].every(id=>typeof id==='string'&&crimeCardById[id]?.kind===(k==='weapons'?'weapon':'evidence')));
}
export function restoreCrime(raw:string|null):LocalCrime|null {
  try {
    if(!raw||raw.length>40000)return null;
    const s=JSON.parse(raw) as LocalCrime;
    if(s.version!==1||!Number.isFinite(s.created_at)||Date.now()-s.created_at>86400000||s.created_at>Date.now()+60000)return null;
    if(!Number.isInteger(s.round)||s.round<1||!['reveal','investigate','result'].includes(s.phase))return null;
    crimeNames(s.players.map(p=>p.name));
    const ids=s.players.map(p=>p.id);
    if(ids.some((id,i)=>id!==`p${i}`)||s.players.some(p=>typeof p.ready!=='boolean'))return null;
    if(!ids.includes(s.narrator_id)||!ids.includes(s.killer_id)||s.narrator_id===s.killer_id)return null;
    if(!Array.isArray(s.hands)||s.hands.length!==ids.length-1||s.hands.some(h=>!validHand(h)||!ids.includes(h.player_id)||h.player_id===s.narrator_id))return null;
    if(new Set(s.hands.map(h=>h.player_id)).size!==s.hands.length||new Set(s.hands.flatMap(h=>[...h.weapons,...h.evidence])).size!==s.hands.length*8)return null;
    if(JSON.stringify(s.order)!==JSON.stringify([...ids.filter(id=>id!==s.narrator_id),s.narrator_id])||!Number.isInteger(s.cursor)||s.cursor<0||s.cursor>=ids.length)return null;
    const killer=s.hands.find(h=>h.player_id===s.killer_id)!;
    if(s.solution&&(s.solution.killer_id!==s.killer_id||!killer.weapons.includes(s.solution.weapon)||!killer.evidence.includes(s.solution.evidence)))return null;
    if(s.phase!=='reveal'&&!s.solution)return null;
    if(!s.clues||typeof s.clues!=='object'||Object.entries(s.clues).some(([key,value])=>!clueBoards.some(b=>b.id===key&&(b.options as readonly string[]).includes(value))))return null;
    if(!Array.isArray(s.accusations)||s.accusations.length>s.hands.length||new Set(s.accusations.map(a=>a.actor)).size!==s.accusations.length)return null;
    if(s.accusations.some(a=>!ids.includes(a.actor)||a.actor===s.narrator_id||a.actor===a.target||!s.hands.some(h=>h.player_id===a.target&&h.weapons.includes(a.weapon)&&h.evidence.includes(a.evidence))||a.correct!==(a.target===s.solution?.killer_id&&a.weapon===s.solution?.weapon&&a.evidence===s.solution?.evidence)))return null;
    if(s.phase==='result'&&(!s.result||!s.solution||s.result.killer_id!==s.solution.killer_id||s.result.weapon!==s.solution.weapon||s.result.evidence!==s.solution.evidence||typeof s.result.caught!=='boolean'||s.result.caught!==s.accusations.some(a=>a.correct)))return null;
    if(s.phase!=='result'&&s.result!==null)return null;
    if(!s.timer||typeof s.timer.enabled!=='boolean'||typeof s.timer.paused!=='boolean'||!Number.isInteger(s.timer.duration_seconds)||s.timer.duration_seconds<15||s.timer.duration_seconds>900)return null;
    if(s.timer.paused&&(!s.timer.enabled||!Number.isInteger(s.timer.remaining_seconds)||s.timer.remaining_seconds!<0||s.timer.remaining_seconds!>900))return null;
    if(s.deadline!==null&&(typeof s.deadline!=='string'||!Number.isFinite(Date.parse(s.deadline))))return null;
    return s;
  } catch{return null;}
}
