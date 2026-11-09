import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { createCaller } from '@southview/api';
import { PersonArchive } from '../../../components/person-archive';

const getSnapshot = cache(async () => createCaller({}).archive.snapshot());
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function siteOrigin() {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000');
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin;
  } catch {
    /* The local demo still has a usable canonical URL. */
  }
  return 'http://localhost:3000';
}

function safeReturnPath(value: string | string[] | undefined, id: string) {
  const fallback = `/explore?person=${encodeURIComponent(id)}`;
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback;
  try {
    const url = new URL(value, 'https://archive.invalid');
    if (url.origin !== 'https://archive.invalid' || url.pathname !== '/explore') return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const data = await getSnapshot();
  const person = data.people.find((item) => item.id === id);
  if (!person) return { title: 'Record not found', robots: { index: false } };
  const canonical = `${siteOrigin()}/people/${encodeURIComponent(person.id)}`;
  return {
    title: person.name,
    description: person.summary,
    alternates: { canonical },
    openGraph: {
      title: `${person.name} | South-View`,
      description: person.summary,
      url: canonical,
      type: 'article',
    },
  };
}

export default async function PersonPage({ params, searchParams }: Props) {
  const [{ id }, query, data] = await Promise.all([params, searchParams, getSnapshot()]);
  const person = data.people.find((item) => item.id === id);
  if (!person) notFound();
  return (
    <PersonArchive
      person={person}
      data={data}
      returnTo={safeReturnPath(query.from, person.id)}
      canonicalUrl={`${siteOrigin()}/people/${encodeURIComponent(person.id)}`}
      startEditing={query.edit === '1'}
    />
  );
}
