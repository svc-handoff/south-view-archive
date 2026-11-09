import { AdminView, adminMetadata } from '../../admin-view';

export const dynamic = 'force-dynamic';
export const metadata = adminMetadata('People · Archive admin');

type Props = { params: Promise<{ id: string }> };

export default async function AdminPersonPage({ params }: Props) {
  const { id } = await params;
  return <AdminView tab="people" recordId={decodeURIComponent(id)} />;
}
