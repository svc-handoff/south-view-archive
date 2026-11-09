import { randomUUID } from 'node:crypto';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { getStore, type Store } from '@southview/db/connection';
import { safeCommunityNext, safeSignInErrorCallback } from '@southview/validators';
import { betterAuth } from 'better-auth/minimal';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import * as authSchema from './auth-schema';
import {
  assertServer,
  authBaseURL,
  authConfigurationAvailable,
  authSecret,
  type Environment,
} from './config';

export type SignInMethods = { google: boolean };
const reportedGoogleConfigurationIssues = new Set<'incomplete' | 'invalid'>();

/** Status contains no credentials and is safe for operational diagnostics. */
export function getGoogleConfigurationStatus(environment: Environment = process.env) {
  const clientId = environment.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = environment.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return 'unconfigured';
  if (!clientId || !clientSecret) return 'incomplete';
  if (/\s/.test(clientId) || /\s/.test(clientSecret)) return 'invalid';
  return 'configured';
}

/** Google is the only account sign-in. The archive sends no email of any kind. */
export function getSignInMethods(environment: Environment = process.env): SignInMethods {
  if (environment.ARCHIVE_DATA_MODE === 'fixture') return { google: false };
  const googleStatus = getGoogleConfigurationStatus(environment);
  if (
    (googleStatus === 'incomplete' || googleStatus === 'invalid') &&
    !reportedGoogleConfigurationIssues.has(googleStatus)
  ) {
    reportedGoogleConfigurationIssues.add(googleStatus);
    console.warn(
      'Google sign-in is disabled: configure both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET with valid values.',
    );
  }
  return { google: googleStatus === 'configured' && authConfigurationAvailable(environment) };
}

/** The environment parameter exists for isolated integration tests, never HTTP input. */
export async function createAuth(store: Store, environment: Environment = process.env) {
  assertServer();
  const baseURL = authBaseURL(environment);
  const signInMethods = getSignInMethods(environment);
  return betterAuth({
    appName: 'South-View',
    baseURL,
    basePath: '/api/auth',
    secret: await authSecret(environment),
    trustedOrigins: [baseURL],
    database: drizzleAdapter(store.orm, { provider: 'pg', schema: authSchema }),
    emailAndPassword: { enabled: false },
    socialProviders: signInMethods.google
      ? {
          google: {
            clientId: environment.GOOGLE_CLIENT_ID!.trim(),
            clientSecret: environment.GOOGLE_CLIENT_SECRET!.trim(),
            accessType: 'online',
            includeGrantedScopes: false,
            overrideUserInfoOnSignIn: false,
          },
        }
      : {},
    account: {
      encryptOAuthTokens: true,
      storeStateStrategy: 'database',
      skipStateCookieCheck: false,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: false,
        requireLocalEmailVerified: true,
        trustedProviders: [],
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
        updateUserInfoOnLink: false,
      },
    },
    onAPIError: { errorURL: new URL(safeSignInErrorCallback(undefined), baseURL).href },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: { '/sign-in/social': { window: 60, max: 10 } },
    },
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      cookiePrefix: 'southview',
      database: { generateId: () => randomUUID() },
      useSecureCookies: baseURL.startsWith('https:'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      // A direct client must not evade throttling by inventing a forwarded IP.
      // Without a configured trusted proxy, Better Auth uses one shared bucket.
      ipAddress: { ipAddressHeaders: environment.TRUST_PROXY === '1' ? ['x-forwarded-for'] : [] },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path === '/link-social')
          throw new APIError('BAD_REQUEST', {
            message: 'Manual account linking is unavailable.',
          });
        if (context.path === '/sign-in/social') {
          // First-login requests have no session cookie, so explicitly enforce the
          // browser origin here as well as Better Auth's cookie/state protections.
          if (context.request && context.request.headers.get('origin') !== baseURL)
            throw new APIError('FORBIDDEN', {
              message: 'Sign-in must be started from this archive.',
            });
          if (context.body?.provider !== 'google' || !signInMethods.google)
            throw new APIError('SERVICE_UNAVAILABLE', {
              message: 'Google sign-in is unavailable. Please try another sign-in method.',
            });
          // The archive only uses the redirect flow with basic profile scopes. Never
          // let caller options expand consent or attach private receipt data to state.
          if (
            ['idToken', 'scopes', 'additionalParams', 'additionalData'].some(
              (key) => context.body?.[key] !== undefined,
            )
          )
            throw new APIError('BAD_REQUEST', {
              message: 'These Google sign-in options are unavailable.',
            });
          const callback = safeCommunityNext(context.body?.callbackURL, baseURL);
          const newUserCallback = context.body?.newUserCallbackURL
            ? safeCommunityNext(context.body.newUserCallbackURL, baseURL)
            : callback;
          const errorCallback = safeSignInErrorCallback(
            context.body?.errorCallbackURL ?? `/sign-in?next=${encodeURIComponent(callback)}`,
            baseURL,
          );
          return {
            context: {
              body: {
                ...context.body,
                callbackURL: new URL(callback, baseURL).href,
                newUserCallbackURL: new URL(newUserCallback, baseURL).href,
                errorCallbackURL: new URL(errorCallback, baseURL).href,
              },
            },
          };
        }
      }),
    },
    // Never log request bodies, email addresses, database URLs, or OAuth credentials.
    logger: { disabled: true },
  });
}

type Auth = Awaited<ReturnType<typeof createAuth>>;
const globalAuth = globalThis as typeof globalThis & {
  __southViewAuth?: { store: Store; auth: Promise<Auth> };
};

export async function getAuth(): Promise<Auth> {
  const store = await getStore();
  if (!globalAuth.__southViewAuth || globalAuth.__southViewAuth.store !== store) {
    const auth = createAuth(store);
    globalAuth.__southViewAuth = { store, auth };
    auth.catch(() => {
      if (globalAuth.__southViewAuth?.auth === auth) delete globalAuth.__southViewAuth;
    });
  }
  return globalAuth.__southViewAuth.auth;
}

export async function getSession(headers: Headers) {
  if (!headers.get('cookie')?.includes('southview.session_token')) return null;
  return (await getAuth()).api.getSession({ headers });
}

export async function isReviewer(userId: string) {
  if (!userId) return false;
  const store = await getStore();
  const result = await store.query('SELECT user_id FROM community.reviewers WHERE user_id = $1', [
    userId,
  ]);
  return result.rows.length > 0;
}
