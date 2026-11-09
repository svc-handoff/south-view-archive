import Link from 'next/link';
import { ArrowLeft, Sprout } from 'lucide-react';
import type { ReactNode } from 'react';
import './community.css';
import { SiteNavigation } from './site-navigation';

export function CommunityShell({
  children,
  eyebrow = 'THE COMMUNITY ARCHIVE',
  title,
  description,
  compact = false,
  hideIntro = false,
  backHref = '/explore',
  backLabel = 'Back to the archive',
}: {
  children: ReactNode;
  eyebrow?: string;
  title: string;
  description?: string;
  compact?: boolean;
  hideIntro?: boolean;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="community-page">
      <SiteNavigation />
      <main id="main-content" className={`community-main ${compact ? 'community-compact' : ''}`}>
        <Link className="community-back" href={backHref}>
          <ArrowLeft size={17} aria-hidden="true" /> {backLabel}
        </Link>
        {!hideIntro && (
          <div className="community-intro">
            <div>
              <p className="eyebrow">{eyebrow}</p>
              <h1>{title}</h1>
              {description && <p className="community-deck">{description}</p>}
            </div>
            <Sprout className="community-sprout" size={74} strokeWidth={0.7} aria-hidden="true" />
          </div>
        )}
        {children}
      </main>
      <footer className="community-footer">
        <span>SOUTH-VIEW / A LIVING ARCHIVE</span>
      </footer>
    </div>
  );
}

export function CommunityNotice({
  title,
  children,
  kind = 'info',
}: {
  title?: string;
  children: ReactNode;
  kind?: 'info' | 'error' | 'success';
}) {
  return (
    <div className={`community-notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  );
}
