'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Eye, LoaderCircle, PencilLine, Send, X } from 'lucide-react';
import { copy } from '@/lib/copy';
import type { EditContact } from '@/lib/person-edit';
import { CommunityNotice } from '../community-shell';
import { usePersonEdit } from './context';

/** The entry button on a person page, used in the top bar and beside the community section. */
export function EditEntryButton({
  variant = 'text',
  label = copy.editPage,
}: {
  variant?: 'text' | 'button' | 'link';
  label?: string;
}) {
  const edit = usePersonEdit();
  if (edit.editing) return null;
  const className =
    variant === 'button'
      ? 'archive-button'
      : variant === 'link'
        ? 'archive-text-link person-edit-entry'
        : 'archive-permalink person-edit-entry';
  return (
    <button type="button" className={className} onClick={edit.start}>
      <PencilLine size={variant === 'button' ? 18 : 16} aria-hidden="true" /> {label}
    </button>
  );
}

/** Sticky bar shown while editing: status, preview toggle, send, exit. */
export function EditToolbar() {
  const edit = usePersonEdit();
  if (!edit.editing) return null;
  const count = edit.blocks.length;
  return (
    <>
      <div className="person-edit-toolbar" role="region" aria-label="Editing tools">
        <div className="person-edit-toolbar-status">
          <PencilLine size={17} aria-hidden="true" />
          <span>
            <strong>
              {edit.phase === 'preview' ? 'Previewing' : 'Editing'} {edit.person.name}
            </strong>
            <small>
              {count === 0
                ? 'Use the + buttons to add to this page. Nothing is published until reviewers approve it.'
                : `${count} ${count === 1 ? 'addition' : 'additions'} ready · reviewers approve before anything is public`}
            </small>
          </span>
        </div>
        <div className="person-edit-toolbar-actions">
          <button
            type="button"
            className="community-secondary"
            disabled={count === 0}
            onClick={() => edit.setPhase(edit.phase === 'preview' ? 'edit' : 'preview')}
            aria-pressed={edit.phase === 'preview'}
          >
            <Eye size={16} aria-hidden="true" />{' '}
            {edit.phase === 'preview' ? copy.backToEditing : copy.preview}
          </button>
          <button
            type="button"
            className="community-primary"
            disabled={count === 0}
            onClick={edit.openSend}
          >
            <Send size={16} aria-hidden="true" /> Send for review
          </button>
          <button
            type="button"
            className="person-edit-exit"
            onClick={edit.exit}
            aria-label={copy.exitEditing}
            title={copy.exitEditing}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      {edit.sendOpen && <SendDialog />}
    </>
  );
}

function SendDialog() {
  const edit = usePersonEdit();
  const [contact, setContact] = useState<EditContact>({
    privateName: '',
    email: '',
    anonymous: false,
    displayName: '',
  });
  const [permission, setPermission] = useState(false);
  const [issue, setIssue] = useState('');
  const first = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    first.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') edit.closeSend();
    };
    document.addEventListener('keydown', key);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
    };
  }, [edit]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (contact.privateName.trim().length < 2) return setIssue('Enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim()))
      return setIssue('Enter a valid email address.');
    if (!contact.anonymous && !contact.displayName.trim())
      return setIssue('Choose a public display name, or tick anonymous.');
    if (!permission) return setIssue('Please confirm the permission statement.');
    setIssue('');
    void edit.send(contact);
  }
  const count = edit.blocks.length;
  return (
    <div
      className="person-edit-scrim"
      onClick={(event) => event.target === event.currentTarget && edit.closeSend()}
    >
      <div
        className="person-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="person-edit-send-title"
        ref={dialog}
      >
        <h2 id="person-edit-send-title">
          Send {count === 1 ? 'your addition' : `${count} additions`} for review
        </h2>
        <p className="community-hint">
          Reviewers read everything before it is published. The archive sends no email: after
          sending, save the private link on the next page. It is your only receipt.
        </p>
        <form className="community-fields" onSubmit={submit} noValidate>
          {(issue || edit.error) && (
            <CommunityNotice kind="error">{issue || edit.error}</CommunityNotice>
          )}
          <div className="community-two-columns">
            <label className="community-field">
              <span>
                Your name <span className="community-required">*</span>
              </span>
              <input
                ref={first}
                value={contact.privateName}
                autoComplete="name"
                maxLength={160}
                placeholder="Ruth Hill"
                onChange={(event) => setContact({ ...contact, privateName: event.target.value })}
              />
              <small>Private. Used by the review team.</small>
            </label>
            <label className="community-field">
              <span>
                Email address <span className="community-required">*</span>
              </span>
              <input
                type="email"
                value={contact.email}
                autoComplete="email"
                placeholder="ruth@example.org"
                onChange={(event) => setContact({ ...contact, email: event.target.value })}
              />
              <small>Private. Reviewers may use it to reach you.</small>
            </label>
          </div>
          <label className="community-check">
            <input
              type="checkbox"
              checked={contact.anonymous}
              onChange={(event) => setContact({ ...contact, anonymous: event.target.checked })}
            />
            <span>Publish anonymously.</span>
          </label>
          {!contact.anonymous && (
            <label className="community-field">
              <span>
                Public display name <span className="community-required">*</span>
              </span>
              <input
                value={contact.displayName}
                maxLength={160}
                placeholder="The Hill family, or R. Hill"
                onChange={(event) => setContact({ ...contact, displayName: event.target.value })}
              />
              <small>Only this name appears in the public credit.</small>
            </label>
          )}
          <label className="community-check">
            <input
              type="checkbox"
              checked={permission}
              onChange={(event) => setPermission(event.target.checked)}
            />
            <span>
              I give South-View permission to review these additions and publish the approved text
              and photographs with the public credit above.
            </span>
          </label>
          <div className="community-actions">
            <button className="community-primary" type="submit" disabled={edit.sending}>
              {edit.sending ? (
                <>
                  <LoaderCircle size={16} className="community-spinner" aria-hidden="true" />{' '}
                  {edit.progress || 'Sending…'}
                </>
              ) : (
                <>
                  Send for review <ArrowRight size={16} aria-hidden="true" />
                </>
              )}
            </button>
            <button
              className="community-secondary"
              type="button"
              disabled={edit.sending}
              onClick={edit.closeSend}
            >
              Keep editing
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
