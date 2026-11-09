'use client';
import { SiteNavigation } from '@/components/site-navigation';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <>
      <SiteNavigation />
      <main id="main-content" className="page-message">
        <p className="eyebrow">SOUTH-VIEW</p>
        <h1>The archive is temporarily unavailable.</h1>
        <p>The collection could not be loaded. Please try again in a moment.</p>
        <button className="archive-button" onClick={reset}>
          Try again
        </button>
      </main>
    </>
  );
}
