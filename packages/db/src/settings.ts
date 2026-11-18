import {
  aiSettingsInputSchema,
  siteStatusInputSchema,
  type Actor,
  type SettingsView,
  type SiteStatus,
} from '@southview/validators';
import { getStore } from './connection';
import { requireReviewer, writableStore } from './community';

/** Where AI review sends requests when staff have not set one. */
export const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1';

type Row = { value: Record<string, unknown>; updated_by: string | null; updated_at: Date | string };
type AiStored = { apiKey?: string; baseURL?: string; model?: string };

async function readSetting(key: string): Promise<Row | null> {
  const store = await getStore();
  return (
    (
      await store.query<Row>(
        'SELECT value, updated_by, updated_at FROM community.site_settings WHERE key = $1',
        [key],
      )
    ).rows[0] ?? null
  );
}
async function writeSetting(key: string, value: Record<string, unknown>, actor: Actor) {
  const store = await writableStore();
  await store.query(
    `INSERT INTO community.site_settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), actor.email ?? actor.userId],
  );
}
const iso = (value: Date | string | undefined) =>
  value === undefined ? null : new Date(value).toISOString();

/**
 * The AI review connection: what staff saved in the admin, else the server's environment, else
 * the defaults. Server use only; the result includes the key.
 */
export async function getAiConnection(defaultModel: string) {
  let stored: AiStored = {};
  if (process.env.ARCHIVE_DATA_MODE !== 'fixture') {
    try {
      stored = ((await readSetting('ai'))?.value ?? {}) as AiStored;
    } catch {
      // Before the settings migration runs, fall back to the environment.
    }
  }
  return {
    apiKey: stored.apiKey || process.env.OPENAI_API_KEY?.trim() || '',
    baseURL: stored.baseURL || process.env.OPENAI_BASE_URL?.trim() || DEFAULT_AI_BASE_URL,
    model: stored.model || process.env.OPENAI_MODEL?.trim() || defaultModel,
  };
}

let siteCache: { at: number; status: SiteStatus } | null = null;
/**
 * Whether the public site is taken down. Read on every page and public request, so it is kept
 * for a few seconds per server instance; any failure to read counts as online.
 */
export async function getSiteStatus(): Promise<SiteStatus> {
  if (process.env.ARCHIVE_DATA_MODE === 'fixture') return { offline: false, message: '' };
  if (siteCache && Date.now() - siteCache.at < 5000) return siteCache.status;
  let status: SiteStatus = { offline: false, message: '' };
  try {
    const value = (await readSetting('site'))?.value;
    if (value) status = { offline: value.offline === true, message: String(value.message ?? '') };
  } catch {
    // Missing table or a passing database error: keep the site up.
  }
  siteCache = { at: Date.now(), status };
  return status;
}

export async function getSettingsView(actor: Actor, defaultModel: string): Promise<SettingsView> {
  requireReviewer(actor);
  const [ai, site] = await Promise.all([readSetting('ai'), readSetting('site')]);
  const stored = (ai?.value ?? {}) as AiStored;
  const serverKey = !!process.env.OPENAI_API_KEY?.trim();
  return {
    ai: {
      baseURL: stored.baseURL ?? '',
      model: stored.model ?? '',
      keySource: stored.apiKey ? 'admin' : serverKey ? 'server' : 'none',
      keyHint: stored.apiKey ? `…${stored.apiKey.slice(-4)}` : null,
      defaultBaseURL: process.env.OPENAI_BASE_URL?.trim() || DEFAULT_AI_BASE_URL,
      defaultModel: process.env.OPENAI_MODEL?.trim() || defaultModel,
      updatedBy: ai?.updated_by ?? null,
      updatedAt: iso(ai?.updated_at),
    },
    site: {
      offline: site?.value.offline === true,
      message: String(site?.value.message ?? ''),
      updatedBy: site?.updated_by ?? null,
      updatedAt: iso(site?.updated_at),
    },
  };
}

export async function saveAiSettings(raw: unknown, actor: Actor) {
  requireReviewer(actor);
  const input = aiSettingsInputSchema.parse(raw);
  const current = ((await readSetting('ai'))?.value ?? {}) as AiStored;
  const apiKey = input.apiKey === undefined ? current.apiKey : input.apiKey;
  await writeSetting(
    'ai',
    {
      ...(apiKey ? { apiKey } : {}),
      ...(input.baseURL ? { baseURL: input.baseURL.replace(/\/+$/, '') } : {}),
      ...(input.model ? { model: input.model } : {}),
    },
    actor,
  );
}

export async function saveSiteStatus(raw: unknown, actor: Actor) {
  requireReviewer(actor);
  const input = siteStatusInputSchema.parse(raw);
  await writeSetting('site', input, actor);
  siteCache = { at: Date.now(), status: input };
}
