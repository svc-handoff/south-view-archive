import { isDeepStrictEqual } from 'node:util';

/**
 * Undoes one recorded write on a record that may have changed since.
 *
 * `previous` is the record before the write, `written` what the write stored, and `current`
 * what is stored now. Every part of `current` that still holds what this write put there goes
 * back to `previous`; every part a later edit has changed keeps the later value. Objects are
 * merged key by key. Lists are merged item by item: items with an `id` are matched by it, other
 * items by value, and an item that replaced another (a corrected paragraph) puts the original
 * back in its place. `undefined` means the key is absent.
 */
export function revertChange(previous: unknown, written: unknown, current: unknown): unknown {
  if (isDeepStrictEqual(current, written)) return previous;
  if (isDeepStrictEqual(previous, written)) return current;
  if (Array.isArray(previous) && Array.isArray(written) && Array.isArray(current))
    return revertList(previous, written, current);
  if (isRecord(previous) && isRecord(written) && isRecord(current)) {
    const result: Record<string, unknown> = { ...current };
    for (const key of new Set([...Object.keys(previous), ...Object.keys(written)])) {
      const value = revertChange(previous[key], written[key], current[key]);
      if (value === undefined) delete result[key];
      else result[key] = value;
    }
    return result;
  }
  // A later edit replaced this value: keep it.
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

function keyOf(item: unknown) {
  return isRecord(item) && typeof item.id === 'string'
    ? `id:${item.id}`
    : `value:${canonical(item)}`;
}

/** The nearest earlier key in `keys` that both versions share, or '^' for the start of the list. */
function anchorOf(keys: string[], index: number, shared: Set<string>) {
  for (let i = index - 1; i >= 0; i--) if (shared.has(keys[i]!)) return keys[i]!;
  return '^';
}

function revertList(previous: unknown[], written: unknown[], current: unknown[]): unknown[] {
  const previousKeys = previous.map(keyOf);
  const writtenKeys = written.map(keyOf);
  const previousByKey = new Map(previous.map((item, i) => [previousKeys[i]!, item]));
  const writtenByKey = new Map(written.map((item, i) => [writtenKeys[i]!, item]));
  const shared = new Set(previousKeys.filter((key) => writtenByKey.has(key)));
  const removed = previousKeys.filter((key) => !writtenByKey.has(key));
  const added = writtenKeys.filter((key) => !previousByKey.has(key));

  // An added item that sits where a removed one sat replaced it.
  const replaced = new Map<string, string>();
  const paired = new Set<string>();
  for (const key of added) {
    const anchor = anchorOf(writtenKeys, writtenKeys.indexOf(key), shared);
    const original = removed.find(
      (candidate) =>
        !paired.has(candidate) &&
        anchorOf(previousKeys, previousKeys.indexOf(candidate), shared) === anchor,
    );
    if (original) {
      replaced.set(key, original);
      paired.add(original);
    }
  }

  const currentKeys = new Set(current.map(keyOf));
  const keepRemoved = new Set<string>();
  const result: unknown[] = [];
  for (const item of current) {
    const key = keyOf(item);
    if (writtenByKey.has(key) && !previousByKey.has(key)) {
      const original = replaced.get(key);
      if (!isDeepStrictEqual(item, writtenByKey.get(key))) {
        // Edited again later: the later version stays, and the item it replaced stays gone.
        result.push(item);
        if (original) keepRemoved.add(original);
        continue;
      }
      if (original && !currentKeys.has(original)) {
        result.push(previousByKey.get(original));
        keepRemoved.add(original);
      }
      continue;
    }
    if (previousByKey.has(key) && writtenByKey.has(key)) {
      result.push(revertChange(previousByKey.get(key), writtenByKey.get(key), item));
      continue;
    }
    result.push(item);
  }
  // Put back what this write removed, after the nearest earlier item that is still there.
  for (const key of removed) {
    if (keepRemoved.has(key) || result.some((item) => keyOf(item) === key)) continue;
    let position = 0;
    for (let i = previousKeys.indexOf(key) - 1; i >= 0; i--) {
      const at = result.findIndex((item) => keyOf(item) === previousKeys[i]);
      if (at >= 0) {
        position = at + 1;
        break;
      }
    }
    result.splice(position, 0, previousByKey.get(key));
  }
  return result;
}
