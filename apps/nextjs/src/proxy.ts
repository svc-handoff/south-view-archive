import { NextResponse, type NextRequest } from 'next/server';

/** Passes the requested path to the root layout, which shows the offline page when staff take
 * the site down but must leave the admin and sign-in pages working. */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-archive-path', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!api/|_next/|favicon.ico|icon.svg).*)'],
};
