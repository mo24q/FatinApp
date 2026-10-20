import type { Metadata } from 'next';
import { LocalGame } from '@/components/local-game';
export const metadata: Metadata = { title: 'جوال واحد | فطين', description: 'برا السالفة على جوال واحد. أضف الأسماء ومرّر الجوال بين أصحابك.' };
export default function Page() { return <LocalGame/>; }
