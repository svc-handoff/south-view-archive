import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { getArchive } from '@southview/db';
import { createStore, setStoreForTests } from '@southview/db/connection';
import {
  createDraft,
  finalizeSubmission,
  getPublicContribution,
  reviewSubmission,
} from '@southview/db/community';
import { createAuth, getSignInMethods } from '@southview/services/auth';
import { safeCommunityNext, submissionInputSchema } from '@southview/validators';
import { GET, POST } from '../apps/nextjs/src/app/api/community/[...path]/route';
import {
  googleTestClient,
  insertLocalUser,
  mockGoogle,
  type GoogleProfile,
} from './helpers/google';

const origin = 'http://127.0.0.1:3000';
const environment = {
  NODE_ENV: 'test',
  ARCHIVE_DATA_MODE: 'local',
  BETTER_AUTH_URL: origin,
  NEXT_PUBLIC_SITE_URL: origin,
  BETTER_AUTH_SECRET: 'google-flow-test-secret-at-least-thirty-two-bytes',
  GOOGLE_CLIENT_ID: googleTestClient.id,
  GOOGLE_CLIENT_SECRET: googleTestClient.secret,
};
type Auth = Awaited<ReturnType<typeof createAuth>>;

async function setup(t: TestContext) {
  const previous = Object.fromEntries(
    Object.keys(environment).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, environment);
  const store = await createStore({ mode: 'local', path: 'memory://', seed: false });
  setStoreForTests(store);
  const auth = await createAuth(store, environment);
  const google = mockGoogle(t, origin);
  t.after(async () => {
    setStoreForTests(undefined);
    await store.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  type Flow = Awaited<ReturnType<typeof google.begin>>;
  return {
    auth,
    store,
    begin: (body?: Record<string, unknown>) => google.begin(auth, body),
    finish: (flow: Flow, profile: GoogleProfile, cookie?: string) =>
      google.finish(auth, flow, profile, cookie),
    google: (profile: GoogleProfile) => google.signIn(auth, profile),
    email: (address: string) => insertLocalUser(store, address),
  };
}

function post(auth: Auth, path: string, body: unknown, originHeader = origin) {
  return auth.handler(
    new Request(`${origin}/api/auth${path}`, {
      method: 'POST',
      headers: { Origin: originHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

function community(path: string, cookie?: string, receipt?: string, method = 'GET') {
  const request = new Request(`${origin}/api/community/${path}`, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(receipt ? { 'X-Receipt-Token': receipt } : {}),
    },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
  return (method === 'GET' ? GET : POST)(request, {
    params: Promise.resolve({ path: path.split('/') }),
  });
}

test('Google capability requires complete credentials and secure production config', (t) => {
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (message: string) => {
    warnings.push(message);
  });
  assert.deepEqual(getSignInMethods(environment), { google: true });
  assert.deepEqual(getSignInMethods({ ...environment, GOOGLE_CLIENT_SECRET: '' }), {
    google: false,
  });
  assert.deepEqual(getSignInMethods({ ...environment, ARCHIVE_DATA_MODE: 'fixture' }), {
    google: false,
  });
  assert.deepEqual(getSignInMethods({ ...environment, NODE_ENV: 'production' }), {
    google: false,
  });
  assert.deepEqual(
    getSignInMethods({
      ...environment,
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://archive.example.org',
    }),
    { google: true },
  );
  assert.equal(getSignInMethods({ ...environment, BETTER_AUTH_SECRET: 'short' }).google, false);
  assert.ok(warnings.length > 0);
  for (const warning of warnings) {
    assert.equal(warning.includes(environment.GOOGLE_CLIENT_ID), false);
    assert.equal(warning.includes(environment.GOOGLE_CLIENT_SECRET), false);
  }
});

test('safe login destinations retain person context and never carry a receipt or external origin', () => {
  assert.equal(
    safeCommunityNext('/contribute?person=john-lewis&receipt=private#receipt=private'),
    '/contribute?person=john-lewis',
  );
  assert.equal(safeCommunityNext('/submissions/abc-123#receipt=private'), '/submissions/abc-123');
  assert.equal(safeCommunityNext('/admin/people/john-lewis'), '/admin/people/john-lewis');
  assert.equal(safeCommunityNext('/admin/places'), '/admin/places');
  assert.equal(safeCommunityNext('/admin/people/a/b'), '/my-contributions');
  for (const value of [
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/api/community/session',
    '/sign-in?next=//evil.example',
  ])
    assert.equal(safeCommunityNext(value), '/my-contributions');
});

test('Google redirect requests use only basic online scopes and state/PKCE; unsafe client overrides are removed', async (t) => {
  const { auth, begin, store } = await setup(t);
  const flow = await begin({
    callbackURL: '/submissions/abc-123?receipt=secret#receipt=secret',
    errorCallbackURL: '/sign-in?next=%2Fsubmissions%2Fabc-123&receipt=secret#receipt=secret',
  });
  assert.equal(flow.url.origin, 'https://accounts.google.com');
  assert.equal(flow.url.searchParams.get('redirect_uri'), `${origin}/api/auth/callback/google`);
  assert.deepEqual(flow.url.searchParams.get('scope')!.split(' ').sort(), [
    'email',
    'openid',
    'profile',
  ]);
  assert.equal(flow.url.searchParams.get('access_type'), 'online');
  assert.notEqual(flow.url.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(flow.url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(flow.state.length >= 20);
  assert.ok(flow.cookie);
  const savedState = JSON.stringify(
    (await store.query('SELECT value FROM community.auth_verification')).rows,
  );
  assert.equal(savedState.includes('receipt'), false);
  for (const overrides of [
    { scopes: ['https://www.googleapis.com/auth/drive'] },
    { additionalParams: { access_type: 'offline', include_granted_scopes: 'true' } },
    { additionalData: { receipt: 'secret' } },
  ])
    assert.equal(
      (await post(auth, '/sign-in/social', { provider: 'google', ...overrides })).status,
      400,
    );
  assert.ok(
    (await post(auth, '/sign-in/social', { provider: 'google', idToken: { token: 'injected' } }))
      .status >= 400,
  );
  assert.ok(
    (await post(auth, '/sign-in/social', { provider: 'google' }, 'https://evil.example')).status >=
      400,
  );
  const badTarget = await post(auth, '/sign-in/social', {
    provider: 'google',
    callbackURL: 'https://evil.example',
    errorCallbackURL: '//evil.example',
  });
  // Either rejecting a foreign target or canonicalizing it to a safe local target is acceptable.
  if (badTarget.ok) {
    const states = JSON.stringify(
      (await store.query('SELECT value FROM community.auth_verification')).rows,
    );
    assert.equal(states.includes('evil.example'), false);
  } else assert.ok(badTarget.status >= 400);
});

test('mock Google callback creates a durable account, repeat sign-in reuses it, and access tokens are encrypted', async (t) => {
  const { auth, store, google } = await setup(t);
  const profile = { sub: 'first-google-user', email: 'first@example.org', email_verified: true };
  const first = await google(profile);
  const second = await google(profile);
  assert.equal(first.session.user.id, second.session.user.id);
  assert.equal((await store.query('SELECT id FROM community.auth_user')).rows.length, 1);
  const accounts = await store.query<{
    access_token: string;
    refresh_token: string | null;
    provider_id: string;
  }>('SELECT access_token, refresh_token, provider_id FROM community.auth_account');
  assert.equal(accounts.rows.length, 1);
  assert.equal(accounts.rows[0]!.provider_id, 'google');
  assert.ok(accounts.rows[0]!.access_token);
  assert.equal(accounts.rows[0]!.access_token.includes('private-access-token'), false);
  assert.equal(accounts.rows[0]!.refresh_token, null);
  const reopened = await createAuth(store, environment);
  assert.equal(
    (await reopened.api.getSession({ headers: new Headers({ cookie: first.cookie }) }))?.user.id,
    first.session.user.id,
  );
  assert.equal((await community('review', first.cookie)).status, 403);
  assert.equal((await community('session', first.cookie)).status, 200);
  const signedOut = await auth.handler(
    new Request(`${origin}/api/auth/sign-out`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', cookie: first.cookie },
      body: '{}',
    }),
  );
  assert.equal(signedOut.status, 200);
  assert.equal(
    await reopened.api.getSession({ headers: new Headers({ cookie: first.cookie }) }),
    null,
  );
});

test('same verified email links to an existing local account without replacing name, submissions or reviewer grant', async (t) => {
  const { store, email, google } = await setup(t);
  const user = await email('existing@example.org');
  await store.query('INSERT INTO community.reviewers (user_id, granted_by) VALUES ($1, $2)', [
    user.id,
    'test-operator',
  ]);
  const input = submissionInputSchema.parse({
    clientRequestId: randomUUID(),
    kind: 'memory',
    personId: null,
    proposedPersonName: 'Test Person',
    title: 'Existing account memory',
    body: 'A private memory written before using Google to sign in.',
    privateName: 'Private Submission Contact',
    email: user.email,
    anonymous: true,
    permission: true,
  });
  await createDraft(
    input,
    { userId: user.id, email: user.email, reviewer: false },
    randomBytes(48).toString('base64url'),
  );
  const linked = await google({
    sub: 'linked-google-user',
    email: user.email,
    email_verified: true,
    name: 'Different Google Name',
  });
  assert.equal(linked.session.user.id, user.id);
  assert.equal(linked.session.user.name, user.name);
  assert.equal((await store.query('SELECT id FROM community.auth_user')).rows.length, 1);
  assert.equal((await (await community('session', linked.cookie)).json()).reviewer, true);
  const mine = await (await community('mine', linked.cookie)).json();
  assert.equal(mine.submissions.length, 1);
  assert.equal(mine.submissions[0].input.anonymous, true);
  assert.equal(mine.submissions[0].input.displayName, '');
});

test('automatic linking refuses either an unverified Google email or an unverified local account', async (t) => {
  const { store, email, begin, finish } = await setup(t);
  const existing = await email('verified-local@example.org');
  let response = await finish(await begin(), {
    sub: 'unverified-google',
    email: existing.email,
    email_verified: false,
  });
  assert.equal(new URL(response.headers.get('location')!, origin).pathname, '/sign-in');
  assert.equal((await store.query('SELECT id FROM community.auth_account')).rows.length, 0);
  await store.query('UPDATE community.auth_user SET email_verified=false WHERE id=$1', [
    existing.id,
  ]);
  response = await finish(await begin(), {
    sub: 'verified-google',
    email: existing.email,
    email_verified: true,
  });
  assert.equal(new URL(response.headers.get('location')!, origin).pathname, '/sign-in');
  assert.equal((await store.query('SELECT id FROM community.auth_account')).rows.length, 0);
});

test('cancelled, missing, mismatched and replayed OAuth state cannot create another session', async (t) => {
  const { auth, store, begin, finish } = await setup(t);
  const cancelled = await begin({
    callbackURL: '/submissions/abc-123',
    errorCallbackURL: '/sign-in?next=%2Fsubmissions%2Fabc-123',
  });
  const response = await auth.handler(
    new Request(
      `${origin}/api/auth/callback/google?${new URLSearchParams({ state: cancelled.state, error: 'access_denied' })}`,
      { headers: { cookie: cancelled.cookie } },
    ),
  );
  const target = new URL(response.headers.get('location')!, origin);
  assert.equal(target.pathname, '/sign-in');
  assert.equal(target.searchParams.get('error'), 'access_denied');
  assert.equal(target.searchParams.get('next'), '/submissions/abc-123');
  const missing = await auth.handler(
    new Request(`${origin}/api/auth/callback/google?code=unknown`),
  );
  assert.equal(new URL(missing.headers.get('location')!, origin).pathname, '/sign-in');
  const mismatched = await finish(
    await begin(),
    { sub: 'wrong-cookie', email: 'wrong@example.org', email_verified: true },
    '',
  );
  assert.equal(new URL(mismatched.headers.get('location')!, origin).pathname, '/sign-in');
  assert.equal((await store.query('SELECT id FROM community.auth_session')).rows.length, 0);
  const failedExchange = await begin();
  const invalidCode = await auth.handler(
    new Request(
      `${origin}/api/auth/callback/google?${new URLSearchParams({ state: failedExchange.state, code: 'unrecognized-code' })}`,
      { headers: { cookie: failedExchange.cookie } },
    ),
  );
  assert.equal(new URL(invalidCode.headers.get('location')!, origin).pathname, '/sign-in');
  assert.equal((await store.query('SELECT id FROM community.auth_session')).rows.length, 0);
  const valid = await begin();
  const profile = { sub: 'replay-user', email: 'replay@example.org', email_verified: true };
  assert.equal(
    new URL((await finish(valid, profile)).headers.get('location')!, origin).pathname,
    '/my-contributions',
  );
  const replayed = await finish(valid, profile);
  assert.equal(new URL(replayed.headers.get('location')!, origin).pathname, '/sign-in');
  assert.equal((await store.query('SELECT id FROM community.auth_session')).rows.length, 1);
});

test('Google guest-claim still requires the receipt plus matching email and publication retains anonymity', async (t) => {
  const { store, google } = await setup(t);
  const receipt = randomBytes(48).toString('base64url');
  const input = submissionInputSchema.parse({
    clientRequestId: randomUUID(),
    kind: 'memory',
    personId: null,
    proposedPersonName: 'Community Test Person',
    title: 'An anonymous community memory',
    body: 'A privately provided family memory with no outside source.',
    privateName: 'Private Family Contact',
    email: 'owner@example.org',
    anonymous: true,
    permission: true,
  });
  const draft = await createDraft(input, { userId: null, email: null, reviewer: false }, receipt);
  const owner = await google({ sub: 'owner-google', email: input.email, email_verified: true });
  const other = await google({
    sub: 'other-google',
    email: 'other@example.org',
    email_verified: true,
  });
  const claimPath = `submissions/${draft.submission.id}/claim`;
  assert.equal((await community(claimPath, undefined, receipt, 'POST')).status, 403);
  assert.equal((await community(claimPath, owner.cookie, undefined, 'POST')).status, 403);
  assert.equal((await community(claimPath, other.cookie, receipt, 'POST')).status, 403);
  assert.equal((await community(claimPath, owner.cookie, receipt, 'POST')).status, 200);
  assert.equal((await community('review', owner.cookie)).status, 403);
  const ownerActor = { userId: owner.session.user.id, email: input.email, reviewer: false };
  await finalizeSubmission(draft.submission.id, ownerActor);
  await store.query('INSERT INTO community.reviewers (user_id, granted_by) VALUES ($1, $2)', [
    other.session.user.id,
    'test-operator',
  ]);
  const published = await reviewSubmission(
    draft.submission.id,
    {
      action: 'publish',
      applyTo: 'entry',
      newPersonName: 'Community Test Person',
    },
    { userId: other.session.user.id, email: other.session.user.email, reviewer: true },
  );
  const publicEntry = await getPublicContribution(published.entryId!);
  assert.ok(publicEntry);
  const publicJSON = JSON.stringify(await getArchive());
  assert.match(publicJSON, /Anonymous contributor/);
  for (const secret of [
    input.privateName,
    input.email,
    receipt,
    owner.session.user.name,
    'private-account-photo',
    'private-access-token',
  ])
    assert.equal(publicJSON.includes(secret), false);
});
