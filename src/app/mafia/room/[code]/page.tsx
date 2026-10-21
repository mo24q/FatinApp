import { notFound } from 'next/navigation';
import { MafiaOnline } from '@/components/mafia/online';
export const metadata={title:'غرفة المافيا — فطين',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{code:string}>}){const {code}=await params;const normalized=code.toUpperCase();if(!/^[A-Z0-9]{6}$/.test(normalized))notFound();return <MafiaOnline code={normalized}/>;}
