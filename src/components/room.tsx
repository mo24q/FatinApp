'use client';
import { RoundScores } from '@/components/round-scores';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, CheckCheck, Clock3, Copy, Crown, Eye, EyeOff, Flag, LockKeyhole, MessageCircle, RefreshCw, Share2, ShieldCheck, Sparkles, Trophy, Users, Wifi, WifiOff, X } from 'lucide-react';
import { Brand, Footer } from './brand';
import { TimerPanel } from './timer-panel';
import type { TimerCommand } from '@/lib/local-game';
import { action, configured, friendlyError, supabase } from '@/lib/supabase';
import type { Phase, Room, Secret } from '@/lib/types';

const phases: { id: Phase; title: string }[] = [
  { id: 'lobby', title: 'الانتظار' }, { id: 'reveal', title: 'الأدوار' },
  { id: 'discuss', title: 'النقاش' }, { id: 'vote', title: 'التصويت' }, { id: 'result', title: 'النتيجة' }
];
export function RoomView({ code }: { code: string }) {
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [needsJoin, setNeedsJoin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [realtime, setRealtime] = useState(false);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [hasSeen, setHasSeen] = useState(false);
  const [selected, setSelected] = useState('');
  const [toast, setToast] = useState('');
  const [clock, setClock] = useState(Date.now());
  const offset = useRef(0);
  const mounted = useRef(true);
  const roomRef = useRef<Room | null>(null);
  const refreshing = useRef(false);
  const secretRequest = useRef(0);
  const hideSecret = useCallback(() => { secretRequest.current++; setSecret(null); }, []);

  const acceptRoom = useCallback((next: Room) => {
    if (!mounted.current) return;
    const previous = roomRef.current;
    if (previous && (next.revision < previous.revision || (next.revision === previous.revision && Date.parse(next.server_time) < Date.parse(previous.server_time)))) return;
    offset.current = Date.parse(next.server_time) - Date.now();
    if (previous?.round !== next.round || previous?.phase !== next.phase) {
      hideSecret(); setSelected('');
      if (previous?.round !== next.round) setHasSeen(false);
    }
    roomRef.current = next; setRoom(next); setNeedsJoin(false);
  }, [hideSecret]);

  const refresh = useCallback(async () => {
    if (refreshing.current || !configured) return;
    if (!navigator.onLine) {
      if (mounted.current) { setOnline(false); setLoading(false); setError('أنت غير متصل. مكانك محفوظ؛ نحاول مجددًا عند عودة الشبكة.'); }
      return;
    }
    refreshing.current = true;
    try {
      const { data, error: sessionError } = await supabase().auth.getSession();
      if (sessionError) throw sessionError;
      if (!data.session) { if (mounted.current) setNeedsJoin(true); return; }
      const next = await action<Room>('state', code);
      acceptRoom(next);
      if (mounted.current) { setOnline(true); setError(''); localStorage.setItem('lamma-room', next.code); }
    } catch (e) {
      if (!mounted.current) return;
      const message = e && typeof e === 'object' && 'message' in e ? String(e.message) : '';
      if (/NOT_MEMBER|AUTH_REQUIRED/.test(message)) { hideSecret(); setRoom(null); roomRef.current=null; setNeedsJoin(true); }
      else { setError(friendlyError(e)); setOnline(false); }
    } finally { refreshing.current = false; if (mounted.current) setLoading(false); }
  }, [code, acceptRoom, hideSecret]);

  useEffect(() => {
    mounted.current = true;
    if (!configured) { setLoading(false); setError(friendlyError(new Error('SETUP_REQUIRED'))); return; }
    void refresh();
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5000);
    const tick = setInterval(() => setClock(Date.now()), 1000);
    const onOnline = () => { setOnline(true); void refresh(); };
    const onOffline = () => { setOnline(false); hideSecret(); };
    const onVisibility = () => { hideSecret(); if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    window.addEventListener('blur', hideSecret); document.addEventListener('visibilitychange', onVisibility);
    return () => { mounted.current=false; clearInterval(poll); clearInterval(tick); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); window.removeEventListener('blur', hideSecret); document.removeEventListener('visibilitychange', onVisibility); };
  }, [refresh, hideSecret]);

  const roomId = room?.id;
  useEffect(() => {
    if (!roomId) return;
    const client = supabase();
    const channel = client.channel(`room:${roomId}`).on('postgres_changes', { event:'UPDATE', schema:'public', table:'room_events', filter:`room_id=eq.${roomId}` }, () => { void refresh(); }).subscribe(status => {
      setRealtime(status === 'SUBSCRIBED');
      if (status === 'SUBSCRIBED') void refresh();
    });
    return () => { void client.removeChannel(channel); };
  }, [roomId, refresh]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (!secret) return; const timer = setTimeout(hideSecret, 12000); return () => clearTimeout(timer); }, [secret, hideSecret]);

  async function act(kind: string, extra: Record<string, unknown> = {}) {
    if (!room || busy) return;
    setBusy(true); setError('');
    try {
      const result = await action<Room>(kind, code, { p_round: room.round, ...extra });
      if (kind === 'leave') { localStorage.removeItem('lamma-room'); router.push('/'); return; }
      acceptRoom(result);
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }
  async function showRole() {
    if (!room || busy) return;
    const request = ++secretRequest.current;
    const round = room.round;
    setBusy(true); setError('');
    try {
      const own = await action<Secret>('role', code, { p_round:round });
      if (mounted.current && request===secretRequest.current && roomRef.current?.round===round && document.visibilityState==='visible') { setSecret(own); setHasSeen(true); }
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }
  async function copy(value: string, success: string) {
    try { await navigator.clipboard.writeText(value); setToast(success); }
    catch { setToast(`انسخ يدويًا: ${value}`); }
  }
  async function share() {
    const url = `${location.origin}/?join=${code}`;
    if (navigator.share) { try { await navigator.share({ title:'تعالوا نلعب في فطين!', text:`غرفتنا في فطين — برا السالفة: ${code}`, url }); return; } catch (e) { if (e instanceof Error && e.name==='AbortError') return; } }
    await copy(url, 'تم نسخ رابط الدعوة. أرسله لأصحابك.');
  }

  const remaining = room?.timer?.paused ? (room.timer.remaining_seconds ?? 0) : room?.deadline ? Math.max(0, Math.ceil((Date.parse(room.deadline) - clock - offset.current) / 1000)) : 0;
  const disabled = busy || !online;
  const readyCount = room?.players.filter(p => p.ready).length || 0;
  const me = room?.players.find(p => p.id===room.me);
  const canManage = room?.phase==='lobby' || room?.phase==='result';
  const timerSettings = room?.timer ?? { enabled:true, paused:false, remaining_seconds:null, duration_seconds:room?.phase==='vote' ? 60 : (room?.discussion_seconds ?? 120) };
  const voteExpired = room?.phase==='vote' && timerSettings.enabled && !timerSettings.paused && !!room.deadline && remaining===0;
  const timerAction = (kind: TimerCommand, seconds?: number) => { void act(kind,{ p_name:room?.phase, ...(seconds===undefined ? {} : {p_seconds:seconds}) }); };
  const timer = <TimerPanel key={`${room?.round}-${room?.phase}-${timerSettings.duration_seconds}`} timer={timerSettings} remaining={remaining} host={!!room?.is_host && room.timer_version===2} disabled={disabled} onAction={timerAction}/>;

  const secretView = secret ? <div className={`role-card ${secret.outsider ? 'outsider' : ''}`}>
    <small>{secret.outsider ? 'دورك: برا السالفة' : `الفئة: ${secret.category}`}</small><h3>{secret.outsider ? 'العبها وكأنك فاهم!' : secret.word}</h3>
    <p>{secret.outsider ? `الفئة ${secret.category}. حاول تستنتج الكلمة من أسئلتهم.` : 'أنت داخل السالفة. الكل يعرف الكلمة إلا لاعب واحد.'}</p>
    <button className="text-button" onClick={hideSecret}><EyeOff size={16} className="inline"/> إخفاء دوري</button>
  </div> : <button className="button light-purple" disabled={disabled} onClick={showRole}><Eye size={18}/> {hasSeen ? 'عرض دوري مرة ثانية' : 'شوف دورك لحالك'}</button>;

  return <div className="room-shell"><header className="header room-header"><Brand/><span className={`connection ${!online || !realtime ? 'reconnecting' : ''}`}>{online ? <Wifi size={15}/> : <WifiOff size={15}/>} {!online ? 'الاتصال منقطع… نحاول نرجع' : realtime ? 'متصل بفطين' : 'تحديث تلقائي كل ٥ ثوانٍ'}</span></header>
    <main id="main">
      {loading ? <div className="empty-page"><div className="room-spinner"/><p>نجهّز مكانك في فطين…</p></div> : needsJoin ? <div className="empty-page"><div className="join-room-box"><div className="stage-icon mx-auto"><Users size={31}/></div><h1 className="mt-6">أصحابك ينتظرونك.</h1><p className="muted my-4">ادخل باسمك للغرفة <b dir="ltr">{code}</b>. استخدم نفس المتصفح إذا كنت منضمًا مسبقًا.</p><Link className="button primary" href={`/?join=${encodeURIComponent(code)}`}>الانضمام للغرفة</Link></div></div> : !room ? <div className="empty-page"><LockKeyhole size={35}/><h1>تعذّر فتح الغرفة</h1><p role="alert">{error}</p><button className="button primary" onClick={() => void refresh()}>حاول مرة ثانية</button><Link href="/" className="text-button">العودة للرئيسية</Link></div> : <>
        <div className="room-title"><div><span className="section-kicker">غرفتكم في فطين <span className="purple">✳</span></span><h1>برا السالفة</h1><p>{room.round ? `الجولة ${room.round.toLocaleString('ar-SA')} · ` : ''}خلّ جوالك لك، وسوالفك للكل.</p></div><button className="room-code" onClick={() => void copy(code,'تم نسخ رمز الغرفة.')} aria-label={`نسخ رمز الغرفة ${code}`}><span><small>رمز الغرفة</small><b dir="ltr">{code}</b></span><Copy size={17} className="purple"/></button></div>
        {toast && <div className="toast" role="status">{toast}</div>}{error && <div className="error-message" role="alert">{error}</div>}
        {!online && <div className="notice" role="status">مكانك محفوظ. افتح نفس الرابط في هذا المتصفح عند عودة الشبكة. أزرار اللعب متوقفة لحين الاتصال.</div>}
        {room.host_offline && !room.is_host && <div className="notice">المضيف غائب منذ دقيقة. تقدر تستلم الاستضافة وتكملون.<button className="text-button" disabled={disabled} onClick={() => void act('claim_host')}>استلام الاستضافة</button></div>}
        <div className="room-layout"><div className="room-main"><ol className="phase-track" aria-label="مراحل اللعب">{phases.map((phase,i) => <li key={phase.id} className={`phase-step ${phase.id===room.phase ? 'active' : ''}`} aria-current={phase.id===room.phase ? 'step' : undefined}><span>{i+1}</span>{phase.title}</li>)}</ol>
          <section className="panel stage-panel" aria-label={phases.find(p => p.id===room.phase)?.title}>
            {room.phase==='lobby' && <><div className="stage-icon"><Users size={34}/></div><h2>فطين جاهز. باقي أصحابك!</h2><p>شارك رمز الغرفة مع أصحابك. كل واحد يدخل من جواله، والمضيف يبدأ لما تكونون جاهزين.</p><button className="button light-purple" onClick={share}><Share2 size={17}/> شارك دعوة فطين</button><p className="small-info">{room.players.length<3 ? `ننتظر ${3-room.players.length} لاعبين عشان نبدأ` : `${room.players.length} لاعبين في الغرفة · جاهزين للسوالف؟`}</p>{room.is_host ? <button className="button primary full" disabled={disabled || room.players.length<3 || room.players.some(p => !p.online)} onClick={() => void act('start')}>ابدأ الجولة <Sparkles size={18}/></button> : <p className="small-info loading-dot">بانتظار المضيف يبدأ الجولة…</p>}</>}
            {room.phase==='reveal' && <><div className="stage-icon"><LockKeyhole size={32}/></div><h2>سرّك بينك وبين جوالك.</h2><p>تأكد إن محد يشوف الشاشة، ثم افتح دورك. بعد ما تحفظه، خبّه وخلّنا نبدأ.</p>{secretView}<span className="secret-help"><ShieldCheck size={13}/> يختفي الدور بعد ١٢ ثانية أو عند مغادرة الشاشة.</span>{!me?.ready && <button className="button primary" disabled={disabled || !hasSeen} onClick={() => { hideSecret(); void act('ready'); }}><Check size={18}/> حفظت دوري، جاهز</button>}<p className="small-info">{readyCount} من {room.players.length} جاهزين {me?.ready && '· تم تأكيد جاهزيتك'}</p>{room.is_host && <button className="button light-purple full" disabled={disabled || readyCount<room.players.length} onClick={() => void act('discuss')}>نبدأ النقاش <MessageCircle size={17}/></button>}</>}
            {room.phase==='discuss' && <><div className="stage-icon"><MessageCircle size={32}/></div><h2>اسأل بذكاء… ولا تفضحها.</h2><p>اسألوا بعض بالتناوب عن الكلمة بدون ما تقولونها. اللي برا السالفة يحاول يمشيها معكم.</p>{timer}<p className="small-info">{!timerSettings.enabled || timerSettings.paused || remaining ? 'المضيف يفتح التصويت لما تكونون جاهزين.' : 'خلص الوقت. المضيف يفتح التصويت لما تكونون جاهزين.'}</p><div className="tip-box">مثال للسؤال: «متى آخر مرة شفته؟»<br/>خلّ الإجابة تلمّح، بدون ما تكشف.</div>{room.is_host && <button className="button primary" disabled={disabled} onClick={() => void act('open_vote')}>نروح للتصويت <Flag size={17}/></button>}{secretView}</>}
            {room.phase==='vote' && <><div className="stage-icon"><Flag size={32}/></div><h2>{room.voted ? 'صوتك وصل. نشوف مين؟' : 'مين تحسّه برا السالفة؟'}</h2><p>{room.voted ? 'اختيارك سرّي إلى نهاية التصويت. ما تقدر تغيّره بعد التثبيت.' : 'اختار لاعبًا غيرك ثم ثبّت صوتك. النتيجة تظهر بعد تصويت الجميع أو انتهاء المؤقت إذا كان شغّالًا.'}</p>{timer}{!room.voted ? <><div className="vote-grid">{room.players.filter(p => p.id!==room.me).map((player,i) => <button key={player.id} className={`vote-option ${selected===player.id ? 'selected' : ''}`} onClick={() => setSelected(player.id)} disabled={disabled || voteExpired} aria-pressed={selected===player.id}><span className={`avatar avatar-${i%4}`}>{player.name[0]}</span><span>{player.name}</span>{selected===player.id && <Check size={17} className="selected-mark"/>}</button>)}</div><button className="button primary full" disabled={disabled || !selected || voteExpired} onClick={() => void act('vote',{ p_target:selected })}>تثبيت صوتي</button></> : <div className="tip-box"><CheckCheck size={23} className="mx-auto mb-2"/>صوّتّ لـ {room.players.find(p => p.id===room.my_vote)?.name}</div>}<p className="small-info">وصلت {room.votes_count} من {room.players.length} أصوات</p>{voteExpired && <button className="text-button" onClick={() => void refresh()}>عرض النتيجة</button>}</>}
            {room.phase==='result' && room.result && <><div className={`stage-icon ${room.result.caught ? 'success' : ''}`}><Trophy size={33}/></div><h2>{room.result.caught ? 'قفطتوه! السالفة انكشفت.' : 'مشّاها عليكم!'}</h2><p><strong className="purple">{room.result.votes.find(v => v.id===room.result?.outsider_id)?.name}</strong> كان برا السالفة. {room.result.tied ? 'تعادلت الأصوات، وفاز اللي برا السالفة.' : room.result.caught ? 'فاز اللي داخل السالفة.' : 'فاز اللي برا السالفة.'}</p><div className="result-word"><small>الكلمة كانت</small><strong>{room.result.word}</strong></div><RoundScores scores={room.result.scores}/><div className="result-tally">{room.result.votes.map(v => <div className="result-row" key={v.id}><span>{v.name} {v.id===room.result?.outsider_id && '✳'}</span><span className="result-bar"><i style={{ width:`${v.count / Math.max(room.players.length,1)*100}%` }}/></span><b>{v.count}</b></div>)}</div>{room.is_host ? <button className="button primary full" disabled={disabled || room.players.length<3 || room.players.some(p => !p.online)} onClick={() => void act('start')}><RefreshCw size={18}/> جولة جديدة، وسالفة جديدة</button> : <p className="small-info">بانتظار المضيف يبدأ جولة جديدة.</p>}<p className="small-info">الكلمة تتغيّر، واللي برا السالفة يكون لاعبًا آخر.</p></>}
          </section>
          {room.is_host && !['discuss','vote'].includes(room.phase) && room.timer_version===2 && <TimerPanel key={`setup-${room.phase}-${timerSettings.duration_seconds}`} timer={timerSettings} remaining={remaining} active={false} host disabled={disabled} onAction={timerAction}/>}
          {room.is_host && room.timer_version!==2 && <p className="small-info">تحكم المؤقت يحتاج تفعيل تحديث فطين من مالك الموقع. تقدرون تكملون اللعب بالإعدادات الحالية.</p>}
          <div className="room-actions">{canManage ? <button className="text-button danger" disabled={disabled} onClick={() => { if (confirm('تبي تغادر الغرفة؟ تقدر تنضم من جديد قبل الجولة القادمة.')) void act('leave'); }}>مغادرة الغرفة</button> : room.is_host ? <button className="text-button danger" disabled={disabled} onClick={() => { if (confirm('نلغي الجولة ونرجع للوبي؟ ما راح تنكشف الأدوار.')) void act('cancel'); }}>إلغاء الجولة والعودة للوبي</button> : <span className="muted text-xs">مكانك محفوظ عند إعادة فتح الصفحة.</span>}<button className="text-button" onClick={() => void refresh()} disabled={busy}><RefreshCw size={13} className="inline"/> تحديث</button></div>
        </div><aside className="room-sidebar"><div className="panel"><h2>لاعبو فطين <span>{room.players.length} / 12</span></h2><ul className="player-list">{room.players.map((player,i) => <li key={player.id} className="player-row"><span className={`avatar avatar-${i%4}`}>{player.name[0]}</span><span className="player-info"><strong>{player.name} {player.id===room.me && <small>(أنت)</small>}</strong><small>{player.is_host ? <><Crown size={10} className="inline"/> المضيف</> : player.ready && room.phase==='reveal' ? 'جاهز للّعب' : player.online ? 'في الغرفة' : 'ننتظر عودته'}</small></span>{room.is_host && player.id!==room.me && canManage ? <button className="icon-button" disabled={disabled} aria-label={`إزالة ${player.name}`} onClick={() => { if (confirm(`إزالة ${player.name} من الغرفة؟`)) void act('remove',{ p_target:player.id }); }}><X size={15}/></button> : <span className={`player-status ${player.online ? '' : 'offline'}`} aria-label={player.online ? 'متصل' : 'غير متصل'}/>}</li>)}</ul></div><div className="rules-note"><h3>على السريع <Sparkles size={13} className="inline"/></h3><p>الكل يعرف نفس الكلمة إلا واحد. الفئة معروفة للجميع.</p><p>ناقشوا، وصوّتوا. إذا انفرد «برا السالفة» بأعلى الأصوات تفوزون. غير كذا، هو الفائز.</p><p>إذا انقطع أحد، مكانه محفوظ. عند الحاجة، يلغي المضيف الجولة ويزيل اللاعب الغائب من اللوبي.</p></div></aside></div>
      </>}
    </main><Footer/></div>;
}
