// Counts the files in the private Vercel Blob store by folder (read-only). Prints no secrets.
//   npx tsx packages/services/script/list-blob.ts --env <file with BLOB_READ_WRITE_TOKEN>
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { list } from '@vercel/blob';

const flag = process.argv.indexOf('--env');
if (flag > 0) loadEnvFile(resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[flag + 1]!));
const counts = new Map<string, number>();
let cursor: string | undefined;
do {
  const page = await list({ cursor, limit: 1000, token: process.env.BLOB_READ_WRITE_TOKEN });
  for (const blob of page.blobs) {
    const folder = blob.pathname.split('/')[0] ?? '';
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);
for (const [folder, n] of [...counts].sort()) console.log(`${folder}/ ${n}`);
if (!counts.size) console.log('The store is empty.');
