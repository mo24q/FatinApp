import {AvalonEntry} from '@/components/avalon/entry';
export const metadata={title:'أفالون — فطين',description:'أدوار سرية ومهمات وفرق. أفالون بالعربي، بجوال واحد أو غرفة خاصة دون راوي.'};
export default async function Page({searchParams}:{searchParams:Promise<{join?:string}>}){const p=await searchParams;return <AvalonEntry join={typeof p.join==='string'?p.join:''}/>;}
