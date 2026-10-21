'use client';
import { RoundScores } from '@/components/round-scores';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Eye, EyeOff, Flag, LockKeyhole, MessageCircle, Plus, RefreshCw, Smartphone, Trophy, Users, X } from 'lucide-react';
import { Brand, Footer } from './brand';
import { TimerPanel } from './timer-panel';
import { advanceRole, castLocalVote, changeLocalTimer, localResult, localWords, newLocalRound, openLocalVote, remainingSeconds, restoreLocalRound, type LocalRound, type TimerCommand } from '@/lib/local-game';

const storageKey='fatin-local-v1';
export function LocalGame() {
  const [round,setRound]=useState<LocalRound|null>(null);
  const [loaded,setLoaded]=useState(false);
  const [names,setNames]=useState(['','','']);
  const [seconds,setSeconds]=useState(120);
  const [timed,setTimed]=useState(true);
  const [shown,setShown]=useState(false);
  const [seen,setSeen]=useState(false);
  const [selected,setSelected]=useState<number|null>(null);
  const [error,setError]=useState('');
  const [storageWarning,setStorageWarning]=useState(false);
  const [clock,setClock]=useState(0);
  useEffect(()=>{
    try {
      const saved=restoreLocalRound(sessionStorage.getItem(storageKey));
      if(saved) {setRound(saved);setNames(saved.players);setSeconds(saved.timer.duration_seconds);setTimed(saved.timer.enabled);}
    } catch {setStorageWarning(true);}
    setClock(Date.now()); setLoaded(true);
  },[]);
  useEffect(()=>{
    if(!loaded) return;
    try {if(round) sessionStorage.setItem(storageKey,JSON.stringify(round)); else sessionStorage.removeItem(storageKey);}
    catch {setStorageWarning(true);}
  },[round,loaded]);
  useEffect(()=>{
    const hide=()=>setShown(false);
    const onVisibility=()=>{hide();setClock(Date.now());};
    window.addEventListener('blur',hide); document.addEventListener('visibilitychange',onVisibility);
    const tick=setInterval(()=>setClock(Date.now()),1000);
    return ()=>{window.removeEventListener('blur',hide);document.removeEventListener('visibilitychange',onVisibility);clearInterval(tick);};
  },[]);
  useEffect(()=>{
    if(!shown || round?.phase!=='reveal') return;
    const timeout=setTimeout(()=>setShown(false),12000); return ()=>clearTimeout(timeout);
  },[shown,round?.phase,round?.cursor]);
  function transition(next: LocalRound|null) {
    setShown(false);setSeen(false);setSelected(null);setError('');setRound(next);setClock(Date.now());
  }
  function start(previous?: LocalRound) {
    try {
      const next=newLocalRound(previous?.players??names,previous?.timer.duration_seconds??seconds,previous);
      if(!previous) next.timer.enabled=timed;
      transition(next);
    } catch(e) {setError(e instanceof Error?e.message:'تعذّر بدء الجولة.');}
  }
  function timerAction(command: TimerCommand,value?: number) {
    if(!round) return;
    try {
      const next=changeLocalTimer(round,command,value);
      setRound(next);setSeconds(next.timer.duration_seconds);setTimed(next.timer.enabled);setClock(Date.now());setError('');
    }
    catch(e) {setError(e instanceof Error?e.message:'تعذّر تعديل الوقت.');}
  }
  function cancel() {
    if(!confirm('إنهاء الجولة المحلية والعودة للأسماء؟ لن نكشف الكلمة أو الأدوار.')) return;
    if(round) {setNames(round.players);setSeconds(round.timer.duration_seconds);setTimed(round.timer.enabled);}
    transition(null);
  }
  const current=round?.players[round.cursor];
  const result=round?.phase==='result'?localResult(round):null;
  const secret=round && shown && round.phase==='reveal' ? {outsider:round.cursor===round.outsider,category:localWords[round.wordIndex][0],word:localWords[round.wordIndex][1]} : null;
  return <div className="room-shell local-shell">
    <header className="header room-header"><Brand/><span className="connection"><Smartphone size={16}/> جوال واحد</span></header>
    <main id="main"><div className="room-title"><div><span className="section-kicker">فطين معكم، جهاز واحد يكفي <span className="purple">✳</span></span><h1>برا السالفة</h1><p>{round?`الجولة ${round.round.toLocaleString('ar-SA')} · `:''}مرّروا الجوال، وخبّوا أدواركم.</p></div><Link className="text-button" href="/">ألعاب فطين</Link></div>
      {storageWarning && <div className="notice" role="status">المتصفح لا يسمح بحفظ الجلسة. خلكم في الصفحة؛ تحديثها ينهي الجولة.</div>}
      {error && <div className="error-message" role="alert">{error}</div>}
      {!loaded ? <div className="empty-page"><p>نجهّز فطين…</p></div> : !round ? <section className="panel local-setup">
        <div className="stage-icon"><Users size={32}/></div><h2>مين يلعب معنا؟</h2><p className="muted">أضيفوا أسماءكم بالترتيب اللي بيمرّ فيه الجوال. من ٣ إلى ١٢ لاعبًا.</p>
        <form onSubmit={e=>{e.preventDefault();start();}}>
          <p className="field-note">الأسماء اختيارية؛ فطين يسمّي الخانات الفارغة لاعب 1، لاعب 2…</p><div className="local-names">{names.map((name,i)=><div className="local-name-row" key={i}><span className={`avatar avatar-${i%4}`}>{i+1}</span><label><span>اسم اللاعب {i+1}</span><input aria-label={`اسم اللاعب ${i+1}`} value={name} onChange={e=>setNames(names.map((n,j)=>j===i?e.target.value:n))} minLength={2} maxLength={20} autoComplete="off" placeholder={`لاعب ${i+1} (اختياري)`}/></label><button className="icon-button" type="button" aria-label={`حذف اللاعب ${i+1}`} disabled={names.length<=3} onClick={()=>setNames(names.filter((_,j)=>j!==i))}><X size={17}/></button></div>)}</div>
          <button className="button white full" type="button" disabled={names.length>=12} onClick={()=>setNames([...names,''])}><Plus size={17}/> إضافة لاعب <span>{names.length}/12</span></button>
          <div className="local-settings"><label>وقت النقاش<select value={seconds} onChange={e=>setSeconds(Number(e.target.value))}>{![60,120,180,300].includes(seconds)&&<option value={seconds}>{seconds.toLocaleString('ar-SA')} ثانية (مدتكم الحالية)</option>}<option value={60}>دقيقة</option><option value={120}>دقيقتان</option><option value={180}>٣ دقائق</option><option value={300}>٥ دقائق</option></select></label><label className="check-label"><input type="checkbox" checked={timed} onChange={e=>setTimed(e.target.checked)}/> تشغيل المؤقت</label></div>
          <button className="button primary full">وزّع الأدوار</button>
        </form><p className="local-privacy"><LockKeyhole size={14}/> الأدوار على هذا الجهاز فقط. لا تعطوا الجوال لغير صاحب الدور وهو مفتوح. إغلاق التبويب قد ينهي الجلسة.</p>
      </section> : <>
        <ol className="phase-track local-progress" aria-label="مراحل اللعب">{[['reveal','الأدوار'],['discuss','النقاش'],['vote','التصويت'],['result','النتيجة']].map(([phase,title],i)=><li className={`phase-step ${round.phase===phase || phase==='result'&&round.phase==='summary'?'active':''}`} key={phase} aria-current={round.phase===phase?'step':undefined}><span>{i+1}</span>{title}</li>)}</ol>
        <section className="panel stage-panel local-stage">
          {round.phase==='reveal' && <>
            <span className="soft-badge">اللاعب {round.cursor+1} من {round.players.length}</span><div className="stage-icon"><Smartphone size={33}/></div><h2>سلّم الجوال إلى <strong className="purple">{current}</strong></h2><p>الباقي يبعدون نظرهم. افتح دورك لما يكون الجوال معك.</p>
            {secret ? <div className={`role-card ${secret.outsider?'outsider':''}`}><small>الفئة: {secret.category}</small><h3>{secret.outsider?'أنت برا السالفة!':secret.word}</h3><p>{secret.outsider?'استنتج الكلمة من أسئلتهم، وخلك طبيعي.':'أنت داخل السالفة. احفظ الكلمة ولا تكشفها.'}</p><button className="text-button" onClick={()=>setShown(false)}><EyeOff size={16} className="inline"/> إخفاء دوري</button></div> : <button className="button light-purple" onClick={()=>{setShown(true);setSeen(true);}}><Eye size={18}/> أنا {current}، اعرض دوري</button>}
            <span className="secret-help">الدور يختفي بعد ١٢ ثانية أو عند مغادرة الشاشة.</span>
            {seen && <button className="button primary full" onClick={()=>transition(advanceRole(round))}><Check size={18}/> {round.cursor===round.players.length-1?'حفظت دوري، نبدأ النقاش':'حفظت دوري، أخفِه ومرّر الجوال'}</button>}
          </>}
          {round.phase==='discuss' && <><div className="stage-icon"><MessageCircle size={33}/></div><h2>خلّ أسئلتك فطينة.</h2><p>الكل شاف دوره. حطوا الجوال بالنص واسألوا بعض بالتناوب، بدون ما تقولون الكلمة.</p><TimerPanel key={`timer-${round.round}`} timer={round.timer} remaining={remainingSeconds(round.timer,round.deadline,clock)} host onAction={timerAction}/><p className="small-info">انتهاء المؤقت ما يفتح التصويت تلقائيًا. المضيف يختار وقت الانتقال.</p><button className="button primary full" onClick={()=>transition(openLocalVote(round))}><Flag size={17}/> نبدأ التصويت</button></>}
          {round.phase==='vote' && <><span className="soft-badge">التصويت {round.cursor+1} من {round.players.length}</span><div className="stage-icon"><Flag size={32}/></div><h2>الجوال عند <strong className="purple">{current}</strong>؟</h2><p>كل واحد يصوّت لحاله ثم يمرّر الجوال. التصويت هنا بدون مؤقت حتى يأخذ الجميع دورهم.</p>{!shown ? <button className="button primary" onClick={()=>setShown(true)}>أنا {current}، بأصوّت</button> : <><div className="vote-grid">{round.players.map((name,i)=>i===round.cursor?null:<button key={i} className={`vote-option ${selected===i?'selected':''}`} aria-pressed={selected===i} onClick={()=>setSelected(i)}><span className={`avatar avatar-${i%4}`}>{name[0]}</span><span>{name}</span>{selected===i&&<Check size={17}/>}</button>)}</div><button className="button primary full" disabled={selected===null} onClick={()=>{if(selected!==null)transition(castLocalVote(round,selected));}}>تثبيت صوتي وإخفاؤه</button></>}</>}
          {round.phase==='summary' && <><div className="stage-icon"><Check size={32}/></div><h2>أصواتكم وصلت.</h2><p>حطوا الجوال قدّام الجميع. جاهزين نعرف مين برا السالفة؟</p><button className="button primary" onClick={()=>transition({...round,phase:'result'})}>اكشف النتيجة <Eye size={18}/></button></>}
          {round.phase==='result' && result && <><div className={`stage-icon ${result.caught?'success':''}`}><Trophy size={33}/></div><h2>{result.caught?'قفطتوه!':'مشّاها عليكم!'}</h2><p><strong className="purple">{round.players[round.outsider]}</strong> كان برا السالفة. {result.tied?'تعادلت الأصوات، وفاز اللي برا السالفة.':result.caught?'فاز اللي داخل السالفة.':'فاز اللي برا السالفة.'}</p><div className="result-word"><small>الكلمة كانت</small><strong>{localWords[round.wordIndex][1]}</strong></div><RoundScores scores={result.scores}/><div className="result-tally">{round.players.map((name,i)=><div className="result-row" key={i}><span>{name} {i===round.outsider?'✳':''}</span><span className="result-bar"><i style={{width:`${result.counts[i]/round.players.length*100}%`}}/></span><b>{result.counts[i]}</b></div>)}</div><button className="button primary full" onClick={()=>start(round)}><RefreshCw size={18}/> جولة جديدة مع فطين</button><p className="small-info">كلمة مختلفة، ولاعب آخر برا السالفة.</p><button className="text-button" onClick={()=>{setNames(round.players);transition(null);}}>تعديل اللاعبين</button></>}
        </section><div className="room-actions local-actions"><button className="text-button danger" onClick={cancel}>{round.phase==='result'?'إنهاء الجلسة':'إلغاء الجولة وتعديل اللاعبين'}</button><span className="muted text-xs">جوال واحد · فطين</span></div>
      </>}
    </main><Footer/>
  </div>;
}
