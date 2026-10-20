'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, Crown, RefreshCw, Share2, Users, Wifi, WifiOff, X } from 'lucide-react';
import { Brand, Footer } from '../brand';
import { CaseTable, CrimeRules, PrivateFile } from './table';
import { configured, supabase } from '@/lib/supabase';
import { crimeAction, crimeError } from '@/lib/crime-client';
import type { CrimeSecret, CrimeView } from '@/lib/crime-game';

export function CrimeOnline({code}:{code:string}) {
  const router=useRouter();
  const [room,setRoom]=useState<CrimeView|null>(null);
  const [secret,setSecret]=useState<CrimeSecret|null>(null);
  const [seen,setSeen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [needsJoin,setNeedsJoin]=useState(false);
  const [online,setOnline]=useState(true);
  const [realtime,setRealtime]=useState(false);
  const [error,setError]=useState('');
  const [toast,setToast]=useState('');
  const [narrator,setNarrator]=useState('');
  const [confirm,setConfirm]=useState('');
  const live=useRef(true), current=useRef<CrimeView|null>(null), fetching=useRef(false),secretTicket=useRef(0),acting=useRef(false);
  const hide=useCallback(()=>{secretTicket.current++;setSecret(null);},[]);
  const accept=useCallback((next:CrimeView)=>{
    if(!live.current)return;
    const prev=current.current;
    if(prev&&(next.revision<prev.revision||next.revision===prev.revision&&Date.parse(next.server_time)<Date.parse(prev.server_time)))return;
    if(prev?.round!==next.round||prev?.phase!==next.phase){hide();setConfirm('');}
    if(prev?.round!==next.round)setSeen(false);
    current.current=next;setRoom(next);setNeedsJoin(false);
    setNarrator(old=>next.players.some(p=>p.id===old)?old:next.me);
  },[hide]);
  const refresh=useCallback(async()=>{
    if(fetching.current||!configured)return;
    if(!navigator.onLine){setOnline(false);setLoading(false);return;}
    fetching.current=true;
    try {
      const {data,error:authError}=await supabase().auth.getSession();
      if(authError)throw authError;
      if(!data.session){setNeedsJoin(true);return;}
      const next=await crimeAction<CrimeView>('state',code);
      if(!live.current)return;
      accept(next);setOnline(true);
      // A background snapshot should not erase a validation message from an action.
    } catch(e) {
      if(!live.current)return;
      const message=e&&typeof e==='object'&&'message'in e?String(e.message):'';
      if(/NOT_MEMBER|AUTH_REQUIRED/.test(message)){hide();setNeedsJoin(true);current.current=null;setRoom(null);}
      else {setOnline(false);setError(crimeError(e));}
    } finally {fetching.current=false;if(live.current)setLoading(false);}
  },[accept,code,hide]);
  useEffect(()=>{
    live.current=true;
    if(!configured){setError('الغرف تحتاج إعداد Supabase. يمكنك اللعب بجوال واحد.');setLoading(false);return;}
    void refresh();
    const poll=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},5000);
    const connected=()=>{setOnline(true);void refresh();};
    const disconnected=()=>{setOnline(false);hide();};
    const visible=()=>{hide();if(document.visibilityState==='visible')void refresh();};
    window.addEventListener('online',connected);window.addEventListener('offline',disconnected);window.addEventListener('blur',hide);document.addEventListener('visibilitychange',visible);
    return()=>{live.current=false;secretTicket.current++;clearInterval(poll);window.removeEventListener('online',connected);window.removeEventListener('offline',disconnected);window.removeEventListener('blur',hide);document.removeEventListener('visibilitychange',visible);};
  },[refresh,hide]);
  const roomId=room?.id;
  useEffect(()=>{
    if(!roomId)return;
    const client=supabase();
    const channel=client.channel(`crime:${roomId}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'room_events',filter:`room_id=eq.${roomId}`},()=>{void refresh();}).subscribe(status=>{if(live.current)setRealtime(status==='SUBSCRIBED');if(status==='SUBSCRIBED')void refresh();});
    return()=>{void client.removeChannel(channel);};
  },[roomId,refresh]);
  async function act(action:string,payload:Record<string,unknown>={}) {
    const before=current.current;
    if(!before||acting.current)return;
    acting.current=true;setBusy(true);setError('');
    try {
      const next=await crimeAction<CrimeView>(action,code,before.round,payload);
      if(!live.current)return;
      if(action==='leave'){router.push('/crime');return;}
      accept(next);
      if(action==='ready')hide();
    } catch(e){if(live.current){setError(crimeError(e));void refresh();}}
    finally{acting.current=false;if(live.current)setBusy(false);}
  }
  async function showSecret() {
    const before=current.current;
    if(!before||acting.current)return;
    const ticket=++secretTicket.current;
    acting.current=true;setBusy(true);setError('');
    try {
      const next=await crimeAction<CrimeSecret>('role',code,before.round);
      if(live.current&&ticket===secretTicket.current&&current.current?.round===before.round&&current.current?.phase===before.phase&&document.visibilityState==='visible'){setSecret(next);setSeen(true);}
    } catch(e){if(live.current)setError(crimeError(e));}
    finally{acting.current=false;if(live.current)setBusy(false);}
  }
  async function share() {
    const url=`${location.origin}/crime?join=${code}`;
    if(navigator.share){try{await navigator.share({title:'الجريمة المغلقة — فطين',text:`تعال حقق معنا. رمز الغرفة: ${code}`,url});return;}catch(e){if(e instanceof Error&&e.name==='AbortError')return;}}
    try{await navigator.clipboard.writeText(url);setToast('نُسخ رابط الدعوة.');}catch{setToast(`انسخ الرابط: ${url}`);}
  }
  const disabled=busy||!online;
  const ready=room?.players.filter(p=>p.ready).length??0;
  const canManage=room?.phase==='lobby'||room?.phase==='result';
  return <div className="room-shell crime-shell">
    <header className="header room-header"><Brand/><span className={`connection ${!online?'reconnecting':''}`}>{online?<Wifi size={16}/>:<WifiOff size={16}/>} {online?(realtime?'متصل مباشر':'متصل · تحديث دوري'):'نحاول إعادة الاتصال'}</span></header>
    <main id="main"><div className="crime-heading"><span className="section-kicker">فطين · ملف مشترك وأدوار سرية</span><h1>الجريمة المغلقة<span className="orange">.</span></h1><div className="crime-room-code"><span>رمز الغرفة</span><b dir="ltr">{code}</b><button className="icon-button" aria-label="نسخ رمز الغرفة" onClick={async()=>{try{await navigator.clipboard.writeText(code);setToast('تم نسخ الرمز.');}catch{setToast(`رمز الغرفة: ${code}`);}}}><Copy size={17}/></button><button className="icon-button" aria-label="مشاركة رابط الغرفة" onClick={()=>void share()}><Share2 size={17}/></button></div></div>
      {error&&<div className="error-message" role="alert">{error}<button className="text-button" onClick={()=>{setError('');void refresh();}}>إعادة المحاولة</button></div>}
      {!online&&room&&<div className="notice" role="status">مكانك محفوظ. عند عودة الاتصال نحدّث القضية؛ لا تعِد إنشاء الغرفة.</div>}
      {toast&&<div className="toast" role="status">{toast}</div>}
      {loading?<p className="empty-page">نفتح ملف القضية…</p>:needsJoin?<section className="panel crime-entry"><h2>ادخل باسمك أولًا</h2><Link className="button primary full" href={`/crime?join=${code}`}>انضم إلى الغرفة</Link></section>:!room?<Link className="button white" href="/crime">رجوع للجريمة المغلقة</Link>:<>
        <div className="crime-round-bar"><span>{room.round?`القضية ${room.round.toLocaleString('ar-SA')}`:'نجمع المحققين'}</span><span>{room.phase==='reveal'?`الجاهزون ${ready}/${room.players.length}`:room.phase==='investigate'?'التحقيق مفتوح':room.phase==='result'?'أُغلق الملف':`${room.players.length}/12 لاعبًا`}</span></div>
        {canManage&&<section className="panel crime-lobby"><div className="crime-section-title"><h2>{room.phase==='result'?'قضية ثانية؟':'مين ينضم للتحقيق؟'}</h2><Users size={23}/></div><ul className="player-list">{room.players.map((p,i)=><li className="player-row" key={p.id}><span className={`avatar avatar-${i%4}`}>{p.name[0]}</span><span className="player-info"><strong>{p.name}{p.id===room.me?' (أنت)':''}</strong><small>{p.online?'متصل':'غير متصل'}</small></span><span className={`player-status ${!p.online?'offline':''}`}/>{room.is_host&&p.id!==room.me&&<button className="icon-button" aria-label={`إزالة ${p.name}`} onClick={()=>setConfirm(`remove:${p.id}`)} disabled={disabled}><X size={15}/></button>}</li>)}</ul>
          {room.is_host?<><label className="crime-narrator-select">اختيار الراوي<select value={narrator} onChange={e=>setNarrator(e.target.value)} disabled={disabled}>{room.players.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><p className="field-note">الراوي لا يملك بطاقات ولا يقدم اتهامًا. يمكن أن يكون غير المضيف.</p><button className="button primary full" disabled={disabled||room.players.length<4||room.players.some(p=>!p.online)} onClick={()=>void act('start',{narrator})}><FingerprintLabel/>{room.phase==='result'?'ابدأ قضية جديدة':'وزّع الأدوار والبطاقات'}</button></>:<p className="notice">المضيف يختار الراوي ويبدأ بعد اكتمال أربعة لاعبين.</p>}
        </section>}
        {room.phase==='reveal'&&<>
          <PrivateFile key={`${room.round}-${room.me}`} view={room} actor={room.me} secret={secret} shown={!!secret} busy={disabled} seen={seen} onShow={()=>void showSecret()} onHide={hide} onChoose={(weapon,evidence)=>void act('choose',{weapon,evidence})} onReady={()=>void act('ready')}/>
          {room.is_host&&<button className="button primary full crime-start" disabled={disabled||!room.solution_ready||ready!==room.players.length} onClick={()=>void act('investigate')}>افتح التحقيق بعد جاهزية الجميع</button>}
          <p className="field-note">{room.solution_ready?'تم تجهيز ملف القضية.':'بانتظار تجهيز ملف القضية.'} الجاهزون: {ready} من {room.players.length}.</p>
        </>}
        {(room.phase==='investigate'||room.phase==='result')&&<CaseTable key={`${room.round}-${room.phase}`} view={room} busy={disabled} secret={secret} onSecret={()=>void showSecret()} onHide={hide}
          onAccuse={(_actor,target,weapon,evidence)=>void act('accuse',{target,weapon,evidence})}
          onClue={(board,choice)=>void act('clue',{board,choice})} onClose={()=>void act('close')}
          onTimer={(command,seconds)=>void act(command,{seconds,phase:room.phase})}/>}
        {room.phase==='investigate'&&room.me!==room.narrator_id&&<div className="crime-own-role">{secret?<><span>{secret.role==='killer'?'أنت المجرم':'أنت محقق'}</span><button className="text-button" onClick={hide}>إخفاء دوري</button></>:<button className="text-button" disabled={disabled} onClick={()=>void showSecret()}>تذكّر دوري سرًا</button>}</div>}
        <div className="room-actions"><Link className="text-button" href="/crime">ألعاب فطين</Link>{room.is_host&&!canManage?<button className="text-button danger" disabled={disabled} onClick={()=>{hide();setConfirm('cancel');}}>إلغاء القضية</button>:canManage?<button className="text-button danger" disabled={disabled} onClick={()=>setConfirm('leave')}>مغادرة الغرفة</button>:null}</div>
        {confirm&&<section className="crime-confirm-box" role="alert"><p>{confirm==='cancel'?'إلغاء القضية يرجع الجميع للوبي دون كشف الحل.':confirm==='leave'?'هل تريد مغادرة الغرفة؟':'إزالة اللاعب من الغرفة؟'}</p><button className="button white" disabled={disabled} onClick={()=>{const action=confirm.startsWith('remove:')?'remove':confirm;const payload=action==='remove'?{target:confirm.slice(7)}:{};setConfirm('');void act(action,payload);}}>نعم، تأكيد</button><button className="text-button" onClick={()=>setConfirm('')}>رجوع</button></section>}
        {room.host_offline&&!room.is_host&&<button className="button white full" disabled={disabled} onClick={()=>void act('claim_host')}><Crown size={17}/>استلام الاستضافة بعد غياب المضيف</button>}
      </>}
      <CrimeRules/>
    </main><Footer/>
  </div>;
}
function FingerprintLabel(){return <RefreshCw size={17}/>;}
