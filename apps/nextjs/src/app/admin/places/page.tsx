import { AdminView, adminMetadata } from '../admin-view';

export const dynamic = 'force-dynamic';
export const metadata = adminMetadata('Places · Archive admin');

export default function AdminPlacesPage() {
  return <AdminView tab="places" />;
}
