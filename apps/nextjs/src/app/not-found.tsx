import Link from 'next/link';
import { SiteNavigation } from '@/components/site-navigation';

export default function NotFound() {
  return (
    <>
      <SiteNavigation />
      <main id="main-content" className="page-message">
        <p className="eyebrow">SOUTH-VIEW</p>
        <h1>This record wasn’t found.</h1>
        <p>Explore the collection to find another life and its connected places.</p>
        <Link className="archive-button" href="/explore">
          Return to the map
        </Link>
      </main>
    </>
  );
}
