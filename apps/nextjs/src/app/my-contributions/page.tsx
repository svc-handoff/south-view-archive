import type { Metadata } from 'next';
import { CommunityShell } from '@/components/community-shell';
import { SubmissionManager } from '@/components/submission-manager';
export const metadata: Metadata = {
  title: 'My contributions',
  robots: { index: false, follow: false },
};
export default function MyContributionsPage() {
  return (
    <CommunityShell
      title="The stories you have shared."
      description="A place to follow your contributions and the conversations that help them grow."
    >
      <SubmissionManager />
    </CommunityShell>
  );
}
