import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CrimeOnline } from '@/components/crime/online';
export const metadata:Metadata={title:'غرفة الجريمة المغلقة | فطين',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{code:string}>}){
  const {code}=await params;const normalized=code.toUpperCase();
  if(!/^[A-Z0-9]{6}$/.test(normalized))notFound();
  return <CrimeOnline code={normalized}/>;
}
