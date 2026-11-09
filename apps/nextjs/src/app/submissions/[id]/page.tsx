import type { Metadata } from 'next';
import { CommunityShell } from '@/components/community-shell';
import { SubmissionManager } from '@/components/submission-manager';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your contribution',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CommunityShell
      title="Your contribution, in good hands."
      description="Follow the review, add a detail, and stay connected to the story you shared."
    >
      <SubmissionManager id={id} />
    </CommunityShell>
  );
}
