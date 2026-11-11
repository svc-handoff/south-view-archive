import { AdminView, adminMetadata } from '../admin-view';

export const dynamic = 'force-dynamic';
export const metadata = adminMetadata('Graves · Archive admin');

export default function AdminGravesPage() {
  return <AdminView tab="graves" />;
}
