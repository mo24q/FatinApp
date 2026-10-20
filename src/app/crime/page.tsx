import type { Metadata } from 'next';
import { CrimeEntry } from '@/components/crime/entry';
export const metadata:Metadata={title:'الجريمة المغلقة | فطين',description:'مجرم وراوي ومحققون. لعبة تحقيق عربية بجوال واحد أو غرفة أونلاين، وبطاقات فطين الأصلية.'};
export default async function Page({searchParams}:{searchParams:Promise<{join?:string}>}) {
  const params=await searchParams;
  return <CrimeEntry join={typeof params.join==='string'?params.join:''}/>;
}
