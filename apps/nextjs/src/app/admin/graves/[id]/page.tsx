import { AdminView, adminMetadata } from '../../admin-view';

export const dynamic = 'force-dynamic';
export const metadata = adminMetadata('Graves · Archive admin');

type Props = { params: Promise<{ id: string }> };

export default async function AdminGravePage({ params }: Props) {
  const { id } = await params;
  return <AdminView tab="graves" recordId={decodeURIComponent(id)} />;
}
