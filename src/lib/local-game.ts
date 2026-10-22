import content from '../../content/game-content.json' with { type: 'json' };
import { defaultPlayerNames } from './player-names.ts';
import { roundScores } from './round-scores.ts';
export type TimerState = { enabled: boolean; paused: boolean; remaining_seconds: number | null; duration_seconds: number };
export type TimerCommand = 'timer_enable' | 'timer_disable' | 'timer_pause' | 'timer_resume' | 'timer_reset' | 'timer_set';
export type LocalRound = {
  version: 1; createdAt: number; players: string[]; round: number;
  phase: 'reveal' | 'discuss' | 'vote' | 'summary' | 'result';
  cursor: number; wordIndex: number; outsider: number; votes: number[];
  timer: TimerState; deadline: number | null;
};
export const localWords = content.outsider;

export function randomIndex(size: number): number {
  if (!Number.isInteger(size) || size<1) throw new Error('عدد غير صالح');
  const values = new Uint32Array(1);
  const limit = Math.floor(0x100000000/size)*size;
  do { crypto.getRandomValues(values); } while (values[0]>=limit);
  return values[0]%size;
}
export function validateNames(names: string[]) {
  const clean = names.map(name=>name.trim().replace(/\s+/g,' '));
  if (clean.length<3 || clean.length>12) throw new Error('أضف من ٣ إلى ١٢ لاعبًا.');
  if (clean.some(name=>name.length<2 || name.length>20 || /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(name))) throw new Error('كل اسم من حرفين إلى ٢٠ حرفًا، دون رموز تحكم.');
  if (new Set(clean.map(name=>name.toLowerCase())).size!==clean.length) throw new Error('استخدم اسمًا مختلفًا لكل لاعب.');
  return clean;
}
export function newLocalRound(names: string[], seconds=120, previous?: LocalRound, now=Date.now(), choose=randomIndex): LocalRound {
  const players=validateNames(defaultPlayerNames(names));
  if (!Number.isInteger(seconds) || seconds<15 || seconds>900) throw new Error('اختر مدة من ١٥ إلى ٩٠٠ ثانية.');
  const words=localWords.map((_,i)=>i).filter(i=>i!==previous?.wordIndex);
  const people=players.map((_,i)=>i).filter(i=>!previous || players[i]!==previous.players[previous.outsider]);
  return {version:1,createdAt:now,players,round:(previous?.round??0)+1,phase:'reveal',cursor:0,
    wordIndex:words[choose(words.length)],outsider:people[choose(people.length)],votes:[],
    timer:{enabled:previous?.timer.enabled??true,paused:false,remaining_seconds:null,duration_seconds:seconds},deadline:null};
}
export function remainingSeconds(timer: TimerState, deadline: number | null, now: number) {
  if (!timer.enabled) return 0;
  if (timer.paused) return timer.remaining_seconds??0;
  return deadline===null ? timer.duration_seconds : Math.max(0,Math.ceil((deadline-now)/1000));
}
export function changeLocalTimer(state: LocalRound, command: TimerCommand, seconds=120, now=Date.now()): LocalRound {
  if (state.phase!=='discuss') throw new Error('تحكم المؤقت متاح أثناء النقاش.');
  const timer={...state.timer}; let deadline=state.deadline;
  switch(command) {
    case 'timer_disable': timer.enabled=false; timer.paused=false; timer.remaining_seconds=null; deadline=null; break;
    case 'timer_enable':
      if (timer.enabled) return state;
      timer.enabled=true; timer.paused=false; timer.remaining_seconds=null; deadline=now+timer.duration_seconds*1000; break;
    case 'timer_pause':
      if (!timer.enabled || timer.paused) return state;
      timer.remaining_seconds=remainingSeconds(timer,deadline,now); timer.paused=true; deadline=null; break;
    case 'timer_resume':
      if (!timer.enabled || !timer.paused) return state;
      deadline=now+(timer.remaining_seconds??0)*1000; timer.paused=false; timer.remaining_seconds=null; break;
    case 'timer_reset': timer.enabled=true; timer.paused=false; timer.remaining_seconds=null; deadline=now+timer.duration_seconds*1000; break;
    case 'timer_set':
      if (!Number.isInteger(seconds) || seconds<15 || seconds>900) throw new Error('اختر مدة من ١٥ إلى ٩٠٠ ثانية.');
      timer.duration_seconds=seconds;
      if(timer.paused) timer.remaining_seconds=seconds;
      else if(timer.enabled) deadline=now+seconds*1000;
      break;
  }
  return {...state,timer,deadline};
}
export function advanceRole(state: LocalRound, now=Date.now()): LocalRound {
  if(state.phase!=='reveal') throw new Error('مرحلة غير صالحة');
  if(state.cursor<state.players.length-1) return {...state,cursor:state.cursor+1};
  return {...state,phase:'discuss',cursor:0,deadline:state.timer.enabled ? now+state.timer.duration_seconds*1000 : null};
}
export function openLocalVote(state: LocalRound): LocalRound {
  if(state.phase!=='discuss') throw new Error('مرحلة غير صالحة');
  return {...state,phase:'vote',cursor:0,votes:[],deadline:null,timer:{...state.timer,paused:false,remaining_seconds:null}};
}
export function castLocalVote(state: LocalRound, target: number): LocalRound {
  if(state.phase!=='vote' || state.votes.length!==state.cursor) throw new Error('مرحلة غير صالحة');
  if(!Number.isInteger(target) || target<0 || target>=state.players.length || target===state.cursor) throw new Error('اختر لاعبًا آخر.');
  const votes=[...state.votes,target];
  return {...state,votes,cursor:votes.length===state.players.length ? 0 : state.cursor+1,phase:votes.length===state.players.length ? 'summary' : 'vote'};
}
export function localResult(state: LocalRound) {
  if(state.phase!=='result') throw new Error('النتيجة لم تُكشف بعد.');
  const counts=state.players.map((_,i)=>state.votes.filter(v=>v===i).length);
  const top=Math.max(...counts); const leaders=counts.map((v,i)=>v===top?i:-1).filter(i=>i>=0);
  return {scores:roundScores(state.players.map((name,i)=>({id:String(i),name})),String(state.outsider),Object.fromEntries(state.votes.map((target,i)=>[String(i),String(target)]))),counts,tied:leaders.length>1,caught:leaders.length===1 && leaders[0]===state.outsider};
}
// Restore the session only; the UI never persists whether a secret is visible.
export function restoreLocalRound(raw: string | null, now=Date.now()): LocalRound | null {
  if (!raw) return null;
  try {
    const s: LocalRound=JSON.parse(raw);
    if(s.version!==1 || !Number.isFinite(s.createdAt) || now-s.createdAt>86400000 || s.createdAt>now+60000) return null;
    if(!Array.isArray(s.players) || s.players.some(p=>typeof p!=='string')) return null;
    validateNames(s.players);
    if(!['reveal','discuss','vote','summary','result'].includes(s.phase)) return null;
    if(!Number.isInteger(s.round) || s.round<1 || !Number.isInteger(s.cursor) || s.cursor<0 || s.cursor>=s.players.length) return null;
    if(!Number.isInteger(s.wordIndex) || s.wordIndex<0 || s.wordIndex>=localWords.length || !Number.isInteger(s.outsider) || s.outsider<0 || s.outsider>=s.players.length) return null;
    if(!Array.isArray(s.votes) || s.votes.length>s.players.length || s.votes.some((v,i)=>!Number.isInteger(v)||v<0||v>=s.players.length||v===i)) return null;
    if(s.phase==='vote' && s.votes.length!==s.cursor || ['summary','result'].includes(s.phase) && s.votes.length!==s.players.length || ['reveal','discuss'].includes(s.phase) && s.votes.length!==0) return null;
    const t=s.timer;
    if(!t || typeof t.enabled!=='boolean' || typeof t.paused!=='boolean' || !Number.isInteger(t.duration_seconds) || t.duration_seconds<15 || t.duration_seconds>900) return null;
    if(t.remaining_seconds!==null && (!Number.isInteger(t.remaining_seconds)||t.remaining_seconds<0||t.remaining_seconds>900)) return null;
    if(s.deadline!==null && !Number.isFinite(s.deadline)) return null;
    if(t.paused && (!t.enabled || t.remaining_seconds===null || s.deadline!==null)) return null;
    if(!t.enabled && s.deadline!==null) return null;
    return s;
  } catch {return null;}
}
