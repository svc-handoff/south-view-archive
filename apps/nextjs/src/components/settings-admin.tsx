'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, Power, Sparkles } from 'lucide-react';
import type { SettingsView } from '@southview/validators';
import { communityRequest } from '@/lib/community-client';
import { CommunityNotice } from './community-shell';

const when = (iso: string | null, by: string | null) =>
  iso
    ? `Last changed ${new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}${by ? ` by ${by}` : ''}.`
    : '';
const failure = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/** Site settings: the AI review (Luna) connection and the switch that takes the public site down. */
export function SettingsAdmin() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    communityRequest<SettingsView>('/admin/settings')
      .then(setView)
      .catch((cause) => setError(failure(cause, 'The settings could not be loaded.')));
  }, []);
  if (error && !view) return <CommunityNotice kind="error">{error}</CommunityNotice>;
  if (!view)
    return (
      <p className="review-access">
        <LoaderCircle size={16} className="community-spinner" /> Loading settings…
      </p>
    );
  return (
    <div className="admin-settings">
      <SiteSwitch view={view} onSaved={setView} />
      <AiSettings view={view} onSaved={setView} />
    </div>
  );
}

function AiSettings({ view, onSaved }: { view: SettingsView; onSaved: (view: SettingsView) => void }) {
  const [baseURL, setBaseURL] = useState(view.ai.baseURL);
  const [model, setModel] = useState(view.ai.model);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      const next = await communityRequest<SettingsView>('/admin/settings/ai', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      onSaved(next);
      setApiKey('');
      setMessage({ kind: 'success', text: done });
    } catch (cause) {
      setMessage({ kind: 'error', text: failure(cause, 'The AI settings could not be saved.') });
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void save({ baseURL, model, ...(apiKey.trim() ? { apiKey } : {}) }, 'AI settings saved.');
  }
  const keyStatus =
    view.ai.keySource === 'admin'
      ? `A key ending in ${view.ai.keyHint?.slice(1)} is saved here.`
      : view.ai.keySource === 'server'
        ? 'Using the key set on the server (OPENAI_API_KEY). A key saved here replaces it.'
        : 'No key is set, so Vet with Luna is turned off.';
  return (
    <section className="admin-section" aria-labelledby="settings-ai">
      <h3 id="settings-ai">
        <Sparkles size={18} aria-hidden="true" /> AI review (Vet with Luna)
      </h3>
      <p className="admin-history-note">
        Vet sends a submission to an OpenAI-compatible service that supports the Responses API with
        web search. The key is stored on the server and never shown again after saving.
      </p>
      <form className="community-fields" onSubmit={submit}>
        <label className="community-field">
          <span>API key</span>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            maxLength={400}
            placeholder={view.ai.keySource === 'admin' ? `Saved key ${view.ai.keyHint}` : 'sk-…'}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <small>{keyStatus} Leave blank to keep the current key.</small>
        </label>
        <label className="community-field">
          <span>Base URL</span>
          <input
            type="url"
            value={baseURL}
            maxLength={300}
            placeholder={view.ai.defaultBaseURL}
            onChange={(event) => setBaseURL(event.target.value)}
          />
          <small>Leave blank for {view.ai.defaultBaseURL}.</small>
        </label>
        <label className="community-field">
          <span>Model</span>
          <input
            value={model}
            maxLength={120}
            placeholder={view.ai.defaultModel}
            onChange={(event) => setModel(event.target.value)}
          />
          <small>Leave blank for {view.ai.defaultModel}.</small>
        </label>
        {message && <CommunityNotice kind={message.kind}>{message.text}</CommunityNotice>}
        <div className="admin-form-actions">
          <button type="submit" className="community-primary" disabled={busy}>
            {busy && <LoaderCircle size={16} className="community-spinner" />} Save AI settings
          </button>
          {view.ai.keySource === 'admin' && (
            <button
              type="button"
              className="community-text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Remove the saved API key? Vet will use the server key, if any.'))
                  void save({ baseURL, model, apiKey: '' }, 'The saved key was removed.');
              }}
            >
              Remove saved key
            </button>
          )}
        </div>
        <small className="admin-history-note">{when(view.ai.updatedAt, view.ai.updatedBy)}</small>
      </form>
    </section>
  );
}

function SiteSwitch({ view, onSaved }: { view: SettingsView; onSaved: (view: SettingsView) => void }) {
  const [message, setMessage] = useState(view.site.message);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const offline = view.site.offline;
  async function toggle() {
    const goingOffline = !offline;
    if (
      goingOffline &&
      !window.confirm(
        'Take the public site offline? Visitors and embedded maps will see only the offline notice until you bring it back. Staff pages keep working.',
      )
    )
      return;
    setBusy(true);
    setNotice(null);
    try {
      const next = await communityRequest<SettingsView>('/admin/settings/site', {
        method: 'POST',
        body: JSON.stringify({ offline: goingOffline, message }),
      });
      onSaved(next);
      setNotice({
        kind: 'success',
        text: goingOffline
          ? 'The public site is offline. It can take a few seconds to reach every visitor.'
          : 'The public site is back online.',
      });
    } catch (cause) {
      setNotice({ kind: 'error', text: failure(cause, 'The site status could not be changed.') });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-section admin-delete" aria-labelledby="settings-site">
      <h3 id="settings-site">
        <Power size={18} aria-hidden="true" /> Take the site offline
      </h3>
      <p className="admin-history-note">
        {offline
          ? 'The public site is OFFLINE. Visitors see the notice below; signed-in staff still see the archive and this admin.'
          : 'The public site is online. Taking it offline hides every public page, embed and contribution form, without deleting anything.'}
      </p>
      <label className="community-field">
        <span>Notice for visitors</span>
        <textarea
          value={message}
          maxLength={500}
          rows={2}
          placeholder="Please check back soon."
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
      {notice && <CommunityNotice kind={notice.kind}>{notice.text}</CommunityNotice>}
      <div className="admin-form-actions">
        <button
          type="button"
          className={offline ? 'community-primary' : 'community-primary admin-danger-button'}
          disabled={busy}
          onClick={() => void toggle()}
        >
          {busy && <LoaderCircle size={16} className="community-spinner" />}{' '}
          {offline ? 'Bring the site back online' : 'Take the site offline'}
        </button>
      </div>
      <small className="admin-history-note">{when(view.site.updatedAt, view.site.updatedBy)}</small>
    </section>
  );
}
