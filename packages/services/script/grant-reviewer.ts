import { closeStores, getStore } from '@southview/db/connection';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

// Match database scripts: existing process variables win over root local/default files.
for (const name of ['.env.local', '.env']) {
  const filename = fileURLToPath(new URL(`../../../${name}`, import.meta.url));
  if (existsSync(filename)) loadEnvFile(filename);
}

const args = process.argv.slice(2);
const emailIndex = args.indexOf('--email');
const email = emailIndex >= 0 ? args[emailIndex + 1]?.trim().toLowerCase() : undefined;
const revoke = args.includes('--revoke');
try {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !args.includes('--confirm'))
    throw new Error(
      'Usage: pnpm --filter @southview/services grant-reviewer --email person@example.org --confirm [--revoke] [--allow-production]',
    );
  if (process.env.NODE_ENV === 'production' && !args.includes('--allow-production'))
    throw new Error('Production changes require --allow-production.');
  const store = await getStore();
  const result = await store.query<{ id: string }>(
    'SELECT id FROM community.auth_user WHERE lower(email) = $1 AND email_verified = true',
    [email],
  );
  if (result.rows.length !== 1)
    throw new Error('Sign in and verify this email first. No unique verified account was found.');
  if (revoke) {
    await store.query('DELETE FROM community.reviewers WHERE user_id = $1', [result.rows[0]!.id]);
  } else {
    await store.query(
      'INSERT INTO community.reviewers (user_id, granted_by) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
      [result.rows[0]!.id, 'operator-cli'],
    );
  }
  process.stdout.write(revoke ? 'Reviewer access revoked.\n' : 'Reviewer access granted.\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Reviewer update failed.'}\n`);
  process.exitCode = 1;
} finally {
  await closeStores();
}
