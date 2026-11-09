import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { Store } from '@southview/db/connection';

/**
 * Shared mocked Google sign-in for tests. Only Google's network boundary (token exchange and
 * public keys) is replaced; Better Auth's real handlers, state, PKCE, cookies and adapter run.
 */
export const googleTestClient = {
  id: 'south-view-test.apps.googleusercontent.com',
  secret: 'private-test-google-client-secret',
};
export type GoogleProfile = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  aud?: string;
};
type AuthLike = {
  handler(request: Request): Promise<Response>;
  api: {
    getSession(input: { headers: Headers }): Promise<{
      user: { id: string; name: string; email: string };
    } | null>;
  };
};

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyId = 'local-google-test-key';
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: keyId, use: 'sig', alg: 'RS256' };

function signedToken(profile: GoogleProfile) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: keyId, typ: 'JWT' })).toString(
    'base64url',
  );
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: googleTestClient.id,
      iat: now,
      exp: now + 600,
      name: 'Private Google Account Name',
      picture: 'https://example.org/private-account-photo.jpg',
      ...profile,
    }),
  ).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

export function cookieOf(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}

export function mockGoogle(t: TestContext, origin: string) {
  const codes = new Map<string, { profile: GoogleProfile; challenge: string }>();
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === 'https://www.googleapis.com/oauth2/v3/certs')
      return Response.json({ keys: [jwk] });
    assert.equal(
      request.url,
      'https://oauth2.googleapis.com/token',
      'No unexpected network access',
    );
    const body = new URLSearchParams(await request.text());
    const code = body.get('code') ?? '';
    const item = codes.get(code);
    codes.delete(code);
    if (!item) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    assert.equal(body.get('redirect_uri'), `${origin}/api/auth/callback/google`);
    assert.equal(body.get('client_id'), googleTestClient.id);
    assert.equal(body.get('client_secret'), googleTestClient.secret);
    assert.equal(
      createHash('sha256')
        .update(body.get('code_verifier') ?? '')
        .digest('base64url'),
      item.challenge,
    );
    return Response.json({
      access_token: `private-access-token-${item.profile.sub}`,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'openid email profile',
      id_token: signedToken(item.profile),
    });
  });
  async function begin(auth: AuthLike, body: Record<string, unknown> = {}) {
    const response = await auth.handler(
      new Request(`${origin}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          callbackURL: '/my-contributions',
          errorCallbackURL: '/sign-in?next=%2Fmy-contributions',
          ...body,
        }),
      }),
    );
    assert.equal(response.status, 200, await response.clone().text());
    const url = new URL((await response.json()).url);
    return { url, cookie: cookieOf(response), state: url.searchParams.get('state')! };
  }
  function finish(
    auth: AuthLike,
    flow: Awaited<ReturnType<typeof begin>>,
    profile: GoogleProfile,
    cookie = flow.cookie,
  ) {
    const code = randomUUID();
    codes.set(code, { profile, challenge: flow.url.searchParams.get('code_challenge')! });
    return auth.handler(
      new Request(
        `${origin}/api/auth/callback/google?${new URLSearchParams({ state: flow.state, code })}`,
        { headers: { cookie } },
      ),
    );
  }
  /** Completes a full mocked sign-in and returns the session cookie with its user. */
  async function signIn(auth: AuthLike, profile: GoogleProfile) {
    const result = await finish(auth, await begin(auth), profile);
    assert.equal(result.status, 302);
    assert.equal(new URL(result.headers.get('location')!, origin).pathname, '/my-contributions');
    const cookie = cookieOf(result);
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    assert.ok(session);
    return { cookie, session, userId: session.user.id };
  }
  return { begin, finish, signIn };
}

/** A pre-existing local account, as earlier email-code sign-ins created them. */
export async function insertLocalUser(
  store: Store,
  email: string,
  { name = 'Existing private account', verified = true } = {},
) {
  const id = randomUUID();
  await store.query(
    'INSERT INTO community.auth_user (id, name, email, email_verified) VALUES ($1, $2, $3, $4)',
    [id, name, email, verified],
  );
  return { id, name, email };
}
