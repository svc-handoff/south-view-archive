import { SiteNavigation } from '@/components/site-navigation';

export default function Loading() {
  return (
    <>
      <SiteNavigation />
      <main id="main-content" className="page-message">
        <p className="eyebrow">SOUTH-VIEW · A LIVING ARCHIVE</p>
        <h1>Opening the archive…</h1>
        <p>The map and the people behind it will be here shortly.</p>
      </main>
    </>
  );
}
