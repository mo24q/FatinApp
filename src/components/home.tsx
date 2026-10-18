'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUpLeft, Check, Clock3, Gamepad2, LockKeyhole, Plus, Sparkles, Users, X, Zap } from 'lucide-react';
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
  const [modal, setModal] = useState<'create' | 'join' | null>(null);
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
      localStorage.setItem('lamma-name', name.trim()); localStorage.setItem('lamma-room', room.code);
      router.push(`/room/${room.code}`);
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  }
  return <div className="site-shell">
    <header className="header"><Brand/><nav aria-label="التنقل الرئيسي"><a href="#games">الألعاب</a><a href="#how">كيف نلعب؟</a></nav><button className="button outline small-button" onClick={() => setModal('join')}>انضم لغرفة <ArrowUpLeft size={17}/></button></header>
    <main id="main">
      <section className="hero">
        <div className="hero-copy"><div className="eyebrow"><span className="green-dot"/> وجيه نحبها. وقت يجمعنا.</div>
          <h1>جمعتكم<br/>ناقصها <span className="headline-word">لعبة<svg viewBox="0 0 240 22" aria-hidden="true"><path d="M5 16 Q110 -2 235 12"/></svg></span><span className="orange">.</span></h1>
          <p className="hero-description">خلّوا الجوالات تجمعكم.<br/>اختاروا لعبة، شاركوا رمز الغرفة، والباقي علينا.</p>
          <div className="hero-buttons"><button className="button primary" onClick={() => setModal('create')}>يلا نبدأ اللمّة <ArrowLeft size={20}/></button><button className="button white" onClick={() => setModal('join')}>معك رمز غرفة؟</button></div>
          <div className="hero-perks"><span><Check size={15}/> بدون حسابات</span><span><Check size={15}/> من جوالاتكم</span><span><Check size={15}/> في نفس المكان</span></div>
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
      <section className="gather-strip"><span className="strip-icon"><Gamepad2 size={23}/></span><p><strong>جوال لكل واحد. ضحكة للكل.</strong><span>لا أوراق، لا تجهيز طويل. بس أنتم واللعبة.</span></p><span className="strip-sparkle">✧</span></section>
      <section id="games" className="games-section"><div className="section-heading"><div><span className="section-kicker">وش جوّكم اليوم؟</span><h2>لكل لمّة، لعبة.</h2></div><span className="soft-badge">البداية بلعبة… والباقي جاي</span></div>
        <div className="games-grid">{games.map((game, i) => <article key={game.id} className={`game-card ${game.available ? 'available' : 'coming'}`}>
          <div className={`game-visual visual-${i}`}><span className="game-tag">{game.available ? 'جاهزة للّعب' : 'قريبًا'}</span>{i === 0 ? <><div className="question-mark">؟</div><Character small/><div className="small-chat">أنا؟ مستحيل!</div></> : i === 1 ? <><Zap className="big-game-icon" strokeWidth={1.5}/><span className="decorative-letters">أ ب ج</span></> : <><div className="wave-circle circle-one"/><div className="wave-circle circle-two"/><Sparkles className="wave-star" size={30}/></>}</div>
          <div className="game-content"><span className="game-category">{game.tag}</span><h3>{game.name}</h3><p>{game.description}</p><div className="game-meta"><span><Users size={16}/>{game.players}</span>{game.time && <span><Clock3 size={16}/>{game.time}</span>}</div>
            <button disabled={!game.available} className={`button full ${game.available ? 'light-purple' : 'coming-button'}`} onClick={() => setModal('create')}>{game.available ? 'نلعب برا السالفة' : 'في الطريق للّمة'}{game.available && <ArrowLeft size={18}/>}</button>
          </div></article>)}</div>
      </section>
      <section id="how" className="how-section"><div className="section-heading"><div><span className="section-kicker">أسهل من ترتيب الطلعة</span><h2>ثلاث خطوات، وتبدأ السوالف.</h2></div></div><div className="steps-grid">
        <div><span className="step-number">١</span><h3>واحد يفتح غرفة</h3><p>اختاروا المضيف، اكتبوا اسمه، وخلّوه يجهّز اللمّة.</p></div>
        <div><span className="step-number">٢</span><h3>الباقي يدخلون بالرمز</h3><p>كل واحد من جواله. اسم ورمز، بدون حساب أو تحميل.</p></div>
        <div><span className="step-number">٣</span><h3>خبّوا أدواركم… والعبوا</h3><p>شوف دورك لحالك، واسأل بذكاء. مين اللي مو معنا؟</p></div>
      </div></section>
      <div className="bottom-note"><LockKeyhole size={17}/><span>كل دور لصاحبه فقط. حتى المضيف ما يشوف أسراركم.</span></div>
    </main><Footer/>
    <dialog ref={dialog} className="entry-dialog" onCancel={e => { if (busy) e.preventDefault(); else setModal(null); }} onClose={() => { if (!busy) setModal(null); }} aria-labelledby="entry-title">
      <button className="icon-button close-dialog" onClick={() => setModal(null)} disabled={busy} aria-label="إغلاق"><X size={21}/></button>
      <div className="dialog-icon">{modal === 'create' ? <Plus size={27}/> : <Users size={27}/>}</div><h2 id="entry-title">{modal === 'create' ? 'أنت راعي اللمّة.' : 'مكانك بيننا.'}</h2><p className="muted">{modal === 'create' ? 'افتح غرفة برا السالفة وشارك رمزها مع أصحابك.' : 'اكتب اسمك ورمز الغرفة، وادخل مع أصحابك.'}</p>
      {!configured && <div className="notice">هذه النسخة جاهزة للربط. لتشغيل الغرف، أكمل إعداد Supabase الموضّح في README.</div>}
      <form onSubmit={submit}><label htmlFor="name">وش نناديك؟</label><input id="name" value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={20} required placeholder="اسمك بين أصحابك" autoComplete="nickname" autoFocus/>
        {modal === 'join' ? <><label htmlFor="code">رمز الغرفة</label><input id="code" className="code-input" dir="ltr" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0,6))} required minLength={6} maxLength={6} pattern="[A-Z0-9]{6}" placeholder="ABC234" autoComplete="off" autoCapitalize="characters" spellCheck={false}/></> : <><label htmlFor="seconds">وقت النقاش</label><select id="seconds" value={seconds} onChange={e => setSeconds(Number(e.target.value))}><option value={60}>دقيقة واحدة</option><option value={120}>دقيقتان — مناسب للبداية</option><option value={180}>٣ دقائق</option><option value={300}>٥ دقائق</option></select><p className="field-note">٣–١٢ لاعبًا · المضيف يلعب معكم</p></>}
        <Captcha onToken={setCaptchaToken}/>{error && <div className="error-message" role="alert">{error}</div>}<button className="button primary full" disabled={busy || !configured}>{busy ? 'لحظة ونجهّزها…' : modal === 'create' ? 'إنشاء الغرفة' : 'دخول الغرفة'}<ArrowLeft size={18}/></button>
      </form><p className="privacy-note"><LockKeyhole size={13}/> جلستك محفوظة على هذا المتصفح لاستعادة دخولك.</p>
    </dialog>
  </div>;
}
