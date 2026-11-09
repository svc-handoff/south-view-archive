import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getArchive } from '@southview/db';
import { CommunityShell } from '@/components/community-shell';
import { CommunityEntry } from '@/components/community-entry';
import { safeArchiveReturn } from '@/lib/archive-return';
export const dynamic = 'force-dynamic';
const readArchive = cache(getArchive);
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const [{ id }, archive] = await Promise.all([params, readArchive()]);
  const entry = archive.contributions.find((entry) => entry.id === id);
  if (!entry) return { title: 'Contribution not found', robots: { index: false } };
  let origin = 'http://localhost:3000';
  try {
    const configured = new URL(process.env.NEXT_PUBLIC_SITE_URL || origin);
    if (['https:', 'http:'].includes(configured.protocol)) origin = configured.origin;
  } catch {
    /* Local origin is the default. */
  }
  return {
    title: entry.title,
    description: `${archive.credits.find((credit) => credit.id === entry.creditId)?.displayName ?? 'Community contributor'} — ${entry.title}`,
    alternates: { canonical: `${origin}/contributions/${encodeURIComponent(entry.id)}` },
  };
}
export default async function ContributionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, archive, query] = await Promise.all([params, readArchive(), searchParams]);
  const entry = archive.contributions.find((entry) => entry.id === id);
  if (!entry) notFound();
  return (
    <CommunityShell
      title="Stories from the community"
      description="The people who remember, the materials they preserve, and the stories they share."
      compact
      hideIntro
      backHref={safeArchiveReturn(query.from)}
      backLabel="Back to the map"
    >
      <CommunityEntry entry={entry} archive={archive} returnTo={safeArchiveReturn(query.from)} />
    </CommunityShell>
  );
}
