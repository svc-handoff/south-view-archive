/** Keep a generational suffix with the surname when a display name wraps. */
export function displayPersonName(name: string) {
  return name.replace(/\s+(?=(?:Sr\.|Jr\.|II|III|IV)$)/, '\u00a0');
}
