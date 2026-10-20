import type { Metadata } from 'next';
import { LocalCrimeGame } from '@/components/crime/local';
export const metadata:Metadata={title:'الجريمة المغلقة — جوال واحد | فطين'};
export default function Page(){return <LocalCrimeGame/>;}
