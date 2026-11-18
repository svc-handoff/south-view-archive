import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createStore, setStoreForTests } from '../packages/db/src/connection';
import {
  DEFAULT_AI_BASE_URL,
  getAiConnection,
  getSettingsView,
  getSiteStatus,
  saveAiSettings,
  saveSiteStatus,
} from '../packages/db/src/settings';
import { vetConfigured } from '../packages/services/src/vet';

const reviewer = { userId: 'reviewer-1', email: 'staff@example.org', reviewer: true };
const guest = { userId: null, email: null, reviewer: false };

test('site settings: AI connection and kill switch', async (t) => {
  const previous = {
    key: process.env.OPENAI_API_KEY,
    base: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL,
    mode: process.env.ARCHIVE_DATA_MODE,
  };
  process.env.ARCHIVE_DATA_MODE = 'local';
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;
  const directory = await mkdtemp(join(tmpdir(), 'southview-settings-'));
  const store = await createStore({ mode: 'local', path: join(directory, 'db') });
  setStoreForTests(store);
  t.after(async () => {
    setStoreForTests(null);
    await store.close();
    for (const [name, value] of Object.entries({
      OPENAI_API_KEY: previous.key,
      OPENAI_BASE_URL: previous.base,
      OPENAI_MODEL: previous.model,
      ARCHIVE_DATA_MODE: previous.mode,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });

  await t.test('defaults, then the server environment, then the admin', async () => {
    assert.deepEqual(await getAiConnection('default-model'), {
      apiKey: '',
      baseURL: DEFAULT_AI_BASE_URL,
      model: 'default-model',
    });
    assert.equal(await vetConfigured(), false);
    process.env.OPENAI_API_KEY = 'server-key';
    assert.equal((await getAiConnection('m')).apiKey, 'server-key');
    assert.equal((await getSettingsView(reviewer, 'm')).ai.keySource, 'server');
    await saveAiSettings(
      { apiKey: 'sk-admin-1234', baseURL: 'https://example.org/v1/', model: 'gpt-5' },
      reviewer,
    );
    assert.deepEqual(await getAiConnection('m'), {
      apiKey: 'sk-admin-1234',
      baseURL: 'https://example.org/v1',
      model: 'gpt-5',
    });
    assert.equal(await vetConfigured(), true);
  });

  await t.test('the key is never returned, and is kept unless cleared', async () => {
    const view = await getSettingsView(reviewer, 'm');
    assert.equal(view.ai.keySource, 'admin');
    assert.equal(view.ai.keyHint, '…1234');
    assert.ok(!JSON.stringify(view).includes('sk-admin'));
    await saveAiSettings({ baseURL: '', model: 'gpt-5-mini' }, reviewer);
    assert.equal((await getAiConnection('m')).apiKey, 'sk-admin-1234');
    assert.equal((await getAiConnection('m')).baseURL, DEFAULT_AI_BASE_URL);
    await saveAiSettings({ apiKey: '', baseURL: '', model: '' }, reviewer);
    assert.equal((await getAiConnection('m')).apiKey, 'server-key');
  });

  await t.test('only staff can read or change settings; bad input is refused', async () => {
    await assert.rejects(getSettingsView(guest, 'm'), { code: 'FORBIDDEN' });
    await assert.rejects(saveSiteStatus({ offline: true }, guest), { code: 'FORBIDDEN' });
    await assert.rejects(saveAiSettings({ baseURL: 'http://insecure.example', model: '' }, reviewer));
  });

  await t.test('the kill switch takes the site down and brings it back', async () => {
    assert.deepEqual(await getSiteStatus(), { offline: false, message: '' });
    await saveSiteStatus({ offline: true, message: 'Back on Monday.' }, reviewer);
    assert.deepEqual(await getSiteStatus(), { offline: true, message: 'Back on Monday.' });
    const view = await getSettingsView(reviewer, 'm');
    assert.equal(view.site.offline, true);
    assert.equal(view.site.updatedBy, 'staff@example.org');
    await saveSiteStatus({ offline: false, message: '' }, reviewer);
    assert.equal((await getSiteStatus()).offline, false);
  });
});
