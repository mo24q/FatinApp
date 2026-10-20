'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Fingerprint, Plus, RefreshCw, Smartphone, X } from 'lucide-react';
import { Brand, Footer } from '../brand';
import { CaseTable, CrimeRules, PrivateFile } from './table';
import { accuseCrime,advanceCrimeRole,chooseCrime,closeCrime,crimeSecret,crimeTimer,newCrime,publicCrime,restoreCrime,type LocalCrime } from '@/lib/crime-game';
import { crimeError } from '@/lib/crime-client';

const storageKey='fatin-crime-local-v1';
export function LocalCrimeGame() {
  const [game,setGame]=useState<LocalCrime|null>(null);
  const [names,setNames]=useState(['','','','']);
  const [narrator,setNarrator]=useState(0);
  const [loaded,setLoaded]=useState(false);
  const [error,setError]=useState('');
  const [warning,setWarning]=useState(false);
  const [shown,setShown]=useState(false);
  const [seen,setSeen]=useState(false);
  const [cancel,setCancel]=useState(false);
  useEffect(()=>{
    try {const saved=restoreCrime(sessionStorage.getItem(storageKey));if(saved){setGame(saved);setNames(saved.players.map(p=>p.name));setNarrator(saved.players.findIndex(p=>p.id===saved.narrator_id));}}
    catch{setWarning(true);}
    setLoaded(true);
  },[]);
  useEffect(()=>{if(!loaded)return;try{if(game)sessionStorage.setItem(storageKey,JSON.stringify(game));else sessionStorage.removeItem(storageKey);}catch{setWarning(true);}},[game,loaded]);
  useEffect(()=>{const hide=()=>setShown(false);window.addEventListener('blur',hide);document.addEventListener('visibilitychange',hide);return()=>{window.removeEventListener('blur',hide);document.removeEventListener('visibilitychange',hide);};},[]);
  function change(next:LocalCrime|null,hide=true){setGame(next);setError('');if(hide){setShown(false);setSeen(false);}}
  function run(fn:()=>LocalCrime,hide=true){try{change(fn(),hide);}catch(e){setError(crimeError(e));}}
  function reset(){if(game){setNames(game.players.map(p=>p.name));setNarrator(game.players.findIndex(p=>p.id===game.narrator_id));}change(null);setCancel(false);}
  const view=game?publicCrime(game):null;
  const actor=game?(game.phase==='reveal'?game.order[game.cursor]:game.narrator_id):'';
  const secret=shown&&game?crimeSecret(game,actor):null;
  return <div className="room-shell crime-shell">
    <header className="header room-header"><Brand/><span className="connection"><Smartphone size={16}/>جوال واحد</span></header>
    <main id="main"><div className="crime-heading"><span className="section-kicker">قضية جديدة في فطين</span><h1>الجريمة المغلقة<span className="orange">.</span></h1><p>كل بطاقة تحكي احتمالًا. مين يخفي الحقيقة؟</p><Link className="text-button" href="/crime">طرق اللعب <ArrowLeft size={15}/></Link></div>
      {error&&<div role="alert" className="error-message">{error}</div>}
      {warning&&<div className="notice">الحفظ غير متاح في هذا المتصفح. تحديث الصفحة قد ينهي القضية.</div>}
      {!loaded?<p className="empty-page">نجهّز ملفات القضية…</p>:!game?<section className="panel crime-setup"><div className="stage-icon"><Fingerprint size={32}/></div><h2>اجمع فريق التحقيق</h2><p>٤–١٢ لاعبًا، منهم راوي واحد. اكتبوا الأسماء بالترتيب اللي يمرّ فيه الجوال.</p>
        <form onSubmit={e=>{e.preventDefault();run(()=>newCrime(names,narrator));}}>
          <div className="local-names">{names.map((name,i)=><div className="local-name-row" key={i}><span className={`avatar avatar-${i%4}`}>{i+1}</span><label><span>اسم اللاعب {i+1}</span><input aria-label={`اسم اللاعب ${i+1}`} value={name} onChange={e=>setNames(names.map((n,j)=>j===i?e.target.value:n))} minLength={2} maxLength={20} required placeholder={`اللاعب ${i+1}`} autoComplete="off"/></label><button type="button" className="icon-button" aria-label={`حذف اللاعب ${i+1}`} disabled={names.length<=4} onClick={()=>{setNames(names.filter((_,j)=>j!==i));setNarrator(narrator===i?0:narrator>i?narrator-1:narrator);}}><X size={16}/></button></div>)}</div>
          <button className="button white full" type="button" disabled={names.length>=12} onClick={()=>setNames([...names,''])}><Plus size={17}/>إضافة لاعب · {names.length}/12</button>
          <label className="crime-narrator-select">مَن الراوي؟<select value={narrator} onChange={e=>setNarrator(Number(e.target.value))}>{names.map((name,i)=><option key={i} value={i}>{name||`اللاعب ${i+1}`}</option>)}</select></label>
          <p className="field-note">الراوي يعرف الحل ويدير القضية. ملفه يأتي أخيرًا بعد اختيار المجرم.</p><button className="button primary full">وزّع ملفات القضية</button>
        </form><p className="local-privacy">الأدوار محفوظة على هذا الجهاز. تمرير الجوال يعتمد على الأمانة؛ صور مشاركة البطاقات لا تحتوي على الأدوار أو الحل.</p>
      </section>:view&&<>
        <div className="crime-round-bar"><span>القضية {game.round.toLocaleString('ar-SA')}</span><span>{game.phase==='reveal'?`توزيع الملفات ${game.cursor+1}/${game.order.length}`:game.phase==='investigate'?'التحقيق مفتوح':'أُغلق الملف'}</span></div>
        {game.phase==='reveal'?<PrivateFile key={`${game.round}-${actor}`} view={view} actor={actor} secret={secret} shown={shown} busy={false} seen={seen} onShow={()=>{setShown(true);setSeen(true);}} onHide={()=>setShown(false)} onChoose={(w,e)=>run(()=>chooseCrime(game,actor,w,e),false)} onReady={()=>run(()=>advanceCrimeRole(game))}/>:<>
          <CaseTable key={game.round} view={view} local busy={false} secret={secret} onSecret={()=>setShown(true)} onHide={()=>setShown(false)}
            onAccuse={(a,t,w,e)=>run(()=>accuseCrime(game,a,t,w,e))}
            onClose={()=>run(()=>closeCrime(game,game.narrator_id))}
            onTimer={(command,seconds)=>run(()=>crimeTimer(game,command,seconds),false)}/>
          {game.phase==='result'&&<div className="crime-replay"><button className="button primary full" onClick={()=>run(()=>newCrime(game.players.map(p=>p.name),game.players.findIndex(p=>p.id===game.narrator_id),game))}><RefreshCw size={18}/>قضية جديدة وبطاقات جديدة</button><button className="text-button" onClick={reset}>تعديل اللاعبين والراوي</button></div>}
        </>}
        <div className="crime-end">{cancel?<div className="crime-confirm-box"><p>ننهي القضية ونرجع للأسماء دون كشف الحل؟</p><button className="button white" onClick={reset}>نعم، إنهاء الجلسة</button><button className="text-button" onClick={()=>setCancel(false)}>نكمل اللعب</button></div>:<button className="text-button danger" onClick={()=>{setShown(false);setCancel(true);}}>إنهاء الجلسة</button>}</div>
      </>}
      <CrimeRules/>
    </main><Footer/>
  </div>;
}
