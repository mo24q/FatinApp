import { PartyEntry } from '@/components/party/entry';
export const metadata={title:'السؤال المغلوط — فطين'};
export default async function Page({searchParams}:{searchParams:Promise<{join?:string}>}){const params=await searchParams;return <PartyEntry kind="wrong" join={typeof params.join==='string'?params.join:''}/>;}
