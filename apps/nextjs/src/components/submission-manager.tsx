'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  FileText,
  ImageOff,
  LoaderCircle,
  MessageSquarePlus,
  ShieldCheck,
} from 'lucide-react';
import {
  photoMetadataSchema,
  type PhotoMetadata,
  type SubmissionPhoto,
  type SubmissionRecord,
} from '@southview/validators';
import {
  alsoFor,
  communityRequest,
  uploadCommunityPhoto,
  privatePhotoUrl,
  receiptFor,
  statusLabel,
  signOutCommunity,
  submissionReceiptUrl,
  type CommunitySession,
} from '@/lib/community-client';
import { CommunityNotice } from './community-shell';
import { copy } from '@/lib/copy';

export function PrivateSubmissionPhoto({
  submissionId,
  photo,
  receiptToken,
  original = false,
}: {
  submissionId: string;
  photo: SubmissionPhoto;
  receiptToken?: string;
  original?: boolean;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let imageUrl = '';
    setUrl('');
    setError('');
    privatePhotoUrl(submissionId, photo.id, receiptToken)
      .then((value) => {
        imageUrl = value;
        if (!disposed) setUrl(value);
        else URL.revokeObjectURL(value);
      })
      .catch(() => {
        if (!disposed) setError('This private photograph could not be loaded.');
      });
    return () => {
      disposed = true;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [submissionId, photo.id, receiptToken]);
  async function downloadOriginal() {
    try {
      const blobUrl = await privatePhotoUrl(submissionId, photo.id, receiptToken, true);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${photo.id}-original`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch {
      setError('The original file could not be downloaded. Please try again.');
    }
  }
  return (
    <figure>
      {url ? (
        <img src={url} alt={photo.caption} width={photo.width} height={photo.height} />
      ) : (
        <div className="community-loading">
          {error ? (
            <ImageOff size={22} />
          ) : (
            <LoaderCircle className="community-spinner" size={22} />
          )}
          {error || 'Loading private photograph…'}
        </div>
      )}
      <figcaption>
        <strong>{photo.caption}</strong>
        <br />
        Creator: {photo.creator}
        <br />
        Rights: {photo.rights}
        {original && (
          <>
            <br />
            <button className="community-text-button" onClick={downloadOriginal}>
              <Download size={14} aria-hidden="true" /> Download original for review
            </button>
          </>
        )}
      </figcaption>
    </figure>
  );
}

export function SubmissionManager({ id }: { id?: string }) {
  const [session, setSession] = useState<CommunitySession | null>(null);
  const [submission, setSubmission] = useState<SubmissionRecord | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [token, setToken] = useState<string>();
  const [also, setAlso] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [supplement, setSupplement] = useState('');
  const [copied, setCopied] = useState(false);
  const [extraPhotos, setExtraPhotos] = useState<
    {
      clientPhotoId: string;
      file: File;
      preview: string;
      uploadedId?: string;
      metadata: Omit<PhotoMetadata, 'permission'> & { permission: boolean };
    }[]
  >([]);
  const photoUrls = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setSubmission(null);
    setSubmissions([]);
    try {
      const access = await communityRequest<CommunitySession>('/session');
      setSession(access);
      if (id) {
        setAlso(alsoFor().filter((other) => other !== id));
        const receipt = receiptFor(id);
        setToken(receipt);
        const result = await communityRequest<{ submission: SubmissionRecord }>(
          `/submissions/${encodeURIComponent(id)}`,
          {},
          receipt,
        );
        setSubmission(result.submission);
      } else if (access.user) {
        const result = await communityRequest<{ submissions: SubmissionRecord[] }>('/mine');
        setSubmissions(result.submissions);
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Your contributions could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
    const urls = photoUrls.current;
    return () => {
      if (timer.current) clearTimeout(timer.current);
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [load]);

  async function addSupplement(event: FormEvent) {
    event.preventDefault();
    if (!id) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      for (const photo of extraPhotos) {
        if (photo.uploadedId) continue;
        const metadata = photoMetadataSchema.safeParse(photo.metadata);
        if (!metadata.success)
          throw new Error(
            'Complete the caption, creator, rights, and permission for each additional photograph.',
          );
        const uploaded = await uploadCommunityPhoto(
          id,
          photo.file,
          photo.clientPhotoId,
          metadata.data,
          token,
        );
        photo.uploadedId = uploaded.photo.id;
        setExtraPhotos((previous) =>
          previous.map((item) =>
            item.clientPhotoId === photo.clientPhotoId
              ? { ...item, uploadedId: uploaded.photo.id }
              : item,
          ),
        );
      }
      const result = await communityRequest<{ submission: SubmissionRecord }>(
        `/submissions/${encodeURIComponent(id)}/supplements`,
        { method: 'POST', body: JSON.stringify({ body: supplement }) },
        token,
      );
      setSubmission(result.submission);
      setSupplement('');
      setExtraPhotos([]);
      photoUrls.current.forEach((url) => URL.revokeObjectURL(url));
      photoUrls.current.clear();
      setNotice('Your additional context has been sent to the review team.');
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Your message could not be sent. Your text is still here.',
      );
    } finally {
      setBusy(false);
    }
  }
  function addExtraPhotos(files: FileList | null) {
    if (!files || !submission) return;
    const chosen = [...files];
    if (submission.photos.length + extraPhotos.length + chosen.length > 5) {
      setError('A contribution can contain up to five photographs in total.');
      return;
    }
    const invalid = chosen.find(
      (file) =>
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 10 * 1024 * 1024,
    );
    if (invalid) {
      setError(`${invalid.name} cannot be added. Use JPEG, PNG, or WebP images of 10 MB or less.`);
      return;
    }
    setExtraPhotos((previous) => [
      ...previous,
      ...chosen.map((file) => {
        const preview = URL.createObjectURL(file);
        photoUrls.current.add(preview);
        return {
          clientPhotoId: crypto.randomUUID(),
          file,
          preview,
          metadata: { caption: '', creator: '', rights: '', permission: false },
        };
      }),
    ]);
  }
  function editExtraPhoto(
    id: string,
    patch: Partial<Omit<PhotoMetadata, 'permission'> & { permission: boolean }>,
  ) {
    setExtraPhotos((previous) =>
      previous.map((photo) =>
        photo.clientPhotoId === id
          ? { ...photo, metadata: { ...photo.metadata, ...patch } }
          : photo,
      ),
    );
  }
  async function claim() {
    if (!id) return;
    setBusy(true);
    setError('');
    try {
      const result = await communityRequest<{ submission: SubmissionRecord }>(
        `/submissions/${encodeURIComponent(id)}/claim`,
        { method: 'POST' },
        token,
      );
      setSubmission(result.submission);
      setNotice('This contribution is now connected to your account.');
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'This contribution could not be connected to your account.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function finalizeDraft() {
    if (!id) return;
    setBusy(true);
    setError('');
    try {
      const result = await communityRequest<{ submission: SubmissionRecord }>(
        `/submissions/${encodeURIComponent(id)}/submit`,
        { method: 'POST' },
        token,
      );
      setSubmission(result.submission);
      setNotice('Your contribution has been sent for review.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your draft could not be submitted.');
    } finally {
      setBusy(false);
    }
  }
  async function copyReceipt() {
    if (!id || !token) return;
    const link = new URL(submissionReceiptUrl(id, token), window.location.origin).href;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Keep this private receipt link:', link);
    }
  }
  if (loading)
    return (
      <div className="community-loading" role="status">
        <LoaderCircle className="community-spinner" size={22} /> Loading your contributions…
      </div>
    );
  if (!id)
    return (
      <>
        {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
        {session?.user ? (
          <>
            <div className="community-session-bar">
              <span>Signed in as {session.user.email}</span>
              <span className="community-session-actions">
                {session.reviewer && (
                  <Link className="community-text-button" href="/admin/contributions">
                    <ShieldCheck size={16} aria-hidden="true" /> {copy.reviewDesk}
                  </Link>
                )}
                <button
                  className="community-text-button"
                  onClick={() => signOutCommunity().catch((failure) => setError(failure.message))}
                >
                  Sign out
                </button>
              </span>
            </div>
            {submissions.length ? (
              <div className="community-records">
                {submissions.map((item) => (
                  <div className="community-record-card" key={item.id}>
                    <div>
                      <span className="community-status" data-status={item.status}>
                        {statusLabel(item.status)}
                      </span>
                      <h2>{item.input.title}</h2>
                      <p>
                        Submitted {item.createdAt.slice(0, 10)} · Updated{' '}
                        {item.updatedAt.slice(0, 10)}
                      </p>
                    </div>
                    <Link
                      className="community-secondary"
                      href={`/submissions/${encodeURIComponent(item.id)}`}
                    >
                      View contribution <ArrowRight size={16} />
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="community-empty">
                <FileText size={33} />
                <h2>Your part of the story begins here.</h2>
                <p>
                  Contributions connected to this account will appear here. Guest contributions can
                  be linked from their private receipt pages.
                </p>
                <Link className="community-primary" href="/contribute">
                  {copy.share} <ArrowRight size={17} />
                </Link>
              </div>
            )}
          </>
        ) : (
          <div className="community-empty">
            <FileText size={33} />
            <h2>Find the stories you have shared.</h2>
            <p>
              Sign in with Google to view your contributions. If you contributed as a guest, open
              the private link you saved after sending; the archive does not send email.
            </p>
            <Link className="community-primary" href="/sign-in?next=%2Fmy-contributions">
              Sign in <ArrowRight size={17} />
            </Link>
          </div>
        )}
      </>
    );
  if (!submission)
    return (
      <>
        <CommunityNotice kind="error" title="This private contribution is not available">
          {error ||
            'Open the complete receipt link, or sign in with the email connected to this contribution.'}
        </CommunityNotice>
        <div className="community-actions">
          <Link
            className="community-primary"
            href={`/sign-in?next=${encodeURIComponent(`/submissions/${id}`)}`}
          >
            Sign in
          </Link>
          <button className="community-secondary" onClick={load}>
            Try again
          </button>
        </div>
      </>
    );
  return (
    <div className="community-grid">
      <div>
        {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
        {notice && <CommunityNotice kind="success">{notice}</CommunityNotice>}
        <div className="community-entry-header">
          <span className="community-status" data-status={submission.status}>
            {statusLabel(submission.status)}
          </span>
          <h2 style={{ fontSize: 36, margin: '20px 0 12px' }}>{submission.input.title}</h2>
          <p className="community-hint">
            Received {submission.createdAt.slice(0, 10)} · Last updated{' '}
            {submission.updatedAt.slice(0, 10)}
          </p>
        </div>
        {token && (
          <CommunityNotice title="Save this private link">
            <p>
              The archive does not send email. This link is the only way back to your story, the
              review team’s replies, and the published entry. Keep it private.
            </p>
            <div className="community-actions">
              <button className="community-primary" onClick={copyReceipt}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? 'Private link copied' : 'Copy my private link'}
              </button>
            </div>
          </CommunityNotice>
        )}
        {also.length > 0 && token && (
          <CommunityNotice title={`You sent ${also.length + 1} additions together`}>
            <p>Each one is reviewed separately. The same private link opens all of them:</p>
            <ul className="community-also-list">
              {also.map((other, index) => (
                <li key={other}>
                  <Link href={submissionReceiptUrl(other, token)}>Addition {index + 2}</Link>
                </li>
              ))}
            </ul>
          </CommunityNotice>
        )}
        {submission.status === 'pending' && (
          <CommunityNotice title="Thank you for helping preserve this story">
            Archive reviewers will read your story. It stays private until approved; their replies
            appear on this page.
          </CommunityNotice>
        )}
        <div className="community-preview">
          <p className="community-preview-label">Your contribution</p>
          <p className="community-body">{submission.input.body}</p>
          {submission.input.context && (
            <div className="community-review-line">
              <strong>Context</strong>
              {submission.input.context}
            </div>
          )}
          <div className="community-review-line">
            <strong>Public credit</strong>
            {submission.input.anonymous ? 'Anonymous contributor' : submission.input.displayName}
          </div>
          <div className="community-review-line">
            <strong>Private contact</strong>
            {submission.input.privateName} · {submission.input.email}
          </div>
          {submission.input.links.length > 0 && (
            <div className="community-review-line">
              <strong>Related sources</strong>
              {submission.input.links.map((link) => (
                <p key={link.url}>
                  <a
                    className="community-text-button"
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link.title}
                  </a>
                </p>
              ))}
            </div>
          )}
        </div>
        {submission.photos.length > 0 && (
          <div className="community-gallery">
            {submission.photos.map((photo) => (
              <PrivateSubmissionPhoto
                key={photo.id}
                submissionId={id}
                photo={photo}
                receiptToken={token}
              />
            ))}
          </div>
        )}
        {submission.publishedEntryId && submission.status === 'published' && (
          <div className="community-actions">
            <Link
              className="community-primary"
              href={`/contributions/${encodeURIComponent(submission.publishedEntryId)}`}
            >
              View the published contribution <ArrowRight size={17} />
            </Link>
          </div>
        )}
        {submission.reviews.length > 0 && (
          <section className="community-section" style={{ marginTop: 28 }}>
            <h2>From the review team</h2>
            <ol className="community-timeline">
              {submission.reviews.map((review, index) => (
                <li key={`${review.createdAt}-${index}`}>
                  <time>{review.createdAt.slice(0, 10)}</time>
                  {review.authorMessage || review.publicNote || 'The review status was updated.'}
                </li>
              ))}
            </ol>
          </section>
        )}
        {submission.supplements.length > 0 && (
          <section className="community-section">
            <h2>Additional context you shared</h2>
            <ol className="community-timeline">
              {submission.supplements.map((item) => (
                <li key={item.id}>
                  <time>{item.createdAt.slice(0, 10)}</time>
                  <p className="community-body">{item.body}</p>
                </li>
              ))}
            </ol>
          </section>
        )}
        {!['draft', 'withdrawn'].includes(submission.status) && (
          <section className="community-section">
            <h2>Add context or respond to reviewers</h2>
            <form onSubmit={addSupplement} style={{ marginTop: 20 }}>
              <label className="community-field">
                <span>Your message</span>
                <textarea
                  required
                  minLength={3}
                  maxLength={20000}
                  value={supplement}
                  onChange={(event) => setSupplement(event.target.value)}
                  rows={5}
                  placeholder="Add a detail, answer a question, or explain a source."
                />
                <small>
                  This message goes to the review team; it is not published automatically.
                </small>
              </label>
              {submission.status === 'needs-information' && (
                <div style={{ marginTop: 22 }}>
                  <label className="community-field">
                    <span>Additional photographs (optional)</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      disabled={busy || submission.photos.length + extraPhotos.length >= 5}
                      onChange={(event) => {
                        addExtraPhotos(event.target.files);
                        event.target.value = '';
                      }}
                    />
                    <small>
                      Up to five photographs per contribution, 10 MB each. Only JPEG, PNG, or WebP.
                    </small>
                  </label>
                  <div className="community-photo-list">
                    {extraPhotos.map((photo) => (
                      <div className="community-photo" key={photo.clientPhotoId}>
                        <img
                          src={photo.preview}
                          alt="Additional photograph selected for your reply"
                        />
                        <div className="community-photo-meta">
                          <strong>{photo.file.name}</strong>
                          {photo.uploadedId && (
                            <p className="community-hint">
                              Uploaded. It will accompany your reply.
                            </p>
                          )}
                          <label className="community-field">
                            <span>Caption *</span>
                            <input
                              required
                              maxLength={500}
                              disabled={busy || Boolean(photo.uploadedId)}
                              value={photo.metadata.caption}
                              onChange={(event) =>
                                editExtraPhoto(photo.clientPhotoId, { caption: event.target.value })
                              }
                            />
                          </label>
                          <label className="community-field">
                            <span>Creator *</span>
                            <input
                              required
                              maxLength={160}
                              disabled={busy || Boolean(photo.uploadedId)}
                              value={photo.metadata.creator}
                              onChange={(event) =>
                                editExtraPhoto(photo.clientPhotoId, { creator: event.target.value })
                              }
                            />
                          </label>
                          <label className="community-field">
                            <span>Rights and permission *</span>
                            <input
                              required
                              maxLength={1000}
                              disabled={busy || Boolean(photo.uploadedId)}
                              value={photo.metadata.rights}
                              onChange={(event) =>
                                editExtraPhoto(photo.clientPhotoId, { rights: event.target.value })
                              }
                            />
                          </label>
                          <label className="community-check" style={{ marginTop: 12 }}>
                            <input
                              type="checkbox"
                              required
                              disabled={busy || Boolean(photo.uploadedId)}
                              checked={photo.metadata.permission}
                              onChange={(event) =>
                                editExtraPhoto(photo.clientPhotoId, {
                                  permission: event.target.checked,
                                })
                              }
                            />
                            <span>I have permission for this photograph to be displayed.</span>
                          </label>
                          {!photo.uploadedId && (
                            <button
                              className="community-text-button"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                URL.revokeObjectURL(photo.preview);
                                photoUrls.current.delete(photo.preview);
                                setExtraPhotos((previous) =>
                                  previous.filter(
                                    (item) => item.clientPhotoId !== photo.clientPhotoId,
                                  ),
                                );
                              }}
                            >
                              Remove photograph
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="community-actions">
                <button className="community-primary" disabled={busy}>
                  {busy ? (
                    <LoaderCircle className="community-spinner" size={17} />
                  ) : (
                    <MessageSquarePlus size={17} />
                  )}{' '}
                  Send additional context
                </button>
              </div>
            </form>
          </section>
        )}
        {submission.status === 'draft' && (
          <CommunityNotice title="This contribution is still a draft">
            It has not reached the review queue. Check the content above before sending it.
            <div className="community-actions">
              <button className="community-primary" disabled={busy} onClick={finalizeDraft}>
                Send this draft for review
              </button>
              <Link className="community-secondary" href="/contribute">
                Return to the form
              </Link>
            </div>
          </CommunityNotice>
        )}
      </div>
      <aside className="community-sidebar">
        <div className="community-aside-card">
          <FileText size={26} />
          <h2>Your private receipt</h2>
          <p className="community-label">Submission reference</p>
          <p
            style={{
              overflowWrap: 'anywhere',
              userSelect: 'all',
              margin: '7px 0 16px',
              fontSize: 13,
            }}
          >
            {submission.id}
          </p>
          <p>
            Use this page to follow the review and keep in touch. The receipt link grants access to
            your private submission, so keep it to yourself.
          </p>
          {token && (
            <button className="community-secondary" style={{ marginTop: 18 }} onClick={copyReceipt}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Private link copied' : 'Copy private receipt'}
            </button>
          )}
        </div>
        {!submission.userId && (
          <div className="community-aside-card">
            <h2>Keep it with your account.</h2>
            <p>
              Sign in with a Google account that uses the same email to connect this story to your
              account.
            </p>
            {session?.user ? (
              <button
                className="community-primary"
                style={{ marginTop: 18 }}
                disabled={busy}
                onClick={claim}
              >
                Link to my account
              </button>
            ) : (
              <Link
                className="community-text-button"
                href={`/sign-in?next=${encodeURIComponent(`/submissions/${id}`)}`}
              >
                Sign in <ArrowRight size={14} />
              </Link>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
