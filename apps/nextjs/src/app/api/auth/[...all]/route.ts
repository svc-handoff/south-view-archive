import { getAuth } from '@southview/services/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request) {
  try {
    return await (await getAuth()).handler(request);
  } catch {
    return Response.json(
      { error: 'Sign-in is temporarily unavailable.' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}

export const GET = handle;
export const POST = handle;
