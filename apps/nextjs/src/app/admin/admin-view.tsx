import type { Metadata } from 'next';
import { getArchive } from '@southview/db';
import { Suspense } from 'react';
import { SiteNavigation } from '@/components/site-navigation';
import { ReviewDesk } from '@/components/review-desk';
import type { AdminTab } from '@/lib/review-state';
import '@/components/community.css';
import '@/components/review-desk.css';

export const adminMetadata = (title: string): Metadata => ({
  title,
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
});

/** The archive admin, opened on one of its areas and, for people and places, one record. */
export async function AdminView({
  tab,
  recordId = null,
}: {
  tab: AdminTab;
  recordId?: string | null;
}) {
  const archive = await getArchive();
  return (
    <div className="review-page">
      <SiteNavigation workspace />
      <main id="main-content" className="review-main">
        <Suspense fallback={<p className="review-access">Opening the archive admin…</p>}>
          <ReviewDesk archive={archive} initialTab={tab} initialRecordId={recordId} />
        </Suspense>
      </main>
    </div>
  );
}
