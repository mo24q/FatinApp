import {notFound} from 'next/navigation';
import {AvalonOnline} from '@/components/avalon/online';
export const metadata={title:'غرفة أفالون — فطين',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{code:string}>}){const {code}=await params;const normalized=code.toUpperCase();if(!/^[A-Z0-9]{6}$/.test(normalized))notFound();return <AvalonOnline code={normalized}/>;}
