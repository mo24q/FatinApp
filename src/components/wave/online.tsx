'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, Crown, Share2, Wifi, WifiOff, X } from 'lucide-react';
import { Brand, Footer } from '../brand';
import { WaveClock, WaveClue, WaveGuess, WaveResultPanel, WaveRoster, WaveRounds, WaveRules, WaveStatus } from './shared';
import type { WaveView } from '@/lib/wave-game';
import { waveAction, waveError } from '@/lib/wave-client';
import { configured, supabase } from '@/lib/supabase';
type WaveSecret={target:number};
export function WaveOnline({code}:{code:string}){
  const router=useRouter(),[room,setRoom]=useState<WaveView|null>(null),[secret,setSecret]=useState<WaveSecret|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[needsJoin,setNeedsJoin]=useState(false),[online,setOnline]=useState(true),[realtime,setRealtime]=useState(false),[error,setError]=useState(''),[toast,setToast]=useState(''),[confirm,setConfirm]=useState(''),[total,setTotal]=useState(6);
  const live=useRef(true),current=useRef<WaveView|null>(null),fetching=useRef(false),acting=useRef(false),secretTicket=useRef(0);
  const hide=useCallback(()=>{secretTicket.current++;setSecret(null);},[]);
  const accept=useCallback((next:WaveView)=>{
    if(!live.current)return;const prev=current.current;
    if(prev&&(next.revision<prev.revision||next.revision===prev.revision&&Date.parse(next.server_time)<Date.parse(prev.server_time)))return;
    if(prev?.round!==next.round||prev?.step!==next.step){hide();setConfirm('');}
    if(prev?.round!==next.round&&next.round>0)setTotal(next.total);
    current.current=next;setRoom(next);setNeedsJoin(false);
  },[hide]);
  const refresh=useCallback(async()=>{
    if(fetching.current||!configured)return;
    if(!navigator.onLine){setOnline(false);setLoading(false);hide();return;}
    fetching.current=true;
    try{
      const {data,error:authError}=await supabase().auth.getSession();if(authError)throw authError;
      if(!data.session){if(live.current){hide();setNeedsJoin(true);current.current=null;setRoom(null);}return;}
      const next=await waveAction<WaveView>('state',code);if(!live.current)return;accept(next);setOnline(true);
    }catch(e){if(live.current){hide();const message=e&&typeof e==='object'&&'message'in e?String(e.message):'';if(/NOT_MEMBER|AUTH_REQUIRED/.test(message)){setNeedsJoin(true);current.current=null;setRoom(null);}else{setOnline(false);setError(waveError(e));}}}
    finally{fetching.current=false;if(live.current)setLoading(false);}
  },[accept,code,hide]);
  useEffect(()=>{
    live.current=true;if(!configured){setLoading(false);setError('الغرف تحتاج إعداد Supabase. نسخة الجوال الواحد متاحة من صفحة اللعبة.');return;}
    void refresh();const poll=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},5000);
    const connected=()=>void refresh(),disconnected=()=>{hide();setOnline(false);},visible=()=>{hide();if(document.visibilityState==='visible')void refresh();};
    window.addEventListener('online',connected);window.addEventListener('offline',disconnected);window.addEventListener('blur',hide);document.addEventListener('visibilitychange',visible);
    return()=>{live.current=false;secretTicket.current++;clearInterval(poll);window.removeEventListener('online',connected);window.removeEventListener('offline',disconnected);window.removeEventListener('blur',hide);document.removeEventListener('visibilitychange',visible);};
  },[refresh,hide]);
  const roomId=room?.id;
  useEffect(()=>{if(!roomId)return;const client=supabase(),channel=client.channel(`wave:${roomId}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'room_events',filter:`room_id=eq.${roomId}`},()=>{void refresh();}).subscribe(status=>{if(live.current)setRealtime(status==='SUBSCRIBED');if(status==='SUBSCRIBED')void refresh();});return()=>{void client.removeChannel(channel);};},[roomId,refresh]);
  async function act(action:string,payload:Record<string,unknown>={}){
    const before=current.current;if(!before||acting.current||!navigator.onLine)return;
    acting.current=true;setBusy(true);setError('');
    try{const next=await waveAction<WaveView>(action,code,before.round,{...payload,step:before.step});if(!live.current)return;if(action==='leave'){router.push('/wave');return;}accept(next);if(['clue','guess','cancel'].includes(action))hide();}
    catch(e){if(live.current){setError(waveError(e));hide();void refresh();}}
    finally{acting.current=false;if(live.current)setBusy(false);}
  }
  async function showSecret(){
    const before=current.current;if(!before||acting.current||!navigator.onLine)return;const ticket=++secretTicket.current;acting.current=true;setBusy(true);setError('');
    try{const next=await waveAction<WaveSecret>('secret',code,before.round,{step:before.step});if(live.current&&secretTicket.current===ticket&&current.current?.round===before.round&&current.current?.step===before.step&&document.visibilityState==='visible')setSecret(next);}
    catch(e){if(live.current){setError(waveError(e));void refresh();}}
    finally{acting.current=false;if(live.current)setBusy(false);}
  }
  async function copy(value:string){try{await navigator.clipboard.writeText(value);setToast('تم النسخ.');}catch{setToast(`انسخ: ${value}`);}}
  async function share(){const url=`${location.origin}/wave?join=${code}`;if(navigator.share){try{await navigator.share({title:'نفس الموجة — فطين',text:`انضم لموجتنا. الرمز ${code}`,url});return;}catch(e){if(e instanceof Error&&e.name==='AbortError')return;}}await copy(url);}
  const disabled=busy||!online,setup=room?.phase==='lobby'||room?.phase==='complete';
  return <div className="room-shell wave-shell"><header className="header room-header"><Brand/><span className={`connection ${!online?'reconnecting':''}`}>{online?<Wifi size={16}/>:<WifiOff size={16}/>} {online?(realtime?'متصل مباشر':'متصل · تحديث دوري'):'نعيد الاتصال…'}</span></header><main id="main"><div className="wave-heading"><span className="section-kicker">فطين · تلميح يجمعكم</span><h1>نفس الموجة<span className="orange">.</span></h1><div className="wave-room-code"><span>رمز الغرفة</span><b dir="ltr">{code}</b><button className="icon-button" aria-label="نسخ الرمز" onClick={()=>void copy(code)}><Copy size={17}/></button><button className="icon-button" aria-label="مشاركة رابط الغرفة" onClick={()=>void share()}><Share2 size={17}/></button></div></div>
    {error&&<div className="error-message" role="alert">{error}<button className="text-button" onClick={()=>{setError('');void refresh();}}>إعادة المحاولة</button></div>}{toast&&<p className="notice" role="status">{toast}</p>}{!online&&room&&<p className="notice">مكانك محفوظ. عد بنفس المتصفح عند عودة الاتصال؛ سنجلب آخر مرحلة.</p>}
    {loading?<p>نضبط التردد…</p>:needsJoin?<section className="panel"><h2>ادخل باسمك أولًا</h2><Link className="button primary full" href={`/wave?join=${code}`}>انضم للموجة</Link></section>:!room?<Link className="button white" href="/wave">رجوع لنفس الموجة</Link>:<>
      {room.phase!=='lobby'&&<><WaveStatus view={room}/>{room.phase==='clue'&&<WaveClue key={`${room.round}-${!!secret}`} view={room} target={secret?.target??null} busy={disabled} onShow={()=>void showSecret()} onHide={hide} onAction={(action,payload)=>void act(action,payload)}/>}
      {room.phase==='guess'&&<><WaveGuess key={room.round} view={room} actor={room.me} busy={disabled} onAction={(action,payload)=>void act(action,payload)}/><WaveRoster view={room}/><WaveClock key={room.round} view={room} busy={disabled} onAction={(action,payload)=>void act(action,payload)} onExpire={()=>void refresh()}/></>}
      {['result','complete'].includes(room.phase)&&<WaveResultPanel view={room} busy={disabled} onAction={(action,payload)=>void act(action,payload)}/>}</>}
      {setup&&<section className="panel"><h2>{room.phase==='complete'?'موجة جديدة؟':'مين معنا على الموجة؟'}</h2><p>{room.members.length}/١٢ لاعبًا · {room.is_host?'أنت المضيف':'بانتظار بدء المضيف'}</p><ul className="player-list">{room.members.map((p,i)=><li key={p.id} className="player-row"><span className={`avatar avatar-${i%4}`}>{p.name[0]}</span><span className="player-info"><strong>{p.name}{p.id===room.me?' (أنت)':''}</strong><small>{p.online?'متصل':'غير متصل'}</small></span>{room.is_host&&p.id!==room.me&&<button className="icon-button" aria-label={`إزالة ${p.name}`} disabled={disabled} onClick={()=>setConfirm(`remove:${p.id}`)}><X size={16}/></button>}</li>)}</ul>{room.is_host?<><WaveRounds total={total} onChange={setTotal} disabled={disabled}/><button className="button primary full" disabled={disabled||room.members.length<2||room.members.some(p=>!p.online)} onClick={()=>void act('start',{total})}>{room.phase==='complete'?'ابدأ لعبة جديدة':'ابدأ الموجة'}</button></>:<p className="notice">المضيف يبدأ بعد اكتمال لاعبين على الأقل. كلكم فريق واحد.</p>}</section>}
      <div className="wave-session-actions"><Link className="text-button" href="/wave">طرق اللعب</Link>{setup?<button className="text-button danger" disabled={disabled} onClick={()=>setConfirm('leave')}>مغادرة الغرفة</button>:room.is_host&&<button className="text-button danger" disabled={disabled} onClick={()=>{hide();setConfirm('cancel');}}>إلغاء اللعبة</button>}</div>
      {confirm&&<section className="notice" role="alert"><p>{confirm==='cancel'?'تُلغى اللعبة ونقاطها ويرجع الجميع للوبي دون كشف الهدف الحالي. تأكيد؟':confirm==='leave'?'مغادرة الغرفة؟':'إزالة هذا اللاعب من الغرفة؟'}</p><button className="button white" disabled={disabled} onClick={()=>{const action=confirm.startsWith('remove:')?'remove':confirm;void act(action,action==='remove'?{target:confirm.slice(7)}:{});setConfirm('');}}>تأكيد</button><button className="text-button" onClick={()=>setConfirm('')}>رجوع</button></section>}
      {room.host_offline&&!room.is_host&&<button className="button white full" disabled={disabled} onClick={()=>void act('claim_host')}><Crown size={17}/> استلام الاستضافة بعد غياب المضيف</button>}
      {room.phase==='clue'&&!room.players.find(p=>p.id===room.giver)?.online&&<p className="notice">ننتظر عودة صاحب التلميح. إذا تعذرت عودته، يقدر المضيف يلغي اللعبة ويعيد ترتيب المشاركين.</p>}
    </>}<WaveRules/></main><Footer/></div>;
}
