import content from './party-content.json';
import { randomIndex } from './local-game';
export type PartyKind='wrong'|'letters';
export const partyNames:Record<PartyKind,string>={wrong:'السؤال المغلوط',letters:'حرف ورا حرف'};
export const arabicLetters='ابتثجحخدذرزسشصضطظعغفقكلمنهوي'.split('');
export type PartyPlayer={id:string;name:string;online:boolean;done:boolean;voted:boolean};
export type PartySecret={question:string;input:'text'|'number'};
export type LetterUse={letter:string;actor:string};
export type WrongResult={odd:string;common:string;different:string;tally:Record<string,number>;caught:boolean;tied:boolean};
export type PartyView={game:PartyKind;id:string;code:string;round:number;step:number;revision:number;server_time:string;phase:'lobby'|'answer'|'discuss'|'vote'|'letters'|'result';me:string;is_host:boolean;host_offline:boolean;players:PartyPlayer[];members:PartyPlayer[];answers:Record<string,string>|null;my_answer:string|null;my_vote:string|null;question:string|null;used:LetterUse[];result:WrongResult|null};
export type PartyLocal={version:1;created_at:number;kind:PartyKind;round:number;step:number;phase:Exclude<PartyView['phase'],'lobby'>;players:{id:string;name:string}[];bank_id:number;bank_used:number[];flip:boolean;odd:string;answers:Record<string,string>;votes:Record<string,string>;used:LetterUse[]};
const fail=(code:string):never=>{throw new Error(code);};
export function partyText(value:unknown,max:number){if(typeof value!=='string')return fail('ANSWER_INVALID');const text=value.trim();if(!text||text.length>max||/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(text))return fail('ANSWER_INVALID');return text;}
export function newParty(kind:PartyKind,names:string[],previous?:PartyLocal):PartyLocal{
  if(names.length<(kind==='wrong'?4:1)||names.length>12)fail(kind==='wrong'?'WRONG_PLAYERS':'LETTERS_PLAYERS');
  const clean=names.map(n=>n.trim());if(clean.some(n=>n.length<2||n.length>20||/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(n)))fail('NAME_INVALID');if(new Set(clean.map(n=>n.toLowerCase())).size!==clean.length)fail('NAME_TAKEN');
  const size=kind==='wrong'?content.pairs.length:content.prompts.length;
  let used=previous?.kind===kind?[...previous.bank_used]:[];if(used.length>=size)used=[];
  const available=Array.from({length:size},(_,i)=>i).filter(i=>!used.includes(i)),bank_id=available[randomIndex(available.length)];used.push(bank_id);
  const players=clean.map((name,i)=>({id:`p${i}`,name}));return {version:1,created_at:Date.now(),kind,round:(previous?.round??0)+1,step:1,phase:kind==='wrong'?'answer':'letters',players,bank_id,bank_used:used,flip:randomIndex(2)===1,odd:kind==='wrong'?players[randomIndex(players.length)].id:'',answers:{},votes:{},used:[]};
}
export function partySecret(g:PartyLocal,actor:string):PartySecret{
  if(g.kind!=='wrong'||!g.players.some(p=>p.id===actor))fail('NOT_MEMBER');const pair=content.pairs[g.bank_id];
  return {question:pair[(actor===g.odd?Number(!g.flip):Number(g.flip))],input:pair[2] as 'text'|'number'};
}
function result(g:PartyLocal):WrongResult{
  const tally:Record<string,number>={};for(const value of Object.values(g.votes))tally[value]=(tally[value]??0)+1;
  const ranked=Object.entries(tally).sort((a,b)=>b[1]-a[1]),tied=ranked.length>1&&ranked[0][1]===ranked[1][1];
  const pair=content.pairs[g.bank_id];return {odd:g.odd,common:pair[Number(g.flip)],different:pair[Number(!g.flip)],tally,caught:!tied&&ranked[0]?.[0]===g.odd,tied};
}
export function partyPublic(g:PartyLocal):PartyView{
  const players=g.players.map(p=>({...p,online:true,done:Object.hasOwn(g.answers,p.id),voted:Object.hasOwn(g.votes,p.id)}));
  return {game:g.kind,id:'local',code:'',round:g.round,step:g.step,revision:g.step,server_time:new Date().toISOString(),phase:g.phase,me:g.players[0].id,is_host:true,host_offline:false,players,members:players,answers:g.kind==='wrong'&&g.phase!=='answer'?{...g.answers}:null,my_answer:null,my_vote:null,question:g.kind==='letters'?content.prompts[g.bank_id]:null,used:g.used,result:g.kind==='wrong'&&g.phase==='result'?result(g):null};
}
export function partyLocalAction(old:PartyLocal,actor:string,action:string,payload:Record<string,unknown>={}):PartyLocal{
  const g=structuredClone(old);if(!g.players.some(p=>p.id===actor))fail('NOT_MEMBER');const host=()=>{if(actor!==g.players[0].id)fail('HOST_ONLY');};
  if(action==='answer'){
    if(g.kind!=='wrong'||g.phase!=='answer')fail('WRONG_PHASE');if(Object.hasOwn(g.answers,actor))fail('ANSWER_LOCKED');
    const value=partyText(payload.answer,60);if(content.pairs[g.bank_id][2]==='number'&&!/^[0-9٠-٩۰-۹]+([.,٫][0-9٠-٩۰-۹]+)?$/.test(value))fail('ANSWER_NUMBER');g.answers[actor]=value;
    if(Object.keys(g.answers).length===g.players.length){g.phase='discuss';g.step++;}
  }else if(action==='open_vote'){host();if(g.kind!=='wrong'||g.phase!=='discuss')fail('WRONG_PHASE');g.phase='vote';g.step++;}
  else if(action==='vote'){
    if(g.kind!=='wrong'||g.phase!=='vote')fail('WRONG_PHASE');if(Object.hasOwn(g.votes,actor))fail('ALREADY_VOTED');const target=String(payload.target??'');if(target!=='skip'&&!g.players.some(p=>p.id===target))fail('INVALID_VOTE');g.votes[actor]=target;if(Object.keys(g.votes).length===g.players.length){g.phase='result';g.step++;}
  }else if(action==='finish_vote'){host();if(g.kind!=='wrong'||g.phase!=='vote')fail('WRONG_PHASE');if(!Object.keys(g.votes).length)fail('VOTE_REQUIRED');if(!payload.force&&Object.keys(g.votes).length!==g.players.length)fail('NOT_READY');g.phase='result';g.step++;}
  else if(action==='letter'){
    if(g.kind!=='letters'||g.phase!=='letters')fail('WRONG_PHASE');const letter=String(payload.letter??'');if(!arabicLetters.includes(letter))fail('LETTER_INVALID');if(g.used.some(u=>u.letter===letter))fail('LETTER_USED');g.used.push({letter,actor});if(g.used.length===28){g.phase='result';g.step++;}
  }else if(action==='undo'){
    host();if(g.kind!=='letters'||!['letters','result'].includes(g.phase))fail('WRONG_PHASE');if(!g.used.length||g.used.at(-1)?.letter!==payload.letter)fail('STALE_PHASE');g.used.pop();if(g.phase==='result'){g.phase='letters';g.step++;}
  }else fail('ACTION_INVALID');return g;
}
export function restoreParty(raw:string|null,kind:PartyKind):PartyLocal|null{
  if(!raw||raw.length>60000)return null;try{const g=JSON.parse(raw) as PartyLocal;const size=kind==='wrong'?content.pairs.length:content.prompts.length;
    if(g.version!==1||g.kind!==kind||!Number.isFinite(g.created_at)||Date.now()-g.created_at>86400000||g.created_at>Date.now()+60000||!Number.isInteger(g.bank_id)||g.bank_id<0||g.bank_id>=size)return null;
    if(!Array.isArray(g.players)||g.players.length<(kind==='wrong'?4:1)||g.players.length>12||g.players.some(p=>typeof p.id!=='string'||typeof p.name!=='string'||p.name.length<2||p.name.length>20))return null;
    if(!Number.isInteger(g.round)||g.round<1||!Number.isInteger(g.step)||typeof g.flip!=='boolean'||!Array.isArray(g.bank_used)||!Array.isArray(g.used)||!g.answers||!g.votes)return null;
    const ids=new Set(g.players.map(p=>p.id));if(ids.size!==g.players.length||kind==='wrong'&&!ids.has(g.odd))return null;
    if(!(kind==='wrong'?['answer','discuss','vote','result']:['letters','result']).includes(g.phase))return null;
    if(Object.entries(g.answers).some(([id,a])=>!ids.has(id)||typeof a!=='string'||a.length>60)||Object.entries(g.votes).some(([id,target])=>!ids.has(id)||target!=='skip'&&!ids.has(target)))return null;
    if(g.used.length>28||new Set(g.used.map(u=>u.letter)).size!==g.used.length||g.used.some(u=>!arabicLetters.includes(u.letter)||!ids.has(u.actor)))return null;return g;
  }catch{return null;}
}
