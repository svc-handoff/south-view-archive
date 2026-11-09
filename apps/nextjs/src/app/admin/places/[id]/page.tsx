import { AdminView, adminMetadata } from '../../admin-view';

export const dynamic = 'force-dynamic';
export const metadata = adminMetadata('Places · Archive admin');

type Props = { params: Promise<{ id: string }> };

export default async function AdminPlacePage({ params }: Props) {
  const { id } = await params;
  return <AdminView tab="places" recordId={decodeURIComponent(id)} />;
}
