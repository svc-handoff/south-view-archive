import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { projectRoot } from '@southview/db/connection';

export type Environment = Record<string, string | undefined>;

export function assertServer() {
  if (typeof window !== 'undefined')
    throw new Error('This service is available only on the server.');
}

export function privateDataDirectory(environment: Environment = process.env) {
  assertServer();
  return resolve(projectRoot(), environment.SOUTHVIEW_DATA_DIR ?? '.southview');
}

export function isLocalEnvironment(environment: Environment = process.env) {
  return environment.NODE_ENV === 'development' || environment.NODE_ENV === 'test';
}

export function authBaseURL(environment: Environment = process.env) {
  const value =
    environment.BETTER_AUTH_URL ??
    environment.NEXT_PUBLIC_SITE_URL ??
    (isLocalEnvironment(environment) ? 'http://127.0.0.1:3000' : undefined);
  if (!value) throw new Error('BETTER_AUTH_URL is required outside development and test.');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('BETTER_AUTH_URL must be a site origin.');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    (!isLocalEnvironment(environment) && url.protocol !== 'https:')
  )
    throw new Error('BETTER_AUTH_URL must use HTTPS outside development and test.');
  return url.origin;
}

/** Readiness check only: it never creates a local secret or opens the database. */
export function authConfigurationAvailable(environment: Environment = process.env) {
  try {
    authBaseURL(environment);
    const secretLength = Buffer.byteLength(environment.BETTER_AUTH_SECRET ?? '');
    if (environment.BETTER_AUTH_SECRET && secretLength < 32) return false;
    return isLocalEnvironment(environment) || secretLength >= 32;
  } catch {
    return false;
  }
}

/** A local secret survives restarts; a deployed server never invents a production secret. */
export async function authSecret(environment: Environment = process.env) {
  assertServer();
  const configured = environment.BETTER_AUTH_SECRET;
  if (configured) {
    if (Buffer.byteLength(configured) < 32)
      throw new Error('BETTER_AUTH_SECRET must contain at least 32 bytes.');
    return configured;
  }
  if (!isLocalEnvironment(environment))
    throw new Error('BETTER_AUTH_SECRET is required outside development and test.');
  const directory = privateDataDirectory(environment);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = join(directory, 'auth-secret');
  try {
    await writeFile(filename, randomBytes(48).toString('base64url'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const persisted = (await readFile(filename, 'utf8')).trim();
  if (Buffer.byteLength(persisted) < 32)
    throw new Error('The local authentication secret is invalid.');
  return persisted;
}
