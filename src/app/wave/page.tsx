import type { Metadata } from 'next';
import { WaveEntry } from '@/components/wave/entry';
export const metadata:Metadata={title:'نفس الموجة — فطين',description:'تلميح واحد، مؤشر وتخمينات تجمعكم. العب نفس الموجة بجوال واحد أو في غرفة خاصة، من لاعبين إلى ١٢.'};
export default async function Page({searchParams}:{searchParams:Promise<{join?:string}>}){const params=await searchParams;return <WaveEntry join={typeof params.join==='string'?params.join:''}/>;}
