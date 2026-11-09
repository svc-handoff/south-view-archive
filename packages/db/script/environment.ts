import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

// Existing process variables win. Local overrides load before the root defaults.
// These scripts deliberately do not read apps/nextjs/.env.local.
for (const name of ['.env.local', '.env']) {
  const rootEnvironment = fileURLToPath(new URL(`../../../${name}`, import.meta.url));
  if (existsSync(rootEnvironment)) loadEnvFile(rootEnvironment);
}

export function migrationDatabaseUrl() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url)
    throw new Error(
      'Set MIGRATION_DATABASE_URL explicitly; scripts never reuse the application connection implicitly.',
    );
  return url;
}
