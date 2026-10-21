import { PartyEntry } from '@/components/party/entry';
export const metadata={title:'حرف ورا حرف — فطين'};
export default async function Page({searchParams}:{searchParams:Promise<{join?:string}>}){const params=await searchParams;return <PartyEntry kind="letters" join={typeof params.join==='string'?params.join:''}/>;}
