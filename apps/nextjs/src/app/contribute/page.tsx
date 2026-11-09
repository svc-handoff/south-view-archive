import type { Metadata } from 'next';
import { getArchive } from '@southview/db';
import { CommunityShell } from '@/components/community-shell';
import { ContributionForm } from '@/components/contribution-form';
import { copy } from '@/lib/copy';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: copy.share,
  description:
    'Share a memory, a fact, or a photograph about a person in the South-View archive, or remember someone who is not in it yet.',
};
export default async function ContributePage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string }>;
}) {
  const [data, query] = await Promise.all([getArchive(), searchParams]);
  const people = data.people.map(({ id, name, aliases, birthYear, deathYear }) => ({
    id,
    name,
    aliases,
    birthYear,
    deathYear,
  }));
  const initialPersonId = people.some((person) => person.id === query.person)
    ? query.person
    : undefined;
  return (
    <CommunityShell
      title={copy.share}
      description="Three things are enough: who it is about, what you know, and how you know it. Reviewers read every story before it is published, and nothing is sent by email."
    >
      <ContributionForm
        people={people}
        places={data.places.map(({ id, name, scope }) => ({ id, name, scope }))}
        relations={data.relations.map(({ personId, placeId }) => ({ personId, placeId }))}
        initialPersonId={initialPersonId}
      />
    </CommunityShell>
  );
}
