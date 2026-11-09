'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import {
  CircleCheck,
  CircleX,
  FileSearch,
  Globe,
  History,
  Inbox,
  LoaderCircle,
  MessageSquareMore,
  Paperclip,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  formatEventDate,
  type ArchiveData,
  type ReviewInput,
  type SubmissionRecord,
  type VetOverview,
} from '@southview/validators';
import {
  filterReviewQueue,
  kindLabels,
  reviewKinds,
  reviewLabels,
  reviewStatuses,
  submissionPerson,
  type ReviewState,
  type VetState,
  vetState,
  vetLabels,
} from '@/lib/review-state';
import { PrivateSubmissionPhoto } from './submission-manager';
import { sectionLabel } from '@/lib/person-edit';

export function ReviewStats({
  items,
  selected,
  onSelect,
}: {
  items: SubmissionRecord[];
  selected: string;
  onSelect: (status: ReviewState['status']) => void;
}) {
  const stats = [
    { status: 'pending', Icon: Inbox },
    { status: 'needs-information', Icon: MessageSquareMore },
    { status: 'published', Icon: CircleCheck },
    { status: 'rejected', Icon: CircleX },
  ] as const;
  return (
    <div className="review-stats" aria-label="Submission status filters">
      {stats.map(({ status, Icon }) => (
        <button key={status} aria-pressed={selected === status} onClick={() => onSelect(status)}>
          <Icon size={20} aria-hidden="true" />
          <span>{reviewLabels[status]}</span>
          <strong>{items.filter((item) => item.status === status).length}</strong>
        </button>
      ))}
    </div>
  );
}

