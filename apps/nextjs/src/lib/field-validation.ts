export type FieldIssue = { path: readonly PropertyKey[]; message: string };

/** Match schema paths to rendered fields, retaining the identity of filtered photographs. */
export function mapFieldIssues(
  issues: readonly FieldIssue[],
  fields: readonly string[],
  photoIds: readonly string[] = [],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.map(String);
    if (path[0] === 'photoEdits' && photoIds[Number(path[1])]) path[1] = photoIds[Number(path[1])]!;
    let key = path.join('.');
    while (!fields.includes(key) && key.includes('.')) key = key.slice(0, key.lastIndexOf('.'));
    if (!fields.includes(key)) key = 'form';
    errors[key] ??= issue.message;
  }
  return errors;
}
