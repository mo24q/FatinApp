'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy,Crown,Share2,Wifi,WifiOff,X } from 'lucide-react';
import { Brand,Footer } from '../brand';
import { LettersBoard,PartyRules,WrongAnswers,WrongControls,WrongOutcome,WrongPrivate,WrongProgress,WrongVote } from './shared';
import { partyNames,type PartyKind,type PartySecret,type PartyView } from '@/lib/party-game';
import { partyAction,partyError } from '@/lib/party-client';
import { configured,supabase } from '@/lib/supabase';
export function PartyOnline({code,kind}:{code:string;kind:PartyKind}){
  const router=useRouter(),[room,setRoom]=useState<PartyView|null>(null),[secret,setSecret]=useState<PartySecret|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[needsJoin,setNeedsJoin]=useState(false),[online,setOnline]=useState(true),[realtime,setRealtime]=useState(false),[error,setError]=useState(''),[toast,setToast]=useState(''),[confirm,setConfirm]=useState('');
  const live=useRef(true),current=useRef<PartyView|null>(null),fetching=useRef(false),acting=useRef(false),secretTicket=useRef(0);
  const hide=useCallback(()=>{secretTicket.current++;setSecret(null);},[]);
  const accept=useCallback((next:PartyView)=>{
    if(!live.current)return;const prev=current.current;
    if(prev&&(next.revision<prev.revision||next.revision===prev.revision&&Date.parse(next.server_time)<Date.parse(prev.server_time)))return;
    if(prev?.round!==next.round||prev?.step!==next.step){hide();setConfirm('');}
    current.current=next;setRoom(next);setNeedsJoin(false);
  },[hide]);
  const refresh=useCallback(async()=>{
    if(fetching.current||!configured)return;
    if(!navigator.onLine){setOnline(false);setLoading(false);hide();return;}
    fetching.current=true;
    try{
      const {data,error:authError}=await supabase().auth.getSession();if(authError)throw authError;
      if(!data.session){if(live.current){hide();setNeedsJoin(true);current.current=null;setRoom(null);}return;}
      const next=await partyAction<PartyView>(kind,'state',code);if(!live.current)return;accept(next);setOnline(true);
    }catch(e){if(live.current){hide();const message=e&&typeof e==='object'&&'message'in e?String(e.message):'';if(/NOT_MEMBER|AUTH_REQUIRED/.test(message)){setNeedsJoin(true);current.current=null;setRoom(null);}else{setOnline(false);setError(partyError(e));}}}
    finally{fetching.current=false;if(live.current)setLoading(false);}
  },[accept,code,hide,kind]);
  useEffect(()=>{
    live.current=true;if(!configured){setLoading(false);setError('الغرف تحتاج إعداد Supabase. نسخة الجوال الواحد متاحة من صفحة اللعبة.');return;}
    void refresh();const poll=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},5000);
    const connected=()=>void refresh(),disconnected=()=>{hide();setOnline(false);},visible=()=>{hide();if(document.visibilityState==='visible')void refresh();};
    window.addEventListener('online',connected);window.addEventListener('offline',disconnected);window.addEventListener('blur',hide);document.addEventListener('visibilitychange',visible);
    return()=>{live.current=false;secretTicket.current++;clearInterval(poll);window.removeEventListener('online',connected);window.removeEventListener('offline',disconnected);window.removeEventListener('blur',hide);document.removeEventListener('visibilitychange',visible);};
  },[refresh,hide]);
  const roomId=room?.id;
  useEffect(()=>{if(!roomId)return;const client=supabase(),channel=client.channel(`${kind}:${roomId}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'room_events',filter:`room_id=eq.${roomId}`},()=>{void refresh();}).subscribe(status=>{if(live.current)setRealtime(status==='SUBSCRIBED');if(status==='SUBSCRIBED')void refresh();});return()=>{void client.removeChannel(channel);};},[roomId,refresh,kind]);
  async function act(action:string,payload:Record<string,unknown>={}){
    const before=current.current;if(!before||acting.current||!navigator.onLine)return;
    acting.current=true;setBusy(true);setError('');
    try{const next=await partyAction<PartyView>(kind,action,code,before.round,{...payload,step:before.step});if(!live.current)return;if(action==='leave'){router.push(`/${kind}`);return;}accept(next);if(['answer','vote','cancel'].includes(action))hide();}
    catch(e){if(live.current){setError(partyError(e));hide();void refresh();}}
    finally{acting.current=false;if(live.current)setBusy(false);}
  }
  async function showSecret(){
    const before=current.current;if(!before||acting.current||!navigator.onLine)return;const ticket=++secretTicket.current;acting.current=true;setBusy(true);setError('');
    try{const next=await partyAction<PartySecret>(kind,'secret',code,before.round,{step:before.step});if(live.current&&secretTicket.current===ticket&&current.current?.round===before.round&&current.current?.step===before.step&&document.visibilityState==='visible')setSecret(next);}
    catch(e){if(live.current){setError(partyError(e));void refresh();}}
    finally{acting.current=false;if(live.current)setBusy(false);}
  }
  async function copy(value:string){try{await navigator.clipboard.writeText(value);setToast('تم النسخ.');}catch{setToast(`انسخ: ${value}`);}}
  async function share(){const url=`${location.origin}/${kind}?join=${code}`;if(navigator.share){try{await navigator.share({title:`${partyNames[kind]} — فطين`,text:`انضم لجمعتنا. الرمز ${code}`,url});return;}catch(e){if(e instanceof Error&&e.name==='AbortError')return;}}await copy(url);}
  const disabled=busy||!online,setup=room?.phase==='lobby'||room?.phase==='result',minimum=kind==='wrong'?4:1;
  return <div className={`room-shell party-shell ${kind}`}><header className="header room-header"><Brand/><span className={`connection ${!online?'reconnecting':''}`}>{online?<Wifi size={16}/>:<WifiOff size={16}/>} {online?(realtime?'متصل مباشر':'متصل · تحديث دوري'):'نعيد الاتصال…'}</span></header><main id="main"><div className="party-heading"><span className="section-kicker">فطين · غرفة جمعتكم</span><h1>{partyNames[kind]}<span className="orange">.</span></h1><div className="party-room-code"><span>رمز الغرفة</span><b dir="ltr">{code}</b><button className="icon-button" aria-label="نسخ الرمز" onClick={()=>void copy(code)}><Copy size={17}/></button><button className="icon-button" aria-label="مشاركة رابط الغرفة" onClick={()=>void share()}><Share2 size={17}/></button></div></div>
    {error&&<div className="error-message" role="alert">{error}<button className="text-button" onClick={()=>{setError('');void refresh();}}>إعادة المحاولة</button></div>}{toast&&<p className="notice" role="status">{toast}</p>}{!online&&room&&<p className="notice">مكانك محفوظ. عد بنفس المتصفح عند رجوع الاتصال؛ نجيب لك آخر حالة تلقائيًا.</p>}
    {loading?<p>نجهز جمعتكم…</p>:needsJoin?<section className="panel"><h2>ادخل باسمك أولًا</h2><Link className="button primary full" href={`/${kind}?join=${code}`}>انضم للغرفة</Link></section>:!room?<Link className="button white" href={`/${kind}`}>رجوع للعبة</Link>:<>
      {room.phase!=='lobby'&&<><div className="party-round">الجولة {room.round}<span>{kind==='wrong'?'واحد سؤالُه مختلف':'نفس السؤال حتى آخر حرف'}</span></div>{kind==='letters'?<LettersBoard view={room} busy={disabled} onAction={(action,payload)=>void act(action,payload)}/>:<>
        {room.phase==='answer'&&<><WrongPrivate key={`${room.round}-${!!secret}`} view={room} actor={room.me} secret={secret} busy={disabled} onShow={()=>void showSecret()} onHide={hide} onAction={(action,payload)=>void act(action,payload)}/><WrongProgress view={room}/></>}
        {room.phase==='result'&&<WrongOutcome view={room}/>}<WrongAnswers view={room}/>
        {room.phase==='vote'&&<><WrongVote key={room.round} view={room} actor={room.me} busy={disabled} onAction={(action,payload)=>void act(action,payload)}/><WrongProgress view={room}/></>}
        <WrongControls key={`${room.round}-${room.step}`} view={room} busy={disabled} onAction={(action,payload)=>void act(action,payload)}/>
      </>}</>}
      {setup&&<section className="panel"><h2>{room.phase==='result'?'جولة جديدة؟':'مين معنا؟'}</h2><p>{room.members.length}/١٢ لاعبًا · {room.is_host?'أنت المضيف':'بانتظار المضيف'}</p><ul className="player-list">{room.members.map((p,i)=><li key={p.id} className="player-row"><span className={`avatar avatar-${i%4}`}>{p.name[0]}</span><span className="player-info"><strong>{p.name}{p.id===room.me?' (أنت)':''}</strong><small>{p.online?'متصل':'غير متصل'}</small></span>{room.is_host&&p.id!==room.me&&<button className="icon-button" aria-label={`إزالة ${p.name}`} disabled={disabled} onClick={()=>setConfirm(`remove:${p.id}`)}><X size={16}/></button>}</li>)}</ul>{room.is_host?<button className="button primary full" disabled={disabled||room.members.length<minimum||room.members.some(p=>!p.online)} onClick={()=>void act('start')}>{kind==='wrong'?'وزّع الأسئلة سرًا':'سؤال جديد وحروف كاملة'}</button>:<p className="notice">المضيف يبدأ عندما تكونون جاهزين.</p>}</section>}
      <div className="party-session-actions"><Link className="text-button" href={`/${kind}`}>طرق اللعب</Link>{setup?<button className="text-button danger" disabled={disabled} onClick={()=>setConfirm('leave')}>مغادرة الغرفة</button>:room.is_host&&<button className="text-button danger" disabled={disabled} onClick={()=>{hide();setConfirm('cancel');}}>{kind==='letters'?'تغيير السؤال والعودة للبداية':'إلغاء الجولة'}</button>}</div>
      {confirm&&<section className="notice" role="alert"><p>{confirm==='cancel'?(kind==='wrong'?'تُلغى الإجابات والأصوات دون كشف الأسئلة، ونرجع للوبي. تأكيد؟':'نرجع للوبي لاختيار سؤال جديد، وتبدأ الحروف كاملة من جديد. تأكيد؟'):confirm==='leave'?'مغادرة الغرفة؟':'إزالة هذا اللاعب من الغرفة؟'}</p><button className="button white" disabled={disabled} onClick={()=>{const action=confirm.startsWith('remove:')?'remove':confirm;void act(action,action==='remove'?{target:confirm.slice(7)}:{});setConfirm('');}}>تأكيد</button><button className="text-button" onClick={()=>setConfirm('')}>رجوع</button></section>}
      {room.host_offline&&!room.is_host&&<button className="button white full" disabled={disabled} onClick={()=>void act('claim_host')}><Crown size={17}/> استلام الاستضافة بعد غياب المضيف</button>}
    </>}<PartyRules kind={kind}/></main><Footer/></div>;
}
