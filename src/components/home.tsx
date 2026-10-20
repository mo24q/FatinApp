'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowUpLeft, Check, Clock3, Fingerprint, Gamepad2, LockKeyhole, Plus, Sparkles, Users, X, Zap } from 'lucide-react';
import { Brand, Footer } from './brand';
import { Captcha } from './captcha';
import { games } from '@/lib/games';
import { action, configured, ensureGuest, friendlyError } from '@/lib/supabase';
import type { Room } from '@/lib/types';

export function Character({ color = 'purple', small = false }: { color?: string; small?: boolean }) {
  return <div className={`character ${color} ${small ? 'small' : ''}`} aria-hidden="true"><div className="character-eyes"><i/><i/></div><span className="character-mouth"/></div>;
}
export function Home() {
  const router = useRouter();
  const [modal, setModal] = useState<'mode' | 'create' | 'join' | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [seconds, setSeconds] = useState(120);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [lastRoom, setLastRoom] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    setName(localStorage.getItem('lamma-name') || '');
    setLastRoom(localStorage.getItem('lamma-room') || '');
    const incoming = new URLSearchParams(window.location.search).get('join');
    if (incoming) { setCode(incoming.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0,6)); setModal('join'); }
  }, []);
  useEffect(() => { if (modal) { dialog.current?.showModal(); setError(''); } else dialog.current?.close(); }, [modal]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      await ensureGuest(captchaToken);
      const room = await action<Room>(modal === 'create' ? 'create' : 'join', code, { p_name: name.trim(), p_seconds: seconds });
      localStorage.setItem('lamma-name', name.trim());
      if(!('game' in room && room.game==='crime'))localStorage.setItem('lamma-room', room.code);
      router.push('game' in room && room.game==='crime' ? `/crime/room/${room.code}` : `/room/${room.code}`);
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  }
  return <div className="site-shell">
    <header className="header"><Brand/><nav aria-label="التنقل الرئيسي"><a href="#games">الألعاب</a><a href="#how">كيف نلعب؟</a></nav><button className="button outline small-button" onClick={() => setModal('join')}>انضم لغرفة <ArrowUpLeft size={17}/></button></header>
    <main id="main">
      <section className="hero">
        <div className="hero-copy"><div className="eyebrow"><span className="green-dot"/> وجيه نحبها. وقت يجمعنا.</div>
          <h1>جمعتكم<br/>ناقصها <span className="headline-word">لعبة<svg viewBox="0 0 240 22" aria-hidden="true"><path d="M5 16 Q110 -2 235 12"/></svg></span><span className="orange">.</span></h1>
          <p className="hero-description">مع فطين، كل جمعة لها سالفة.<br/>كل واحد بجواله، أو جوال واحد يمرّ بينكم. اختاروا طريقتكم.</p>
          <div className="hero-buttons"><a className="button primary" href="#games">نلعب مع فطين <ArrowLeft size={20}/></a><button className="button white" onClick={() => setModal('join')}>معك رمز غرفة؟</button></div>
          <div className="hero-perks"><span><Check size={15}/> بدون حسابات</span><span><Check size={15}/> جوال واحد أو أكثر</span><span><Check size={15}/> حضوري أو عن بُعد</span></div>
          {lastRoom && <button className="resume-link" onClick={() => router.push(`/room/${lastRoom}`)}>العودة لغرفتك <b dir="ltr">{lastRoom}</b> <ArrowLeft size={15}/></button>}
        </div>
        <div className="hero-art" aria-label="بطاقات توضيحية للعبة برا السالفة">
          <span className="art-star star-one">✳</span><span className="art-star star-two">✦</span><span className="art-orbit"/>
          <div className="art-note">مين فينا برا السالفة؟ <span>↙</span></div>
          <div className="art-card card-back"><div className="mini-label"><span className="tiny-dot"/> أنت داخل السالفة</div><Character color="mint"/><strong>تعرف الكلمة.</strong><span>بس لا تفضحها!</span></div>
          <div className="art-card card-front"><div className="mini-label"><Sparkles size={15}/> خلك طبيعي…</div><Character/><strong>برا السالفة</strong><span>العبها وكأنك فاهم.</span><div className="secret-decoration"><LockKeyhole size={13}/> دورك سر بيننا</div></div>
          <div className="friends-bubble"><div className="mini-avatars"><span>ن</span><span>م</span><span>س</span></div><span>جمّع أصحابك، والباقي سهالات</span></div>
          <span className="art-squiggle">〰</span>
        </div>
      </section>
      <section className="gather-strip"><span className="strip-icon"><Gamepad2 size={23}/></span><p><strong>فطين يجمعكم. حتى بجوال واحد.</strong><span>لا أوراق، لا تجهيز طويل. بس أنتم واللعبة.</span></p><span className="strip-sparkle">✧</span></section>
      <section id="games" className="games-section"><div className="section-heading"><div><span className="section-kicker">وش جوّكم اليوم؟</span><h2>اختاروا لعبتكم في فطين.</h2></div><span className="soft-badge">ألعاب فطين، بطريقتكم</span></div>
        <div className="games-grid">{games.map((game, i) => <article key={game.id} className={`game-card ${game.available ? 'available' : 'coming'}`}>
          <div className={`game-visual visual-${i} ${game.id==='crime'?'visual-crime':''}`}><span className="game-tag">{game.available ? 'جاهزة للّعب' : 'قريبًا'}</span>{game.id==='crime'?<><Fingerprint className="crime-game-icon" size={87} strokeWidth={1.2}/><span className="crime-game-label">ملف القضية · ٠٠٢</span></>:game.id==='outsider' ? <><div className="question-mark">؟</div><Character small/><div className="small-chat">أنا؟ مستحيل!</div></> : game.id==='quick-answer' ? <><Zap className="big-game-icon" strokeWidth={1.5}/><span className="decorative-letters">أ ب ج</span></> : <><div className="wave-circle circle-one"/><div className="wave-circle circle-two"/><Sparkles className="wave-star" size={30}/></>}</div>
          <div className="game-content"><span className="game-category">{game.tag}</span><h3>{game.name}</h3><p>{game.description}</p><div className="game-meta"><span><Users size={16}/>{game.players}</span>{game.time && <span><Clock3 size={16}/>{game.time}</span>}</div>
            <button disabled={!game.available} className={`button full ${game.available ? 'light-purple' : 'coming-button'}`} onClick={() => game.id==='crime'?router.push('/crime'):setModal('mode')}>{game.available ? `نلعب ${game.name}` : 'قريبًا في فطين'}{game.available && <ArrowLeft size={18}/>}</button>
          </div></article>)}</div>
      </section>
      <section id="how" className="how-section"><div className="section-heading"><div><span className="section-kicker">أسهل من ترتيب الطلعة</span><h2>ثلاث خطوات، وتبدأ السوالف.</h2></div></div><div className="steps-grid">
        <div><span className="step-number">١</span><h3>اختاروا طريقة اللعب</h3><p>غرفة لكل واحد بجواله، أو جلسة فطين محلية على جوال واحد.</p></div>
        <div><span className="step-number">٢</span><h3>عرّفوا فطين عليكم</h3><p>ادخلوا بالرمز في الغرف، أو أضيفوا أسماءكم ومرّروا الجوال بالترتيب.</p></div>
        <div><span className="step-number">٣</span><h3>خبّوا أدواركم… والعبوا</h3><p>شوف دورك لحالك، واسأل بذكاء. مين اللي مو معنا؟</p></div>
      </div></section>
      <div className="bottom-note"><LockKeyhole size={17}/><span>في الغرف، كل دور يصل لصاحبه فقط. في الجوال الواحد، أخفِ دورك قبل التمرير.</span></div>
    </main><Footer/>
    <dialog ref={dialog} className="entry-dialog" onCancel={e => { if (busy) e.preventDefault(); else setModal(null); }} onClose={() => { if (!busy) setModal(null); }} aria-labelledby="entry-title">
      <button className="icon-button close-dialog" onClick={() => setModal(null)} disabled={busy} aria-label="إغلاق"><X size={21}/></button>
      <div className="dialog-icon">{modal === 'create' ? <Plus size={27}/> : <Users size={27}/>}</div><h2 id="entry-title">{modal==='mode' ? 'كيف نلعب مع فطين؟' : modal === 'create' ? 'أنت مضيف فطين.' : 'مكانك في فطين.'}</h2><p className="muted">{modal==='mode' ? 'نفس اللعبة، بطريقتكم.' : modal === 'create' ? 'افتح غرفة برا السالفة وشارك رمزها مع أصحابك.' : 'اكتب اسمك ورمز الغرفة، وادخل مع أصحابك.'}</p>
      {modal==='mode' ? <div className="mode-options"><Link className="mode-option" href="/local"><span className="mode-symbol">١</span><span><strong>جوال واحد</strong><small>أضيفوا الأسماء ومرّروا الجوال. بدون رمز غرفة.</small></span><ArrowLeft size={20}/></Link><button className="mode-option" onClick={()=>setModal('create')}><span className="mode-symbol"><Users size={24}/></span><span><strong>كل واحد بجواله</strong><small>أنشئ غرفة وشارك رمزها. حضوري أو عن بُعد.</small></span><ArrowLeft size={20}/></button></div> : <>
      {!configured && <div className="notice">هذه النسخة جاهزة للربط. لتشغيل الغرف، أكمل إعداد Supabase الموضّح في README.</div>}
      <form onSubmit={submit}><label htmlFor="name">وش نناديك؟</label><input id="name" value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={20} required placeholder="اسمك بين أصحابك" autoComplete="nickname" autoFocus/>
        {modal === 'join' ? <><label htmlFor="code">رمز الغرفة</label><input id="code" className="code-input" dir="ltr" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0,6))} required minLength={6} maxLength={6} pattern="[A-Z0-9]{6}" placeholder="ABC234" autoComplete="off" autoCapitalize="characters" spellCheck={false}/></> : <><label htmlFor="seconds">وقت النقاش</label><select id="seconds" value={seconds} onChange={e => setSeconds(Number(e.target.value))}><option value={60}>دقيقة واحدة</option><option value={120}>دقيقتان — مناسب للبداية</option><option value={180}>٣ دقائق</option><option value={300}>٥ دقائق</option></select><p className="field-note">٣–١٢ لاعبًا · المضيف يلعب معكم</p></>}
        <Captcha onToken={setCaptchaToken}/>{error && <div className="error-message" role="alert">{error}</div>}<button className="button primary full" disabled={busy || !configured}>{busy ? 'لحظة ونجهّزها…' : modal === 'create' ? 'إنشاء الغرفة' : 'دخول الغرفة'}<ArrowLeft size={18}/></button>
      </form><p className="privacy-note"><LockKeyhole size={13}/> جلستك محفوظة على هذا المتصفح لاستعادة دخولك.</p></>}
    </dialog>
  </div>;
}
