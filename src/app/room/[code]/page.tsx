import { RoomView } from '@/components/room';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <RoomView code={code.toUpperCase()}/>;
}
