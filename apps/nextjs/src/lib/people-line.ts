import { displayPersonName } from './person-name';

/**
 * The people connected to a place, as one short line for a hover card: the first few names,
 * then a count of the rest. A place is never bound to one person; a crypt or a church can
 * carry many, and the card must stay one line tall.
 */
export function peopleLine(names: string[], max = 3): string {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const shown = unique.slice(0, max).map(displayPersonName);
  const rest = unique.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} +${rest} more` : shown.join(', ');
}
