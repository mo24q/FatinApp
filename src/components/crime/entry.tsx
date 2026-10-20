'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Fingerprint, Smartphone, Users } from 'lucide-react';
import { Brand, Footer } from '../brand';
import { Captcha } from '../captcha';
import { CrimeRules } from './table';
import { CrimeCardTile } from './cards';
import { configured, ensureGuest } from '@/lib/supabase';
import { crimeAction, crimeError } from '@/lib/crime-client';
import type { CrimeView } from '@/lib/crime-game';
export function CrimeEntry({join=''}:{join?:string}) {
  const router=useRouter();
  const [form,setForm]=useState<'create'|'join'|null>(join?'join':null);
  const [name,setName]=useState('');
  const [code,setCode]=useState(join.replace(/[^A-Z0-9]/gi,'').toUpperCase().slice(0,6));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [captcha,setCaptcha]=useState('');
  return <div className="room-shell crime-shell"><header className="header room-header"><Brand/><Link className="text-button" href="/">ألعاب فطين</Link></header>
    <main id="main"><section className="crime-intro"><span className="eyebrow"><Fingerprint size={17}/>لعبة التحقيق والخداع من فطين</span><h1>الجريمة<br/><span className="purple">المغلقة</span><span className="orange">.</span></h1><p>مجرم بينكم. ثماني بطاقات قدّام كل لاعب.<br/>والراوي وحده يعرف حقيقة القضية.</p><div className="crime-intro-cards" aria-hidden="true"><CrimeCardTile id="w01"/><CrimeCardTile id="e02"/><CrimeCardTile id="w02"/></div><div className="crime-facts"><span>٤–١٢ لاعبًا</span><span>راوي + مجرم + محققون</span><span>١٢٨ بطاقة</span></div></section>
      {!form?<section className="crime-mode-options"><Link className="mode-option" href="/crime/local"><span className="mode-symbol"><Smartphone size={24}/></span><span><strong>جوال واحد</strong><small>مرّروا الأدوار، تصفّحوا البطاقات وشاركوها.</small></span><ArrowLeft size={20}/></Link><button className="mode-option" onClick={()=>setForm('create')}><span className="mode-symbol"><Users size={24}/></span><span><strong>كل واحد بجواله</strong><small>غرفة خاصة وأدوار سرية وبطاقات مشتركة.</small></span><ArrowLeft size={20}/></button><button className="text-button" onClick={()=>setForm('join')}>عندي رمز غرفة الجريمة</button></section>:<section className="panel crime-entry"><h2>{form==='create'?'افتح غرفة تحقيق':'انضم للقضية'}</h2><p>اسمك يكفي؛ ما تحتاج حسابًا.</p>{!configured&&<div className="notice">الغرف تحتاج إعداد Supabase. تقدر تلعب بجوال واحد الآن.</div>}
        <form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await ensureGuest(captcha);const room=await crimeAction<CrimeView>(form,code,null,{name});router.push(`/crime/room/${room.code}`);}catch(err){setError(crimeError(err));setBusy(false);}}}>
          <label>اسمك<input autoComplete="nickname" aria-label="اسمك" required minLength={2} maxLength={20} value={name} onChange={e=>setName(e.target.value)}/></label>
          {form==='join'&&<label>رمز الغرفة<input aria-label="رمز الغرفة" dir="ltr" className="code-input" required pattern="[A-Z0-9]{6}" minLength={6} maxLength={6} value={code} onChange={e=>setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6))}/></label>}
          <Captcha onToken={setCaptcha}/>{error&&<div className="error-message" role="alert">{error}</div>}
          <button className="button primary full" disabled={busy||!configured}>{busy?'نفتح الملف…':form==='create'?'إنشاء غرفة':'دخول الغرفة'}</button>
        </form><button className="text-button" disabled={busy} onClick={()=>{setForm(null);setError('');}}>رجوع لطرق اللعب</button>
      </section>}
      <CrimeRules/><p className="crime-original-note">بطاقات برسومات فطين وأسماء أشياء مألوفة. محتوى مستقل للعب الجماعي.</p>
    </main><Footer/></div>;
}
