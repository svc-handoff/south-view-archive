import { AdminView, adminMetadata } from '../admin-view';

export const dynamic = 'force-dynamic';
export const metadata = adminMetadata('Settings · Archive admin');

export default function AdminSettingsPage() {
  return <AdminView tab="settings" />;
}
