import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@southview/api';
import { getSiteStatus } from '@southview/db/settings';
export const runtime = 'nodejs';
// The public archive data stays unavailable while staff have the site offline.
const handler = async (req: Request) =>
  (await getSiteStatus()).offline
    ? Response.json({ error: 'The South-View archive is temporarily offline.' }, { status: 503 })
    : fetchRequestHandler({ endpoint: '/api/trpc', req, router: appRouter, createContext: () => ({}) });
export { handler as GET, handler as POST };
