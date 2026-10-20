'use client';
import { useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Eye, EyeOff, Fingerprint, Search, ShieldCheck, Trophy } from 'lucide-react';
import { clueBoards, crimeCardById } from '@/lib/crime-content';
import type { CrimeSecret, CrimeView } from '@/lib/crime-game';
import type { TimerCommand } from '@/lib/local-game';
import { TimerPanel } from '../timer-panel';
import { CrimeCardTile, HandGrid, ShareHand } from './cards';

export function CrimeRules() {
  return <details className="crime-rules"><summary>كيف نلعب الجريمة المغلقة؟</summary><ol>
    <li>اختاروا راويًا؛ البقية يستلمون ٤ أسلحة و٤ أدلة لكل شخص، وبينهم مجرم واحد.</li>
    <li>المجرم يختار سرًا سلاحًا ودليلًا من بطاقاته. الحل يظهر للراوي فقط.</li>
    <li>الراوي يرشدكم باختيارات لوحات التلميح، دون ذكر اسم لاعب أو بطاقة. يمكنه تعديلها مع النقاش.</li>
    <li>لكل لاعب غير الراوي اتهام واحد: شخص + سلاح + دليل. الثلاثة لازم تكون صحيحة معًا.</li>
    <li>إذا صح اتهام فاز المحققون. إذا استُخدمت كل المحاولات أو أغلق الراوي القضية، فاز المجرم. المجرم يشارك باتهام تمويهي.</li>
  </ol><p>الوقت اختياري؛ انتهاؤه تنبيه فقط. الراوي يقرر متى يغلق القضية بعد إعطاء الجميع فرصة.</p></details>;
}
export function PrivateFile({view,actor,secret,shown,busy,onShow,onHide,onChoose,onReady,seen}:{
  view:CrimeView;actor:string;secret:CrimeSecret|null;shown:boolean;busy:boolean;onShow:()=>void;onHide:()=>void;
  onChoose:(weapon:string,evidence:string)=>void;onReady?:()=>void;seen:boolean;
}) {
  const [selected,setSelected]=useState({weapon:'',evidence:''});
  const player=view.players.find(p=>p.id===actor);
  const hand=view.hands.find(h=>h.player_id===actor);
  const role=secret?.role;
  return <section className="panel crime-private">
    <div className="crime-private-icon"><Fingerprint size={32}/></div>
    <span className="section-kicker">ملف خاص · أبعدوا النظر</span>
    <h2>الجوال مع {player?.name}؟</h2>
    {!shown||!secret?<><p>افتح ملفك وحدك، وأخفِه قبل تمرير الجوال.</p><button className="button primary" disabled={busy} onClick={onShow}><Eye size={18}/>أنا {player?.name}، افتح ملفي</button></>:<>
      <div className={`crime-role ${role}`}><span>{role==='narrator'?'أنت الراوي':role==='killer'?'أنت المجرم':'أنت محقق'}</span><p>{role==='narrator'?'تعرف الحل. ساعد المحققين من لوحات التلميح دون كشف أسماء البطاقات.':role==='killer'?'خلك طبيعي. اختر سلاحًا ودليلًا من بطاقاتك قبل تسليم الجوال.':'راقب تلميحات الراوي وبطاقات الجميع. عندك اتهام واحد، فاختَر بعناية.'}</p></div>
      {role==='narrator'&&<>{secret.solution?<div className="crime-solution"><p>المجرم: <strong>{view.players.find(p=>p.id===secret.solution?.killer_id)?.name}</strong></p><div className="crime-solution-pair"><CrimeCardTile id={secret.solution.weapon}/><CrimeCardTile id={secret.solution.evidence}/></div></div>:<p className="notice">المجرم يختار الآن. أخفِ الملف وافتحه مجددًا بعد تثبيت الاختيار.</p>}</>}
      {hand&&<HandGrid hand={hand} selection={role==='killer'?secret.solution??selected:undefined} onSelect={role==='killer'&&!view.solution_ready?(kind,id)=>setSelected(s=>({...s,[kind]:id})):undefined} disabled={busy}/>}
      {role==='killer'&&(view.solution_ready?<p className="crime-confirmed"><Check size={16}/>تم تثبيت الاختيار. لا يظهر إلا لك وللراوي.</p>:<button className="button primary full" disabled={busy||!selected.weapon||!selected.evidence} onClick={()=>onChoose(selected.weapon,selected.evidence)}>ثبّت السلاح والدليل سرًا</button>)}
      <button className="button white" onClick={onHide}><EyeOff size={17}/>إخفاء الملف</button>
      <small className="muted">يُخفى عند مغادرة الشاشة. أخفِه بنفسك قبل تسليم الجهاز.</small>
    </>}
    {onReady&&seen&&<button className="button light-purple full" disabled={busy||(role==='killer'&&!view.solution_ready)} onClick={onReady}><Check size={17}/>{player?.ready?'تم تأكيد جاهزيتك':'جاهز، أخفِ الملف وكمل'}</button>}
  </section>;
}
export function CaseTable({view,busy,local=false,onAccuse,onClue,onClose,onTimer,secret,onSecret,onHide}:{
  view:CrimeView;busy:boolean;local?:boolean;
  onAccuse:(actor:string,target:string,weapon:string,evidence:string)=>void;
  onClue:(board:string,choice:string)=>void;onClose:()=>void;
  onTimer:(command:TimerCommand,seconds?:number)=>void;
  secret:CrimeSecret|null;onSecret:()=>void;onHide:()=>void;
}) {
  const [index,setIndex]=useState(0);
  const [accusing,setAccusing]=useState(false);
  const [actor,setActor]=useState(local?'':view.me);
  const [confirmedActor,setConfirmedActor]=useState(false);
  const [target,setTarget]=useState('');
  const [choice,setChoice]=useState({weapon:'',evidence:''});
  const [confirmClose,setConfirmClose]=useState(false);
  const [clock,setClock]=useState(Date.now());
  useEffect(()=>{const id=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(id);},[]);
  const hand=view.hands[Math.min(index,view.hands.length-1)];
  const suspects=view.players.filter(p=>view.hands.some(h=>h.player_id===p.id));
  const viewerNarrator=local||view.me===view.narrator_id;
  const hasAttempt=!view.accusations.some(a=>a.actor===view.me);
  const chosenHand=view.hands.find(h=>h.player_id===target);
  // Capture a server offset only on a new snapshot; don't cancel the ticking clock.
  const [offset,setOffset]=useState(()=>Date.parse(view.server_time)-Date.now());
  useEffect(()=>setOffset(Date.parse(view.server_time)-Date.now()),[view.server_time]);
  const seconds=view.timer.paused?view.timer.remaining_seconds??0:view.deadline?Math.max(0,Math.ceil((Date.parse(view.deadline)-clock-offset)/1000)):0;
  function resetAccusation(){setAccusing(false);setConfirmedActor(false);setChoice({weapon:'',evidence:''});setTarget('');}
  return <div className="crime-table">
    {view.phase==='result'&&view.result&&<section className="panel crime-outcome"><Trophy size={35}/><span className="section-kicker">انتهت القضية</span><h2>{view.result.caught?'انكشفت الجريمة!':'أفلت المجرم!'}</h2><p><strong>{view.players.find(p=>p.id===view.result?.killer_id)?.name??'المجرم'}</strong> كان المجرم. {view.result.caught?'فاز المحققون.':'فاز المجرم.'}</p><div className="crime-solution-pair"><CrimeCardTile id={view.result.weapon} solved/><CrimeCardTile id={view.result.evidence} solved/></div></section>}
    {view.phase==='investigate'&&<>
      <section className="panel crime-clues"><div className="crime-section-title"><div><span className="section-kicker">من الراوي إلى المحققين</span><h2>خيوط القضية</h2></div><Search size={25}/></div>
        <div className="crime-clue-grid">{clueBoards.map(board=><div className="crime-clue-tile" key={board.id}><small>{board.name}</small><strong>{view.clues[board.id]||'بانتظار الراوي'}</strong></div>)}</div>
        <p className="field-note">التلميحات ارتباطات يختارها الراوي. ناقشوا أكثر من احتمال.</p>
      </section>
      {viewerNarrator&&<section className="panel crime-narrator">
        <div className="crime-section-title"><h2>مساحة الراوي</h2><ShieldCheck size={22}/></div>
        {!secret||secret.role!=='narrator'?<><p>الملف التالي يكشف الحل. افتحه فقط عندما يكون الجوال مع الراوي.</p><button className="button white full" onClick={onSecret} disabled={busy}>أنا الراوي، افتح ملف القضية</button></>:<>
          {secret.solution&&<div className="crime-secret-summary"><strong>المجرم: {view.players.find(p=>p.id===secret.solution?.killer_id)?.name}</strong><p>{crimeCardById[secret.solution.weapon]?.name} + {crimeCardById[secret.solution.evidence]?.name}</p></div>}
          <div className="crime-clue-editor">{clueBoards.map(board=><label key={board.id}>{board.name}<select aria-label={`تلميح ${board.name}`} value={view.clues[board.id]||''} disabled={busy} onChange={e=>onClue(board.id,e.target.value)}><option value="" disabled>اختر تلميحًا</option>{board.options.map(option=><option key={option}>{option}</option>)}</select></label>)}</div>
          <button className="button white full" onClick={()=>{onHide();setConfirmClose(false);}}><EyeOff size={16}/>أخفِ حل القضية</button>
          {!confirmClose?<button className="text-button danger" onClick={()=>setConfirmClose(true)}>إغلاق القضية وإعلان فوز المجرم</button>:<div className="crime-confirm-box"><p>متأكد أن الجميع أخذ فرصته؟ إغلاق القضية يكشف الحل وينهي الجولة.</p><button className="button primary" onClick={()=>{onClose();setConfirmClose(false);}} disabled={busy}>نعم، أغلق القضية</button><button className="text-button" onClick={()=>setConfirmClose(false)}>نكمّل التحقيق</button></div>}
        </>}
      </section>}
    </>}
    {hand&&<section className="panel crime-gallery">
      <div className="crime-section-title"><div><span className="section-kicker">البطاقات ظاهرة للجميع</span><h2>طاولة الأدلة</h2></div><span className="soft-badge">{index+1} / {view.hands.length}</span></div>
      <label className="crime-player-select">بطاقات اللاعب<select value={hand.player_id} onChange={e=>setIndex(view.hands.findIndex(h=>h.player_id===e.target.value))}>{view.hands.map(h=><option key={h.player_id} value={h.player_id}>{view.players.find(p=>p.id===h.player_id)?.name??'لاعب سابق'}</option>)}</select></label>
      <HandGrid hand={hand} solution={view.result}/>
      <div className="crime-gallery-nav"><button className="button white" aria-label="اللاعب السابق" onClick={()=>setIndex((index-1+view.hands.length)%view.hands.length)}><ChevronRight size={19}/></button><span>{view.players.find(p=>p.id===hand.player_id)?.name}</span><button className="button white" aria-label="اللاعب التالي" onClick={()=>setIndex((index+1)%view.hands.length)}><ChevronLeft size={19}/></button></div>
      <ShareHand key={hand.player_id} hand={hand} name={view.players.find(p=>p.id===hand.player_id)?.name??'لاعب'}/>
    </section>}
    {view.phase==='investigate'&&(local||view.me!==view.narrator_id)&&<section className="panel crime-accuse">
      <h2>وصلت للحل؟</h2><p>اتهام واحد لكل لاعب. حدّد الشخص والسلاح والدليل معًا.</p>
      {!accusing?<button className="button primary full" disabled={busy||(!local&&!hasAttempt)} onClick={()=>{setAccusing(true);setActor(local?'':view.me);setConfirmedActor(!local);}}>{!local&&!hasAttempt?'استخدمت اتهامك، كمل النقاش':'تقديم اتهام'}</button>:<>
        {local&&!confirmedActor?<div className="crime-confirm-box"><label>مَن بيقدّم الاتهام؟<select aria-label="صاحب الاتهام" value={actor} onChange={e=>setActor(e.target.value)}><option value="">اختر اسمك</option>{suspects.filter(p=>!view.accusations.some(a=>a.actor===p.id)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="button primary full" disabled={!actor} onClick={()=>setConfirmedActor(true)}>أنا {view.players.find(p=>p.id===actor)?.name||'صاحب الدور'}، هذا اتهامي</button></div>:<>
          <label>مَن تتهم؟<select aria-label="المتهم" value={target} onChange={e=>{setTarget(e.target.value);setChoice({weapon:'',evidence:''});}}><option value="">اختر شخصًا</option>{suspects.filter(p=>p.id!==actor).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {chosenHand&&<HandGrid hand={chosenHand} selection={choice} onSelect={(kind,id)=>setChoice(s=>({...s,[kind]:id}))} disabled={busy}/>}
          <button className="button primary full" disabled={busy||!target||!choice.weapon||!choice.evidence} onClick={()=>{onAccuse(actor,target,choice.weapon,choice.evidence);resetAccusation();}}>تثبيت اتهامي الوحيد</button>
        </>}
        <button className="text-button" onClick={resetAccusation}>تراجع، أحتاج أفكر</button>
      </>}
    </section>}
    {view.accusations.length>0&&<section className="panel crime-history"><h2>سجل الاتهامات</h2>{view.accusations.map(a=><div key={a.actor}><strong>{view.players.find(p=>p.id===a.actor)?.name}</strong><p>اتهم {view.players.find(p=>p.id===a.target)?.name} · {crimeCardById[a.weapon]?.name} + {crimeCardById[a.evidence]?.name}</p><span>{a.correct?'اتهام صحيح ✓':'لم يكتمل الحل'}</span></div>)}</section>}
    {view.phase==='investigate'&&<section className="panel crime-clock"><TimerPanel key={`${view.round}-${view.timer.duration_seconds}`} timer={view.timer} remaining={seconds} host={view.is_host} disabled={busy} onAction={onTimer}/><p className="field-note">المؤقت للتنظيم؛ انتهاء الوقت لا يكشف الحل تلقائيًا.</p></section>}
  </div>;
}
