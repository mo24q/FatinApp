'use client';
import { useState } from 'react';
import { Axe, Bell, BookOpen, Camera, Check, Circle, CircleHelp, Coins, Disc3, Dumbbell, Feather, Flag, Flashlight, Flower2, Gem, Glasses, Hammer, Headphones, KeyRound, Leaf, Link2, LockKeyhole, Mail, Map, Paintbrush, Paperclip, Puzzle, ReceiptText, Scissors, Share2, Shirt, ShoppingBag, Smartphone, Ticket, Trophy, Umbrella, Usb, Wallet, Watch, Wrench } from 'lucide-react';
import { crimeCardById, type CrimeCard } from '@/lib/crime-content';
import { shareCrimeHand, type CrimeHand, type CrimeSolution } from '@/lib/crime-game';

const artIcons = {hammer:Hammer,axe:Axe,wrench:Wrench,tool:Wrench,scissors:Scissors,rope:Link2,chain:Link2,cable:Usb,weight:Dumbbell,umbrella:Umbrella,flashlight:Flashlight,trophy:Trophy,bell:Bell,lock:LockKeyhole,key:KeyRound,watch:Watch,ring:Circle,glasses:Glasses,phone:Smartphone,wallet:Wallet,ticket:Ticket,receipt:ReceiptText,photo:Camera,button:Circle,glove:Shirt,cloth:Shirt,feather:Feather,leaf:Leaf,flower:Flower2,mail:Mail,map:Map,pen:Paintbrush,book:BookOpen,coin:Coins,card:Ticket,headphones:Headphones,hat:Shirt,tie:Shirt,clip:Paperclip,necklace:Gem,badge:Flag,paper:ReceiptText,bag:ShoppingBag,brush:Paintbrush,mirror:Circle,usb:Usb,camera:Camera,disc:Disc3,ball:Circle,shell:Gem,puzzle:Puzzle} as const;
function ObjectShape({art}:{art:string}) {
  switch(art) {
    case 'knife':case 'cleaver':return <><path d={art==='knife'?'M25 70 65 23Q82 38 61 59L44 73Z':'M26 60 59 21 83 43 51 77Z'} fill="#d9e2ec"/><path d="m24 69 16 13 13-15-15-13z" fill="#b78060"/><circle cx="37" cy="69" r="2" fill="#fff"/></>;
    case 'bottle':case 'perfume':return <><rect x="40" y="15" width="21" height="14" rx="4" fill="#ba8b68"/><path d="M42 29v12Q29 45 29 57v25h43V57Q72 45 59 41V29" fill="#c1dcca"/><rect x="34" y="57" width="33" height="17" rx="3" fill="#fffaf0"/><path d="M42 35v10M37 49v25" opacity=".6"/></>;
    case 'bat':case 'cane':case 'plank':return <><path d="M35 83 65 20Q71 10 79 20L49 88Z" fill="#d4aa79"/><path d="m37 71 13 6m-16 0 13 6M62 32l4-8" opacity=".65"/></>;
    case 'shard':case 'rock':return <><path d="m22 64 13-35 34-10 12 33-21 33-30-5Z" fill={art==='rock'?'#c8c3d2':'#c5e4e9'}/><path d="m35 29 11 31 23-41M22 64l24-4 14 25 21-33-35 8" opacity=".45"/></>;
    case 'stapler':return <><path d="M20 71h62v11H20Z" fill="#c7cbd5"/><path d="m22 65 4-34 55 20-4 17Z" fill="#c8b6de"/><path d="m29 41 43 15M27 66v9m47-9v9"/><circle cx="29" cy="60" r="3" fill="#f5e8dc"/></>;
    case 'brick':case 'case':case 'box':return <><path d="m20 40 45-17 21 20v32L41 88 20 70Z" fill="#d4a28b"/><path d="m20 40 21 18 45-15M41 58v30"/><path d="m35 36 17 15m1-22 17 16" opacity=".4"/>{art==='case'&&<path d="M41 31V18h21v9"/>}</>;
    case 'pot':return <><path d="M25 40h50v35q-25 14-50 0Z" fill="#c9cfdb"/><path d="M22 39h56M31 32q19-14 38 0M44 23v-6h12v6M25 48H14v15h11m50-15h11v15H75"/></>;
    case 'pan':return <><ellipse cx="42" cy="51" rx="25" ry="24" fill="#c9cfdb"/><ellipse cx="42" cy="51" rx="17" ry="16" fill="#e8edf4"/><path d="m62 65 21 18" strokeWidth="10" stroke="#b08065"/></>;
    case 'bucket':return <><path d="m23 35 9 46h37l9-46Z" fill="#c6d0dd"/><ellipse cx="50" cy="35" rx="27" ry="7" fill="#e5e9ef"/><path d="M27 35q0-42 46 0M39 49l4 24"/></>;
    case 'kettle':return <><path d="M32 39q-17 33 8 41h25q21-10 5-40Z" fill="#c8dacf"/><path d="m32 46-19-9 12 28h6M70 45q29-11 13 23H72M39 33h25M44 28v-7h14v7"/></>;
    case 'vase':return <><path d="M35 21h32l-5 17q22 24 9 43H29Q16 62 40 38Z" fill="#d3c7eb"/><path d="M33 66h35M40 29h22" opacity=".55"/></>;
    case 'candle':return <><path d="M51 14q-14 17 0 22 14-7 0-22" fill="#f1b45b"/><path d="M42 38h18v29H42Z" fill="#f7e1a5"/><path d="M51 67v13M33 83h36"/></>;
    case 'skewer':return <><path d="m31 82 38-64-28 69Z" fill="#b4c1d0"/><path d="m31 82-8 9" strokeWidth="7"/></>;
    case 'nail':return <><path d="M46 27h8v46l-4 14-4-14Z" fill="#b4c1d0"/><rect x="33" y="18" width="34" height="10" rx="3" fill="#cbd4df"/></>;
    case 'tongs':return <><path d="M28 78 43 24q8-13 15 0l15 54M27 71l-6 12m52-12 6 12" strokeWidth="6" stroke="#99a9b9"/></>;
    case 'fork':return <><path d="M50 83V39M34 17v21q16 18 32 0V17M50 17v22" strokeWidth="6" stroke="#99a9b9"/></>;
    case 'saw':return <><path d="m17 66 51-39 12 17-8 9-7-3-5 12-8-3-6 12-9-3-9 12Z" fill="#c5ced8"/><path d="m68 27 14-11 12 15-14 13Z" fill="#c69871"/></>;
    case 'shovel':return <><path d="M43 57V27M35 17h18v12H35Z" strokeWidth="6" stroke="#b78d69"/><path d="M27 53h34v17L44 88 27 70Z" fill="#c0ccd7"/></>;
    case 'belt':return <><path d="M22 47h60v19H22Z" fill="#c39d7a"/><rect x="20" y="43" width="25" height="27" rx="4" fill="#d8d4dc"/><path d="M25 56h17m12 0h1m9 0h1m9 0h1"/></>;
    case 'thread':return <><path d="M32 28h37v46H32Z" fill="#d7b6ce"/><path d="M27 24h48v9H27ZM27 70h48v9H27Z" fill="#d4b28b"/><path d="m33 40 35 8m-35 0 35 8m-35 0 35 8M67 66q21 3 12 18H58"/></>;
    case 'pipe':return <><path d="M25 75V33h44v44H49V52" fill="none" stroke="#b1a7c6" strokeWidth="12"/><path d="M20 72h12M64 72h12"/></>;
    case 'cup':return <><path d="M25 35h43v39q-22 12-43 0Z" fill="#edcbb0"/><path d="M68 41h10q16 15-10 23M35 23q-8-9 0-13M52 23q-8-9 0-13"/><path d="M20 84h55"/></>;
    case 'dice':return <><rect x="25" y="25" width="52" height="52" rx="12" fill="#f1dfbb"/>{[[38,38],[64,38],[51,51],[38,64],[64,64]].map(([cx,cy])=><circle key={`${cx}${cy}`} cx={cx} cy={cy} r="3" fill="#766185"/>)}</>;
    case 'shoe':return <><path d="M20 58q15 1 24-18l13 12 23 8q9 6 4 18H20Z" fill="#c6d4bd"/><path d="M20 70h64M43 51l10 9m-4-16 13 11"/></>;
    case 'remote':return <><rect x="32" y="13" width="35" height="75" rx="10" fill="#d1c9df"/><circle cx="49" cy="31" r="6" fill="#f1b5a8"/><circle cx="49" cy="54" r="10" fill="#fffaf5"/><path d="M43 73h13"/></>;
    case 'wrapper':return <><path d="m24 20 7 4 7-4 7 4 7-4 7 4 7-4 7 4v57l-7-4-7 4-7-4-7 4-7-4-7 4-7-4Z" fill="#d7bde6"/><rect x="31" y="36" width="34" height="29" rx="3" fill="#ba947b"/><path d="M48 37v27M32 51h32"/></>;
    case 'matches':return <><rect x="26" y="28" width="49" height="48" rx="5" fill="#e9bfaa"/><path d="M32 37h37M34 48h32M40 16l25 69" stroke="#b28b64" strokeWidth="5"/><circle cx="40" cy="16" r="5" fill="#bb7567"/></>;
    case 'mask':return <><path d="M25 35q25 11 50 0v30q-25 22-50 0Z" fill="#b6d8d4"/><path d="M25 39Q3 32 17 63h8m50-24q22-7 8 24h-8M35 49h30M35 58h30"/></>;
    case 'racket':return <><ellipse cx="55" cy="35" rx="23" ry="28" fill="#d4dfcc"/><path d="m43 15 0 40m12-46v53m12-47v40M35 27h40M33 39h44M38 51h34M45 61l-9 23" /><path d="m37 80-6 13" strokeWidth="9" stroke="#bd9779"/></>;
    case 'bow':return <><path d="M25 18q65 32 0 65l15-33Z" fill="#dfc4a4"/><path d="m20 50 65-5-9-6m9 6-8 7"/></>;
    case 'scale':return <><path d="M50 18v64M25 82h50M22 32h56M22 32l-12 28h24Zm56 0L66 60h24Z" fill="#d4c7e0"/><path d="M10 60q12 17 24 0m32 0q12 17 24 0"/></>;
    case 'bookend':return <><path d="M27 22h14v49h40v13H27Z" fill="#c4cfdb"/><path d="m41 71 23-34v34Z" fill="#d4c7e0"/></>;
    case 'iron':return <><path d="M19 75h66L63 40H38Z" fill="#c4cfdb"/><path d="M39 40V25h24v15M28 65h46"/></>;
    case 'drill':return <><path d="M22 28h50v23H54l6 31H40L35 51H22Z" fill="#d1c2e6"/><path d="M72 34h15v12H72M24 35h10"/></>;
    case 'stamp':return <><path d="M42 57V42q-15-22 9-24 24 2 9 24v15Z" fill="#c39b79"/><path d="M30 57h42l8 15H23Z" fill="#d3c8e0"/><rect x="23" y="72" width="57" height="9" rx="3" fill="#aba6bd"/></>;
    case 'hook':return <><path d="M45 18v43q0 25 23 11V57l-9 10" fill="none" strokeWidth="7"/><circle cx="45" cy="17" r="7" fill="#dad1e4"/></>;
    case 'statue':return <><circle cx="50" cy="29" r="14" fill="#d0c1b4"/><path d="M39 44h22l8 32H31Z" fill="#d0c1b4"/><path d="M25 82h50"/></>;
    default:return <CircleHelp x="23" y="23" width="54" height="54"/>;
  }
}
export function CrimeArtwork({card}:{card:CrimeCard}) {
  const Icon=artIcons[card.art as keyof typeof artIcons];
  return <svg className="crime-art" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="40" fill={card.kind==='weapon'?'#f7ece4':'#eeeaf8'} stroke="none"/>
    <path d="m17 21 3-5 3 5-3 5Z" fill="#cbb8df" stroke="none"/><circle cx="82" cy="76" r="3" fill="#e3c3a5" stroke="none"/>
    <g fill="none" stroke="#62566c" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" transform={`rotate(${parseInt(card.id.slice(1))%2?'-8':'8'} 50 50)`}>
      {Icon?<Icon x="23" y="23" width="54" height="54" strokeWidth="1.6" fill={card.kind==='weapon'?'#edcfb788':'#d4c6ec77'}/>:<ObjectShape art={card.art}/>}
    </g>
  </svg>;
}
export function CrimeCardTile({id,selected,onClick,disabled=false,solved=false}:{id:string;selected?:boolean;onClick?:()=>void;disabled?:boolean;solved?:boolean}) {
  const card=crimeCardById[id];
  if(!card)return null;
  const content=<><span className="crime-card-number">{id.slice(1)}</span><CrimeArtwork card={card}/><span className="crime-card-name">{card.name}</span>{(selected||solved)&&<span className="crime-card-check"><Check size={13}/></span>}</>;
  const className=`crime-card ${card.kind} ${selected?'selected':''} ${solved?'solved':''}`;
  return onClick?<button type="button" className={className} aria-label={`${card.kind==='weapon'?'سلاح':'دليل'}: ${card.name}`} aria-pressed={!!selected} disabled={disabled} onClick={onClick}>{content}</button>:<div className={className}>{content}</div>;
}
export function HandGrid({hand,selection,onSelect,disabled,solution}:{hand:CrimeHand;selection?:{weapon:string;evidence:string};onSelect?:(kind:'weapon'|'evidence',id:string)=>void;disabled?:boolean;solution?:CrimeSolution|null}) {
  return <div className="crime-hand" aria-label="أربعة أسلحة يمينًا وأربعة أدلة يسارًا">
    {(['weapon','evidence'] as const).map(kind=><section key={kind} className={`crime-hand-column ${kind}`}><h3><span className="crime-dot"/>{kind==='weapon'?'أسلحة محتملة':'أدلة محتملة'}<small>٤</small></h3><div className="crime-card-stack">{hand[kind==='weapon'?'weapons':'evidence'].map(id=><CrimeCardTile key={id} id={id} selected={selection?.[kind]===id} onClick={onSelect?()=>onSelect(kind,id):undefined} disabled={disabled} solved={!!solution&&solution.killer_id===hand.player_id&&solution[kind]===id}/>)}</div></section>)}
  </div>;
}
export function ShareHand({hand,name}:{hand:CrimeHand;name:string}) {
  const [fallback,setFallback]=useState('');
  const [copied,setCopied]=useState(false);
  async function share() {
    const url=`${location.origin}/crime/cards#${shareCrimeHand(name,hand)}`;
    if(navigator.share) {
      try {await navigator.share({title:`بطاقات ${name} — فطين`,text:'بطاقات ظاهرة للجميع، بدون دور أو حل الجريمة.',url});return;}
      catch(e) {if(e instanceof Error&&e.name==='AbortError')return;}
    }
    try {await navigator.clipboard.writeText(url);setCopied(true);} catch{setFallback(url);}
  }
  return <div className="crime-share"><button className="text-button" onClick={()=>void share()}><Share2 size={15}/>{copied?'تم نسخ رابط البطاقات':'مشاركة هذه البطاقات'}</button>{fallback&&<label>انسخ الرابط<input readOnly value={fallback} dir="ltr" onFocus={e=>e.target.select()}/></label>}<small>رابط ثابت للبطاقات فقط؛ لا يتضمن الدور أو الحل.</small></div>;
}
