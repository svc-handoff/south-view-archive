import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { getSiteStatus } from '@southview/db/settings';
import { getSession, isReviewer } from '@southview/services/auth';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'South-View — A Living Archive', template: '%s · South-View' },
  description:
    'Explore the people remembered at South-View Cemetery and the places connected to their lives. A source-led community history atlas.',
};

/** Staff pages and sign-in keep working while the site is offline, so staff can bring it back. */
const alwaysOpen = (path: string) => /^\/(admin|sign-in)(\/|$)/.test(path);

/** Visitors see this instead of the archive while staff have the site offline. Staff who are
 * signed in still see the archive, to check it before bringing it back. */
async function offlinePage() {
  const status = await getSiteStatus();
  if (!status.offline) return null;
  const requestHeaders = await headers();
  if (alwaysOpen(requestHeaders.get('x-archive-path') ?? '')) return null;
  const session = await getSession(requestHeaders).catch(() => null);
  if (session && (await isReviewer(session.user.id).catch(() => false))) return null;
  return (
    <main id="main-content" className="site-offline">
      <h1>The South-View archive is temporarily offline</h1>
      <p>{status.message || 'Please check back soon.'}</p>
      <Link href="/sign-in?next=%2Fadmin">Staff sign in</Link>
    </main>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const offline = await offlinePage();
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {offline ?? children}
      </body>
    </html>
  );
}
