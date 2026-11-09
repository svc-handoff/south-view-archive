import { createCaller } from '@southview/api';
import { Explorer } from '@/components/explorer';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Explore the map' };
export default async function ExplorePage() {
  const archive = await createCaller({}).archive.snapshot();
  return <Explorer archive={archive} />;
}
