import { randomIndex, type TimerState } from './local-game';
export const wavePairs=[
  ['بارد','حار'],['هادئ','صاخب'],['خفيف','ثقيل'],['سهل','صعب'],['قريب','بعيد'],['بطيء','سريع'],['قديم','حديث'],['رخيص','غالي'],
  ['يومي','نادر'],['صغير','ضخم'],['ناعم','خشن'],['مرتب','فوضوي'],['بسيط','معقد'],['مألوف','غريب'],['عملي','للزينة'],['قصير','طويل'],
  ['فردي','جماعي'],['عفوي','مخطط له'],['مريح','متعب'],['خفيف على المعدة','وجبة دسمة'],['فطور','عشاء'],['للبيت','للطلعات'],['للشتاء','للصيف'],['مالح','حلو'],
  ['يبغى صبر','يخلص بسرعة'],['للمبتدئ','للمحترف'],['واقعي','خيالي'],['رسمي','عفوي'],['مغامرة','استرخاء'],['يحتاج هدوء','يحتاج حماس'],['سهل حمله','صعب نقله'],['ذكرى قديمة','خطة للمستقبل'],
  ['شخصي','يصلح هدية'],['يدوي','آلي'],['غامض','واضح'],['يؤكل بالملعقة','يؤكل باليد'],['في الداخل','في الهواء الطلق'],['نشتريه مرة','نشتريه دائمًا'],['يستاهل الانتظار','أفضله فورًا'],['خطوة صغيرة','قرار كبير']
] as const;
export type WavePair={id:number;left:string;right:string};
export type WavePlayer={id:string;name:string;online:boolean;done:boolean};
export type WavePhase='lobby'|'clue'|'guess'|'result'|'complete';
export type WaveResult={turn:number;pair:WavePair;clue:string;target:number;average:number|null;points:number;guesses:Record<string,number>;giver:string};
export type WaveView={game:'wave';id:string;code:string;round:number;step:number;revision:number;server_time:string;phase:WavePhase;me:string;is_host:boolean;host_offline:boolean;players:WavePlayer[];members:WavePlayer[];giver:string|null;pair:WavePair|null;clue:string;turn:number;total:number;score:number;my_guess:number|null;result:WaveResult|null;history:WaveResult[];timer:TimerState;deadline:string|null};
export type WaveLocal={version:1;created_at:number;round:number;step:number;phase:Exclude<WavePhase,'lobby'>;players:{id:string;name:string}[];giver_index:number;pair:WavePair;used:number[];target:number;clue:string;guesses:Record<string,number>;turn:number;total:number;score:number;history:WaveResult[];timer:TimerState;deadline:string|null};
const invalid=(code:string):never=>{throw new Error(code);};
export const wavePoints=(distance:number)=>distance<=4?4:distance<=9?3:distance<=16?2:distance<=24?1:0;
export function validWaveClue(value:unknown):string{
  if(typeof value!=='string')return invalid('WAVE_CLUE');const text=value.trim();
  if(text.length<2||text.length>80||/[0-9٠-٩۰-۹\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(text))return invalid('WAVE_CLUE');return text;
}
function pick(used:number[]):WavePair{const choices=wavePairs.map((_,i)=>i).filter(i=>!used.includes(i));const id=choices[randomIndex(choices.length)];return {id,left:wavePairs[id][0],right:wavePairs[id][1]};}
export function newWave(names:string[],total=6,previous?:WaveLocal):WaveLocal{
  if(names.length<2||names.length>12)invalid('WAVE_PLAYERS');
  const clean=names.map(n=>n.trim());if(clean.some(n=>n.length<2||n.length>20||/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(n)))invalid('NAME_INVALID');
  if(new Set(clean.map(n=>n.toLowerCase())).size!==clean.length)invalid('NAME_TAKEN');if(![4,6,8,12].includes(total))invalid('WAVE_ROUNDS');
  const pair=pick([]);return {version:1,created_at:Date.now(),round:(previous?.round??0)+1,step:1,phase:'clue',players:clean.map((name,i)=>({id:`p${i}`,name})),giver_index:randomIndex(clean.length),pair,used:[pair.id],target:randomIndex(101),clue:'',guesses:{},turn:1,total,score:0,history:[],timer:{enabled:previous?.timer.enabled??false,paused:false,remaining_seconds:null,duration_seconds:previous?.timer.duration_seconds??120},deadline:null};
}
export function wavePublic(g:WaveLocal):WaveView{
  const players=g.players.map(p=>({...p,online:true,done:Object.hasOwn(g.guesses,p.id)}));
  return {game:'wave',id:'local',code:'',round:g.round,step:g.step,revision:g.step,server_time:new Date().toISOString(),phase:g.phase,me:g.players[0].id,is_host:true,host_offline:false,players,members:players,giver:g.players[g.giver_index].id,pair:g.pair,clue:g.clue,turn:g.turn,total:g.total,score:g.score,my_guess:null,result:['result','complete'].includes(g.phase)?g.history.at(-1)??null:null,history:g.history,timer:g.timer,deadline:g.deadline};
}
export function waveLocalAction(old:WaveLocal,actor:string,action:string,payload:Record<string,unknown>={}):WaveLocal{
  const g=structuredClone(old),giver=g.players[g.giver_index].id;
  if(!g.players.some(p=>p.id===actor))invalid('NOT_MEMBER');
  const resolve=()=>{const votes=Object.values(g.guesses);if(!votes.length)invalid('WAVE_NO_GUESSES');const average=Math.round(votes.reduce((a,b)=>a+b,0)/votes.length),points=wavePoints(Math.abs(g.target-average));g.score+=points;g.history.push({turn:g.turn,pair:g.pair,clue:g.clue,target:g.target,average,points,guesses:{...g.guesses},giver});g.phase=g.turn===g.total?'complete':'result';g.step++;g.deadline=null;g.timer.paused=false;g.timer.remaining_seconds=null;};
  if(action==='clue'){
    if(g.phase!=='clue')invalid('WRONG_PHASE');if(actor!==giver)invalid('WAVE_GIVER_ONLY');g.clue=validWaveClue(payload.clue);g.phase='guess';g.step++;g.deadline=g.timer.enabled?new Date(Date.now()+g.timer.duration_seconds*1000).toISOString():null;
  }else if(action==='guess'){
    if(g.phase!=='guess')invalid('WRONG_PHASE');if(actor===giver)invalid('WAVE_GIVER_GUESS');
    const value=payload.value;if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>100)invalid('WAVE_GUESS');if(Object.hasOwn(g.guesses,actor))invalid('WAVE_LOCKED');g.guesses[actor]=value as number;
    if(Object.keys(g.guesses).length===g.players.length-1)resolve();
  }else if(action==='resolve'){
    if(g.phase!=='guess')invalid('WRONG_PHASE');if(actor!==g.players[0].id)invalid('HOST_ONLY');if(!payload.force&&Object.keys(g.guesses).length<g.players.length-1)invalid('WAVE_WAIT');resolve();
  }else if(action==='next'){
    if(g.phase!=='result')invalid('WRONG_PHASE');if(actor!==g.players[0].id)invalid('HOST_ONLY');g.round++;g.turn++;g.step++;g.giver_index=(g.giver_index+1)%g.players.length;g.pair=pick(g.used);g.used.push(g.pair.id);g.target=randomIndex(101);g.clue='';g.guesses={};g.phase='clue';g.deadline=null;
  }else if(action.startsWith('timer_')){
    if(g.phase!=='guess')invalid('WRONG_PHASE');if(actor!==g.players[0].id)invalid('HOST_ONLY');const remaining=g.timer.paused?g.timer.remaining_seconds??0:g.deadline?Math.max(0,Math.ceil((Date.parse(g.deadline)-Date.now())/1000)):g.timer.duration_seconds;
    if(action==='timer_disable'){g.timer.enabled=false;g.timer.paused=false;g.timer.remaining_seconds=null;g.deadline=null;}
    else if(action==='timer_pause'){if(g.timer.enabled&&!g.timer.paused){g.timer.paused=true;g.timer.remaining_seconds=remaining;g.deadline=null;}}
    else if(action==='timer_resume'){if(g.timer.enabled&&g.timer.paused){g.deadline=new Date(Date.now()+remaining*1000).toISOString();g.timer.paused=false;g.timer.remaining_seconds=null;}}
    else if(action==='timer_set'){const seconds=payload.seconds;if(typeof seconds!=='number'||!Number.isInteger(seconds)||seconds<15||seconds>900)invalid('INVALID_SECONDS');g.timer.duration_seconds=seconds as number;if(g.timer.paused)g.timer.remaining_seconds=seconds as number;else if(g.timer.enabled)g.deadline=new Date(Date.now()+(seconds as number)*1000).toISOString();}
    else if(action==='timer_enable'||action==='timer_reset'){g.timer.enabled=true;g.timer.paused=false;g.timer.remaining_seconds=null;g.deadline=new Date(Date.now()+g.timer.duration_seconds*1000).toISOString();}else invalid('ACTION_INVALID');
  }else invalid('ACTION_INVALID');return g;
}
export function restoreWave(raw:string|null):WaveLocal|null{
  if(!raw||raw.length>80000)return null;try{const g=JSON.parse(raw) as WaveLocal;if(g.version!==1||!Number.isFinite(g.created_at)||Date.now()-g.created_at>86400000||g.created_at>Date.now()+60000||!Array.isArray(g.players)||g.players.length<2||g.players.length>12)return null;
    if(!['clue','guess','result','complete'].includes(g.phase)||![4,6,8,12].includes(g.total)||!Number.isInteger(g.turn)||g.turn<1||g.turn>g.total||!Number.isInteger(g.giver_index)||g.giver_index<0||g.giver_index>=g.players.length)return null;
    if(!Number.isInteger(g.target)||g.target<0||g.target>100||!g.pair||!Array.isArray(g.used)||!Array.isArray(g.history)||!g.guesses||!g.timer||!Number.isInteger(g.round)||!Number.isInteger(g.step))return null;
    if(g.players.some(p=>typeof p.id!=='string'||typeof p.name!=='string'||p.name.length<2||p.name.length>20)||new Set(g.players.map(p=>p.id)).size!==g.players.length)return null;
    if(typeof g.pair.left!=='string'||typeof g.pair.right!=='string'||typeof g.clue!=='string'||g.clue.length>80||!Number.isInteger(g.score)||g.score<0||g.score>g.total*4)return null;
    if(typeof g.timer.enabled!=='boolean'||typeof g.timer.paused!=='boolean'||!Number.isInteger(g.timer.duration_seconds)||g.timer.duration_seconds<15||g.timer.duration_seconds>900)return null;
    if(g.deadline!==null&&(typeof g.deadline!=='string'||!Number.isFinite(Date.parse(g.deadline))))return null;
    if(Object.entries(g.guesses).some(([id,v])=>!g.players.some(p=>p.id===id)||!Number.isInteger(v)||v<0||v>100))return null;
    if(g.history.length>g.total||g.history.some(h=>!h.pair||typeof h.pair.left!=='string'||typeof h.pair.right!=='string'||typeof h.clue!=='string'||!h.guesses||!Number.isInteger(h.target)||h.target<0||h.target>100||!Number.isInteger(h.points)||h.points<0||h.points>4))return null;
    return g;
  }catch{return null;}
}
