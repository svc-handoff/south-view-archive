import { AdminView, adminMetadata } from '../admin-view';

export const dynamic = 'force-dynamic';
export const metadata = adminMetadata('People · Archive admin');

export default function AdminPeoplePage() {
  return <AdminView tab="people" />;
}
