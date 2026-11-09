import { redirect } from 'next/navigation';
import { adminRecordUrl } from '@/lib/review-state';
import { AdminView, adminMetadata } from '../admin-view';

export const dynamic = 'force-dynamic';
export const metadata = adminMetadata('Archive admin');

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : null);

export default async function ContributionReviewPage({ searchParams }: Props) {
  // Links from before People and Places had their own addresses.
  const search = await searchParams;
  const tab = one(search.tab);
  if (tab === 'people') redirect(adminRecordUrl('people', one(search.person)));
  if (tab === 'places') redirect(adminRecordUrl('places', one(search.place)));
  return <AdminView tab="contributions" />;
}
