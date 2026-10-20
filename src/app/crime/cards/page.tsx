import type { Metadata } from 'next';
import { SharedCrimeCards } from '@/components/crime/shared';
export const metadata:Metadata={title:'بطاقات القضية | فطين',robots:{index:false,follow:false}};
export default function Page(){return <SharedCrimeCards/>;}
