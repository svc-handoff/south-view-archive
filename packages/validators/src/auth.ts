const fallbackDestination = '/my-contributions';
const localOrigin = 'https://archive.invalid';

function localTarget(value: string | null | undefined, baseURL?: string) {
  if (!value || value.length > 2048 || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  if (!baseURL && !value.startsWith('/')) return null;
  try {
    const origin = new URL(baseURL ?? localOrigin).origin;
    const url = new URL(value, origin);
    return url.origin === origin && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/** Shared by browser navigation and server OAuth state; never retain receipt fragments. */
export function safeCommunityNext(value: string | null | undefined, baseURL?: string) {
  const url = localTarget(value, baseURL);
  if (
    !url ||
    !/^\/(?:my-contributions|contribute|admin\/contributions|admin\/(?:people|places)(?:\/[a-zA-Z0-9-]+)?|submissions\/[a-zA-Z0-9-]+)$/.test(
      url.pathname,
    )
  )
    return fallbackDestination;
  const person = url.pathname === '/contribute' ? url.searchParams.get('person') : null;
  return `${url.pathname}${person ? `?person=${encodeURIComponent(person)}` : ''}`;
}

/** Better Auth appends its own error code; caller-provided messages and secrets are removed. */
export function safeSignInErrorCallback(value: string | null | undefined, baseURL?: string) {
  const url = localTarget(value, baseURL);
  const next = safeCommunityNext(
    url?.pathname === '/sign-in' ? url.searchParams.get('next') : null,
    baseURL,
  );
  return `/sign-in?next=${encodeURIComponent(next)}`;
}
