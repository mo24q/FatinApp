'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Brand, Footer } from '../brand';
import { HandGrid } from './cards';
import { parseCrimeHand } from '@/lib/crime-game';
export function SharedCrimeCards() {
  const [data,setData]=useState<ReturnType<typeof parseCrimeHand>>(null),[loaded,setLoaded]=useState(false);
  useEffect(()=>{const read=()=>{setData(parseCrimeHand(location.hash));setLoaded(true);};read();window.addEventListener('hashchange',read);return()=>window.removeEventListener('hashchange',read);},[]);
  return <div className="room-shell crime-shell"><header className="header room-header"><Brand/><span className="soft-badge">بطاقات مشتركة</span></header><main id="main"><div className="crime-heading"><span className="section-kicker">فطين · الجريمة المغلقة</span><h1>{data?`بطاقات ${data.name}`:'ملف البطاقات'}</h1><p>بطاقات ظاهرة للجميع. هذا الرابط لا يحتوي على دور اللاعب أو حل القضية، ولا يتحدث عند بدء قضية جديدة.</p></div>{data?<section className="panel crime-gallery"><HandGrid hand={data.hand}/></section>:<p className="notice">{loaded?'الرابط ناقص أو غير صالح. اطلب من صاحب الجوال مشاركة البطاقات مجددًا.':'نفتح البطاقات…'}</p>}<Link href="/crime" className="button light-purple full">العب الجريمة المغلقة في فطين</Link></main><Footer/></div>;
}