export function ReviewQueue({
  items,
  archive,
  state,
  selectedId,
  onChange,
  onSelect,
  vet,
  startingVet,
}: {
  items: SubmissionRecord[];
  archive: ArchiveData;
  state: ReviewState;
  selectedId?: string;
  onChange: (patch: Partial<ReviewState>) => void;
  onSelect: (id: string) => void;
  vet: VetOverview | null;
  startingVet: string | null;
}) {
  const visible = filterReviewQueue(items, state, archive);
  return (
    <aside className="review-queue" aria-label="Submission queue">
      <div className="review-queue-tools">
        <div className="review-section-heading">
          <h2>
            <Inbox size={19} aria-hidden="true" /> Submissions
          </h2>
          <span aria-live="polite">{visible.length}</span>
        </div>
        <label className="review-search">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Search title, person or submission ID</span>
          <input
            type="search"
            placeholder="Title, person or ID"
            value={state.q}
            maxLength={200}
            onChange={(event) => onChange({ q: event.target.value })}
          />
        </label>
        <div className="review-filters">
          <label className="community-field">
            <span>Status</span>
            <select
              value={state.status}
              onChange={(event) =>
                onChange({ status: event.target.value as ReviewState['status'] })
              }
            >
              {reviewStatuses.map((status) => (
                <option key={status} value={status}>
                  {reviewLabels[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="community-field">
            <span>Type</span>
            <select
              value={state.kind}
              onChange={(event) => onChange({ kind: event.target.value as ReviewState['kind'] })}
            >
              {reviewKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kindLabels[kind]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="review-queue-list">
        {visible.map((item) => (
          <button
            className="review-queue-item"
            key={item.id}
            aria-pressed={selectedId === item.id}
            onClick={() => onSelect(item.id)}
          >
            <span className="community-status" data-status={item.status}>
              {reviewLabels[item.status]}
            </span>
            <strong>{item.input.title}</strong>
            <span className="review-person">{submissionPerson(item, archive)}</span>
            <span className="review-byline">
              {item.input.anonymous ? 'Anonymous contributor' : item.input.displayName}
            </span>
            <span className="review-row-meta">
              <time dateTime={item.createdAt}>{item.createdAt.slice(0, 10)}</time>
              <span>
                <Paperclip size={14} aria-hidden="true" /> {item.photos.length}
                <span className="sr-only"> attachments</span>
              </span>
            </span>
            <span className="review-row-meta">
              <span>{kindLabels[item.input.kind]}</span>
              <span>Vet: {vetLabels[vetState(vet, item.id, startingVet).status]}</span>
            </span>
          </button>
        ))}
        {!visible.length && (
          <div className="review-empty">
            <Inbox size={28} aria-hidden="true" />
            <h3>No matching submissions</h3>
            <p>Try another search or filter.</p>
            <button
              className="community-text-button"
              onClick={() => onChange({ q: '', kind: 'all', status: 'all' })}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

export function ReviewActions({
  status,
  busy,
  onDecision,
  onVet,
  vetDisabled,
}: {
  status: SubmissionRecord['status'];
  busy: boolean;
  onDecision: (action: ReviewInput['action']) => void;
  onVet: () => void;
  vetDisabled: boolean;
}) {
  const editable = status === 'pending' || status === 'needs-information';
  return (
    <div className="review-actions" aria-label="Review actions">
      <button
        className="community-secondary"
        disabled={busy || vetDisabled}
        onClick={onVet}
        aria-describedby="vet-help"
      >
        <FileSearch size={17} aria-hidden="true" /> Vet
      </button>
      <button
        className="community-primary"
        disabled={busy || !editable}
        onClick={() => onDecision('publish')}
      >
        <CircleCheck size={17} aria-hidden="true" /> Approve
      </button>
      <button
        className="community-danger"
        disabled={busy || !editable}
        onClick={() => onDecision('reject')}
      >
        <CircleX size={17} aria-hidden="true" /> Reject
      </button>
      {status === 'pending' && (
        <button
          className="community-text-button"
          disabled={busy}
          onClick={() => onDecision('needs-information')}
        >
          <MessageSquareMore size={17} aria-hidden="true" /> Request information
        </button>
      )}
      {status === 'published' && (
        <button className="community-danger" disabled={busy} onClick={() => onDecision('withdraw')}>
          Withdraw
        </button>
      )}
    </div>
  );
}

export function VetPanel({
  state,
  onRun,
  canRun,
}: {
  state: VetState;
  onRun: () => void;
  canRun: boolean;
}) {
  const report = state.run?.status === 'completed' ? state.run.report : null;
  return (
    <section className="review-vet" aria-label="AI check">
      <div className="review-section-heading">
        <h2>
          <FileSearch size={20} aria-hidden="true" /> AI check
        </h2>
        <span className="review-vet-status" role="status">
          {state.status === 'running' && <LoaderCircle size={15} className="community-spinner" />}{' '}
          {vetLabels[state.status]}
        </span>
      </div>
      <p id="vet-help" className="community-hint">
        Checks the submitted original, supplements and available photos with web research.
        Public-draft edits are not included. Staff decide what to publish.
      </p>
      {state.status === 'not-configured' && (
        <p>
          Luna is not configured on this server. Manual review and publication remain available.
        </p>
      )}
      {state.status === 'unavailable' && (
        <p>AI check status could not be loaded. Refresh the desk to retry.</p>
      )}
      {state.configured === false && state.run && (
        <p>
          Luna is not configured on this server. Saved findings remain available; a new check needs
          server configuration.
        </p>
      )}
      {state.status === 'not-checked' && <p>No check has been run for this submission.</p>}
      {state.status === 'running' && (
        <p role="status">
          Analyzing submission and researching historical sources… You can continue reviewing.
        </p>
      )}
      {state.status === 'failed' && <p role="alert">{state.run?.error}</p>}
      {state.status === 'outdated' && (
        <p className="review-vet-warning">
          New material was added after this check. Run Vet again before relying on these findings.
        </p>
      )}
      {report && state.status !== 'running' && (
        <>
          <p>{report.summary}</p>
          {report.spam_flag && (
            <p className="review-vet-warning">
              Potential spam or irrelevant content flagged for staff review.
            </p>
          )}
          <details className="review-claim-details">
            <summary>View {report.claims.length} claim checks</summary>
            <ol className="review-findings">
              {report.claims.map((claim, index) => (
                <li key={index}>
                  <div className="review-claim-heading">
                    <span className="review-verdict" data-verdict={claim.verdict}>
                      {claim.verdict}
                    </span>
                    <strong>{claim.claim_text}</strong>
                  </div>
                  <p>{claim.explanation}</p>
                  {!!claim.evidence.length && (
                    <ul className="review-evidence">
                      {claim.evidence.map((source, evidenceIndex) => (
                        <li key={evidenceIndex}>
                          {source.url && /^https?:\/\//i.test(source.url) ? (
                            <a href={source.url} target="_blank" rel="noopener noreferrer">
                              {source.title}
                            </a>
                          ) : (
                            <strong>{source.title}</strong>
                          )}
                          <small>
                            {source.source_type === 'web-search'
                              ? 'Web research'
                              : source.source_type === 'submitted-link'
                                ? 'Submitted link'
                                : 'Submitted material'}
                            {source.submission_ref ? ` · ${source.submission_ref}` : ''}
                          </small>
                          <p>{source.relevance}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {claim.reviewer_note && (
                    <p className="review-claim-note">For the reviewer: {claim.reviewer_note}</p>
                  )}
                </li>
              ))}
            </ol>
          </details>
          {!!report.follow_up_questions.length && (
            <details>
              <summary>Questions for the contributor</summary>
              <ul>
                {report.follow_up_questions.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
            </details>
          )}
          {!!report.limitations.length && (
            <details>
              <summary>Limits of this check</summary>
              <ul>
                {report.limitations.map((limitation, index) => (
                  <li key={index}>{limitation}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {!!state.run?.attachments.length && (
        <details>
          <summary>Attachment coverage · {state.run.attachments.length}</summary>
          <ul>
            {state.run.attachments.map((photo) => (
              <li key={photo.id}>
                {photo.label}:{' '}
                {photo.status === 'provided'
                  ? 'Image supplied to Luna; interpretation may be uncertain.'
                  : `${photo.status} — not analyzed.`}
              </li>
            ))}
          </ul>
        </details>
      )}
      {state.run && (
        <small>
          {state.run.model} ·{' '}
          {state.run.completedAt
            ? `Checked ${new Date(state.run.completedAt).toLocaleString()}`
            : `Started ${new Date(state.run.startedAt).toLocaleString()}`}
        </small>
      )}
      <div className="review-vet-footer">
        <span>GPT-6 Luna</span>
        <span>
          <Globe size={14} aria-hidden="true" /> Web search
        </span>
        {!['not-configured', 'unavailable', 'running'].includes(state.status) && (
          <button className="community-text-button" disabled={!canRun} onClick={onRun}>
            <RefreshCw size={15} aria-hidden="true" />{' '}
            {state.status === 'not-checked' ? 'Run Vet' : 'Run again'}
          </button>
        )}
      </div>
    </section>
  );
}

export function OriginalSubmission({
  record,
  archive,
}: {
  record: SubmissionRecord;
  archive: ArchiveData;
}) {
  return (
    <div className="review-original">
      <div className="review-section-heading">
        <h3>Original submission</h3>
        <span>Retained as submitted</span>
      </div>
      <p className="community-body">{record.input.body}</p>
      <dl className="review-facts">
        <div>
          <dt>Person</dt>
          <dd>{submissionPerson(record, archive)}</dd>
        </div>
        <div>
          <dt>Event date</dt>
          <dd>{formatEventDate(record.input.eventDate)}</dd>
        </div>
        <div>
          <dt>Other people</dt>
          <dd>
            {archive.people
              .filter((person) => record.input.relatedPersonIds.includes(person.id))
              .map((person) => person.name)
              .join('; ') || 'None supplied'}
          </dd>
        </div>
        <div>
          <dt>Places</dt>
          <dd>
            {archive.places
              .filter((place) => record.input.placeIds.includes(place.id))
              .map((place) => place.name)
              .join('; ') || 'None supplied'}
          </dd>
        </div>
        {record.input.placement && (
          <div>
            <dt>Requested placement</dt>
            <dd>
              {sectionLabel(record.input.placement.section)}
              {record.input.placement.blockId
                ? ` · ${record.input.kind === 'correction' ? 'correcting' : 'after'} paragraph ${record.input.placement.blockId}`
                : ''}
              {record.input.placement.proposedPlaceName
                ? ` · new place: ${record.input.placement.proposedPlaceName}`
                : ''}
            </dd>
          </div>
        )}
        {record.input.placement?.proposedPlaceSummary && (
          <div>
            <dt>About the place</dt>
            <dd className="review-original-paragraph">
              {record.input.placement.proposedPlaceSummary}
            </dd>
          </div>
        )}
        {record.input.placement?.originalText && (
          <div>
            <dt>
              {record.input.placement.section === 'places' ? 'As it was' : 'Paragraph as it was'}
            </dt>
            <dd className="review-original-paragraph">{record.input.placement.originalText}</dd>
          </div>
        )}
        <div>
          <dt>Context</dt>
          <dd>{record.input.context || 'None supplied'}</dd>
        </div>
        {record.input.proposedOccupation && (
          <div>
            <dt>Their occupation, as suggested</dt>
            <dd>{record.input.proposedOccupation}</dd>
          </div>
        )}
        <div>
          <dt>Original author</dt>
          <dd>{record.input.sourceCreator || 'Not supplied'}</dd>
        </div>
        <div>
          <dt>Narrator</dt>
          <dd>{record.input.narrator || 'Not supplied'}</dd>
        </div>
        <div>
          <dt>Holding institution</dt>
          <dd>{record.input.holdingInstitution || 'Not supplied'}</dd>
        </div>
      </dl>
      <section>
        <h3>Submitted sources</h3>
        {record.input.links.length ? (
          <ul className="review-source-list">
            {record.input.links.map((link) => (
              <li key={link.url}>
                <a href={link.url} target="_blank" rel="noopener noreferrer">
                  {link.title}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="community-hint">
            No external links supplied. Community memories may stand as their own source.
          </p>
        )}
      </section>
      <section>
        <h3>Attachments · {record.photos.length}</h3>
        {record.photos.length ? (
          <div className="community-gallery">
            {record.photos.map((photo) => (
              <PrivateSubmissionPhoto
                key={photo.id}
                submissionId={record.id}
                photo={photo}
                original
              />
            ))}
          </div>
        ) : (
          <p className="community-hint">No photographs supplied.</p>
        )}
      </section>
      <details className="review-private">
        <summary>Private contact · reviewers only</summary>
        <dl className="review-facts">
          <div>
            <dt>Name</dt>
            <dd>{record.input.privateName}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{record.input.email}</dd>
          </div>
        </dl>
        <p className="community-hint">
          These details are separate from the public contributor credit.
        </p>
      </details>
      {record.supplements.length > 0 && (
        <section>
          <h3>Additional information</h3>
          {record.supplements.map((supplement) => (
            <article className="review-supplement" key={supplement.id}>
              <time>{supplement.createdAt.slice(0, 10)}</time>
              <p className="community-body">{supplement.body}</p>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

export function ReviewHistory({ record }: { record: SubmissionRecord }) {
  return (
    <section>
      <h3>
        <History size={19} aria-hidden="true" /> Review history
      </h3>
      {record.reviews.length ? (
        <ol className="community-timeline">
          {record.reviews.map((review, index) => (
            <li key={`${review.createdAt}-${index}`}>
              <time>{review.createdAt}</time>
              <strong>
                {(
                  {
                    publish: 'Published',
                    reject: 'Rejected',
                    'needs-information': 'Information requested',
                    withdraw: 'Withdrawn',
                  } as Record<string, string>
                )[review.action] ?? review.action}
              </strong>
              {review.authorMessage && <p>Message to contributor: {review.authorMessage}</p>}
              {review.publicNote && <p>Public note: {review.publicNote}</p>}
              {review.internalNote && <p>Internal note: {review.internalNote}</p>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="community-hint">No review decisions yet.</p>
      )}
    </section>
  );
}

export function ReviewDialog({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="review-dialog"
      aria-labelledby="review-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="review-dialog-heading">
        <h2 id="review-dialog-title">{title}</h2>
        <button autoFocus disabled={busy} onClick={onClose} aria-label="Close confirmation">
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
