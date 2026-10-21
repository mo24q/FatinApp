import type { Metadata } from 'next';
import { MafiaEntry } from '@/components/mafia/entry';
export const metadata:Metadata={title:'المافيا — فطين',description:'المافيا بجوال واحد أو غرفة خاصة. فطين يدير الليل والنهار، مع خيار راوي من اللاعبين.'};
export default async function Page({searchParams}:{searchParams:Promise<{join?:string}>}){const params=await searchParams;return <MafiaEntry join={typeof params.join==='string'?params.join:''}/>;}
