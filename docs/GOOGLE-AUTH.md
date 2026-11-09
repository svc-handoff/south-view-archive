# Google sign-in configuration

Google sign-in is the only account sign-in, alongside guest submissions with private receipts. Google uses only `openid email profile` with `online` access to establish a local account and session. The application sends no email.

The button uses [Google's officially pre-approved assets](https://developers.google.com/identity/branding-guidelines): a light rectangular button with the current gradient G and official lettering. The unmodified 4× PNG is hosted with the application and displayed at its original aspect ratio, 216×48 pixels. Keyboard focus, disabled state, and a separate loading indicator are provided. It still calls the Better Auth redirect flow; Google One Tap and the Google Identity Services SDK have not been added. No external font or script is needed to display it. The button remains hidden when OAuth configuration is incomplete.

**The recorded setup has no real Google Cloud OAuth client or credentials and has not completed live authorization/callback acceptance testing.** Implementation and tests using mocked external responses establish code behavior only. The following steps are instructions for an authorized operator, not a record of completed cloud configuration.

## Create a dedicated Web application client

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or create the project for this application. In **Google Auth Platform**, complete initial setup and **Branding** with the actual application name, support email, and developer contact email. Do not reuse another application's credentials or branding.
2. Choose the appropriate **Audience**. A public cemetery archive uses **External**; **Internal** is limited to members of the corresponding Google Cloud organization. Development can initially use **Testing**. The test-user exception is explained below.
3. In **Data Access**, retain only the basic sign-in scopes used here: `openid`, `email`, and `profile`. The console may display the latter two as full `userinfo.email` and `userinfo.profile` URIs. The application does not need offline access or additional Google data scopes. See [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect#sendauthrequest).
4. Under **Clients → Create client**, choose **Web application**, create a dedicated OAuth client, and register the full addresses below under **Authorized redirect URIs**. Store the client ID and secret in private configuration. Do not share them in chat or screenshots or commit them to Git. See [Google's client setup instructions](https://support.google.com/cloud/answer/15549257).

| Environment               | Authorized redirect URI                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| Current local development | `http://127.0.0.1:3000/api/auth/callback/google`                           |
| Production                | The actual HTTPS `BETTER_AUTH_URL` followed by `/api/auth/callback/google` |

`BETTER_AUTH_URL` is the site origin without a path. The callback must exactly match the registered address, including protocol, host, port, path, and trailing slash; otherwise Google returns `redirect_uri_mismatch`. Local loopback addresses can use HTTP; production uses HTTPS. Open the website at the same origin in the browser, without mixing `localhost` and `127.0.0.1`. See [Google's redirect matching rules](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred).

This application uses a server-side redirect flow, so the callback belongs in **Authorized redirect URIs**. **Authorized JavaScript origins** are for client-side Google API use and do not replace the callback. An origin field must not include `/api/auth/callback/google`. Better Auth derives the callback from its configured base URL; see the [Google provider documentation](https://better-auth.com/docs/authentication/google).

## Local and production environment variables

For local development, enter actual values only in the Git-ignored `apps/nextjs/.env.local`, then restart the server:

```dotenv
BETTER_AUTH_URL=http://127.0.0.1:3000
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000
GOOGLE_CLIENT_ID=YOUR_WEB_APPLICATION_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET
```

Replace the placeholders with valid credentials. Both variables are read on the server and must not use the `NEXT_PUBLIC_` prefix. The client ID is sent to Google as part of the OAuth request; the secret is used only for the server-side exchange. If either value is missing, Google sign-in is unavailable while guest submissions continue.

For production, put these settings in the deployment platform and configure the actual HTTPS `BETTER_AUTH_URL`, matching `NEXT_PUBLIC_SITE_URL`, and a random `BETTER_AUTH_SECRET` of at least 32 bytes. Database and private-photo settings follow the [README](../README.md). No email is sent in any environment. Enable `TRUST_PROXY=1` only when a trusted reverse proxy overwrites externally supplied forwarding headers.

Open sign-in on the standalone site. From an iframe, use the contribution/sign-in links that open a new tab. Do not register the parent website or iframe page as the Google callback.

## Testing and public release

Google's general **Testing** rules allow up to 100 designated test users and usually expire authorizations after seven days. Its documented exception covers sign-in requesting **only `openid`, email, and basic profile information**: users need not be listed as test users, and the testing warning and seven-day expiry do not apply. This application's scopes fall within that exception. Testing mode is therefore not an access-control mechanism for this site. If additional scopes are added later, reassess the requirements and register accounts under **Audience → Test users** where required. Google Workspace administrator policies can still restrict individual accounts. See [Google's Audience and Testing rules](https://support.google.com/cloud/answer/15549945).

Before public release, check the audience and use **Publish app** to change its status to **In production**. This is separate from **Branding** verification and **Publish branding**. Supply a real homepage, privacy policy, terms of service, and authorized domains as requested by the console. Displaying the application name/logo may require brand verification. Basic sign-in scopes do not imply completed brand verification; future sensitive or restricted scopes may require additional data-access verification. This repository does not perform those console steps or supply an operating privacy policy or dedicated production domain. See [Google's branding and verification requirements](https://support.google.com/cloud/answer/15549049).

## Accounts, receipts, and reviewers

Google accounts link to local accounts through their provider account identifier. An existing local account can be linked only when **the local and Google email addresses match and both are verified**. Names, similar addresses, and email domains never trigger automatic merges. Google's verified-email state comes from `email_verified`; its stable provider identity is `sub`. See [Google ID token fields](https://developers.google.com/identity/openid-connect/openid-connect#an-id-tokens-payload).

Sign-in does not automatically claim earlier guest submissions. Claiming still requires the original private receipt and a verified email matching the submission contact. A submission already owned by another account cannot be reclaimed. Ordinary Google accounts do not automatically gain reviewer privileges.

The reviewer first signs in with a verified email. An operator then runs `pnpm reviewer:grant --email reviewer@example.org --confirm`, substituting the actual address. Stop the development server before local PGlite operations. The CLI reads the repository-root `.env.local`/`.env` and must point to the same database as the website. Restart afterward. See [community data and review](./COMMUNITY-DATA.md).

## Acceptance checks after actual configuration

The following live checks remain outstanding in the recorded setup; mocked tests must not be reported as substitutes:

- Start Google sign-in from the exact local origin, verify that only basic identity scopes are requested, and confirm a local session on return.
- Cancel authorization and test a callback configuration error; errors should be recoverable, with guest submissions still independently usable.
- Matching, mutually verified emails link to one account. Mismatched or unverified emails cannot merge accounts this way.
- Ordinary users lack reviewer access, and Google users still need the original receipt to claim guest submissions.
- Repeat callback, session, sign-out, and allowed in-site return checks at the production HTTPS origin. Verify Google Console publication/branding state separately.

Actual automated and browser results are recorded in [VALIDATION.md](./VALIDATION.md). The official references above were checked on 2026-10-03; translating this document does not constitute a new provider-policy review.
