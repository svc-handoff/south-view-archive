import type { Metadata } from 'next';
import { CommunityShell } from '@/components/community-shell';
import { SignInForm } from '@/components/sign-in-form';
export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const query = await searchParams;
  const next = typeof query.next === 'string' ? query.next : undefined;
  const callbackError = typeof query.error === 'string' ? query.error : query.error?.[0];
  const authError = callbackError
    ? callbackError === 'access_denied'
      ? 'cancelled'
      : 'failed'
    : undefined;
  return (
    <CommunityShell
      title="Keep your stories together."
      description="Choose a sign-in option to follow the contributions you have shared, or continue as a guest."
      compact
    >
      <SignInForm next={next} authError={authError} />
    </CommunityShell>
  );
}
