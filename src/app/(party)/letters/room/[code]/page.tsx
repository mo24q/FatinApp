import { notFound } from 'next/navigation';
import { PartyOnline } from '@/components/party/online';
export const metadata={title:'غرفة حرف ورا حرف — فطين',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{code:string}>}){const {code}=await params;const normalized=code.toUpperCase();if(!/^[A-Z0-9]{6}$/.test(normalized))notFound();return <PartyOnline kind="letters" code={normalized}/>;}
