/** Return links point back into the map only; any other value falls back to /explore. */
export function safeArchiveReturn(value: unknown, fallback = '/explore') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 2000) return fallback;
  try {
    const url = new URL(value, 'https://archive.invalid');
    if (url.origin !== 'https://archive.invalid' || url.pathname !== '/explore') return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

/** Appends the current return target so record links can lead back to the same map view. */
export function withArchiveReturn(path: string, returnTo: string) {
  const [base, hash = ''] = path.split('#');
  const url = new URL(base!, 'https://archive.invalid');
  url.searchParams.set('from', safeArchiveReturn(returnTo));
  return `${url.pathname}${url.search}${hash ? `#${hash}` : ''}`;
}
