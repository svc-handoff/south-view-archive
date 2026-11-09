import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { createCaller } from '@southview/api';
import { PlaceArchive } from '../../../components/place-archive';

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

function safeReturnPath(value: string | string[] | undefined, fallback: string) {
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
  const place = data.places.find((item) => item.id === id);
  if (!place) return { title: 'Place not found', robots: { index: false } };
  const canonical = `${siteOrigin()}/places/${encodeURIComponent(place.id)}`;
  const description = place.summary || place.locationNote;
  return {
    title: place.name,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${place.name} | South-View`,
      description,
      url: canonical,
      type: 'article',
    },
  };
}

export default async function PlacePage({ params, searchParams }: Props) {
  const [{ id }, query, data] = await Promise.all([params, searchParams, getSnapshot()]);
  const place = data.places.find((item) => item.id === id);
  if (!place) notFound();
  const fromPerson =
    typeof query.person === 'string'
      ? data.people.find(
          (item) =>
            item.id === query.person &&
            data.relations.some(
              (relation) => relation.placeId === place.id && relation.personId === item.id,
            ),
        )
      : undefined;
  return (
    <PlaceArchive
      place={place}
      data={data}
      fromPerson={fromPerson}
      returnTo={safeReturnPath(
        query.from,
        `/explore?scope=${place.scope}&place=${encodeURIComponent(place.id)}`,
      )}
      canonicalUrl={`${siteOrigin()}/places/${encodeURIComponent(place.id)}`}
    />
  );
}
