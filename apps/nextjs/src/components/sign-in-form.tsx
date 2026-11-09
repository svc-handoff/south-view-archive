'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, LoaderCircle, ShieldCheck } from 'lucide-react';
import { communityRequest, safeCommunityNext, type CommunitySession } from '@/lib/community-client';
import { copy } from '@/lib/copy';
import { CommunityNotice } from './community-shell';
import styles from './google-sign-in-button.module.css';

export function SignInForm({
  next,
  authError,
}: {
  next?: string;
  authError?: 'cancelled' | 'failed';
}) {
  const [session, setSession] = useState<CommunitySession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [isFramed, setIsFramed] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    authError === 'cancelled'
      ? 'Google sign-in was cancelled. You can try again or continue as a guest.'
      : authError
        ? 'Google sign-in could not be completed. Please try again or continue as a guest.'
        : '',
  );
  const destination = safeCommunityNext(next);
  const guestDestination =
    destination.startsWith('/contribute') || destination.startsWith('/submissions/')
      ? destination
      : '/contribute';
  const googleAvailable = session?.signInMethods?.google ?? false;
  const guestAction = (
    <Link
      className="community-secondary sign-in-guest"
      href={guestDestination}
      target={isFramed ? '_blank' : undefined}
      rel={isFramed ? 'noopener noreferrer' : undefined}
    >
      <span>
        {session?.user
          ? guestDestination.startsWith('/submissions/')
            ? 'Back to your contribution'
            : copy.share
          : 'Continue as a guest'}
      </span>
      <ArrowRight size={17} aria-hidden="true" />
      {isFramed && <span className="sr-only"> (opens in a new tab)</span>}
    </Link>
  );

  const loadSession = useCallback(async () => {
    setLoadingSession(true);
    setSessionError('');
    try {
      setSession(await communityRequest<CommunitySession>('/session'));
    } catch {
      setSessionError('Sign-in options could not be loaded. Please try again.');
    } finally {
      setLoadingSession(false);
    }
  }, []);
  useEffect(() => {
    if (window.self !== window.top) {
      setIsFramed(true);
      setLoadingSession(false);
      return;
    }
    void loadSession();
  }, [loadSession]);

  async function startGoogle() {
    if (isFramed || !googleAvailable || busy) return;
    setError('');
    setBusy(true);
    let leaving = false;
    try {
      const response = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          callbackURL: destination,
          errorCallbackURL: `/sign-in?next=${encodeURIComponent(destination)}`,
        }),
        credentials: 'same-origin',
      });
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== 'object' || !('url' in result))
        throw new Error();
      if (typeof result.url !== 'string') throw new Error();
      const redirect = new URL(result.url);
      if (
        redirect.protocol !== 'https:' ||
        redirect.hostname !== 'accounts.google.com' ||
        redirect.username ||
        redirect.password ||
        redirect.port
      )
        throw new Error();
      // A same-tab navigation retains private receipt tokens already in sessionStorage.
      window.location.assign(redirect.href);
      leaving = true;
    } catch {
      setError('Google sign-in could not be started. Please try again or continue as a guest.');
    } finally {
      if (!leaving) setBusy(false);
    }
  }

  return (
    <>
      {isFramed ? (
        <CommunityNotice title="Continue in the full archive">
          <p>Open sign-in in a new tab to securely access your account.</p>
          <div className="community-actions">
            <Link
              className="community-primary"
              href={`/sign-in?next=${encodeURIComponent(destination)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open sign-in in a new tab <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </CommunityNotice>
      ) : loadingSession ? (
        <div className="community-loading" role="status">
          <LoaderCircle className="community-spinner" size={22} aria-hidden="true" /> Checking
          sign-in options…
        </div>
      ) : session?.user ? (
        <>
          <CommunityNotice kind="success" title="You are signed in">
            {session.user.email}
          </CommunityNotice>
          <Link className="community-primary" href={destination}>
            Continue <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </>
      ) : (
        <>
          {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
          {sessionError && (
            <>
              <CommunityNotice kind="error">{sessionError}</CommunityNotice>
              <button
                className="community-secondary"
                type="button"
                onClick={() => {
                  void loadSession();
                }}
              >
                Reload sign-in options
              </button>
            </>
          )}
          <div className="sign-in-choices" role="group" aria-label="Choose how to continue">
            {googleAvailable && (
              <button
                className={styles.button}
                type="button"
                onClick={() => {
                  void startGoogle();
                }}
                disabled={busy}
                aria-busy={busy}
                aria-label="Sign in with Google"
              >
                {/* Google's unmodified, pre-approved 4× artwork; scale both axes equally. */}
                <img
                  src="/images/google-sign-in-light.png"
                  width={216}
                  height={48}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                />
              </button>
            )}
            {guestAction}
            {busy && (
              <span className={styles.status} role="status">
                <LoaderCircle size={18} className="community-spinner" aria-hidden="true" />
                Opening Google…
              </span>
            )}
          </div>
          {session && !googleAvailable && (
            <CommunityNotice title="Account sign-in is not configured">
              You can still {copy.share.toLowerCase()} as a guest. Keep the private receipt link
              shown after you send it.
            </CommunityNotice>
          )}
        </>
      )}
      {(isFramed || loadingSession || session?.user) && (
        <div className="sign-in-choices">{guestAction}</div>
      )}
      {!session?.user && (
        <div className="community-aside-card">
          <ShieldCheck size={28} strokeWidth={1.3} aria-hidden="true" />
          <h2>A place for the stories you share.</h2>
          <p>
            Sign in with Google to keep your contributions together, or continue as a guest. The
            archive never sends email; your account name and email stay private, and each
            contribution has its own public credit.
          </p>
        </div>
      )}
    </>
  );
}
