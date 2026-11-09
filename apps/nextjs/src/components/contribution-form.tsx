'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Sprout,
  Trash2,
} from 'lucide-react';
import {
  submissionInputSchema,
  photoMetadataSchema,
  linkedRecordIdsSchema,
  formatEventDate,
  type EventDate,
  type SubmissionInput,
  type SubmissionRecord,
  type PhotoMetadata,
} from '@southview/validators';
import { CommunityNotice } from './community-shell';
import { StoryContextFields } from './story-context-fields';
import { RecordPicker } from './record-picker';
import { LocationPicker } from './location-picker';
import type { RecordOption } from '@/lib/record-options';
import { restoreDraftEventDate } from '@/lib/story-context';
import { copy } from '@/lib/copy';
import {
  communityRequest,
  uploadCommunityPhoto,
  privatePhotoUrl,
  submissionReceiptUrl,
  safeCommunityNext,
  type CommunitySession,
} from '@/lib/community-client';

export type PersonOption = RecordOption;
type PhotoDraft = {
  clientPhotoId: string;
  file: File | null;
  name: string;
  preview: string;
  metadata: Omit<PhotoMetadata, 'permission'> & { permission: boolean };
  uploadedId?: string;
};
type DraftLink = { title: string; url: string };
function restoreLinks(value: unknown): DraftLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is DraftLink =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as DraftLink).title === 'string' &&
        typeof (item as DraftLink).url === 'string',
    )
    .slice(0, 10);
}
/** Which provenance fields make sense for each kind of story. */
type SourceKind = 'memory' | 'account' | 'document';
/** One plain question instead of a drawer of provenance fields; testers skipped the drawer. */
const sourceKinds: { value: SourceKind; title: string; text: string }[] = [
  {
    value: 'memory',
    title: 'My own memory, or our family’s',
    text: 'You knew this person, or the story was passed down to you.',
  },
  {
    value: 'account',
    title: 'Someone else told me',
    text: 'A relative, neighbour, or church member remembered it.',
  },
  {
    value: 'document',
    title: 'A document, article, or record',
    text: 'An obituary, newspaper, programme, letter, or an archive’s catalogue.',
  },
];
function restorePoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [lng, lat] = value;
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 85)
    return null;
  return [lng, lat];
}
type Draft = {
  kind: SubmissionInput['kind'];
  personId: string;
  proposedPersonName: string;
  proposedOccupation: string;
  title: string;
  body: string;
  context: string;
  links: DraftLink[];
  anonymous: boolean;
  displayName: string;
  clientRequestId: string;
  receiptToken: string;
  sourceCreator: string;
  narrator: string;
  holdingInstitution: string;
  savedSubmissionId: string;
  relatedPersonIds: string[];
  placeIds: string[];
  eventDate: EventDate;
  /** A place the contributor named or marked on the map for this person. */
  placeName: string;
  placeScope: 'cemetery' | 'atlanta';
  placeCoordinates: [number, number] | null;
};
const draftKey = 'south-view-contribution-draft-v1';
const kinds: { value: SubmissionInput['kind']; title: string; text: string }[] = [
  {
    value: 'memory',
    title: 'Share a memory',
    text: 'A personal recollection, family story, or lived experience.',
  },
  {
    value: 'addition',
    title: 'Add to a story',
    text: 'A document, photograph, or another piece of the history.',
  },
  {
    value: 'correction',
    title: 'Suggest a correction',
    text: 'Help us improve a detail in an existing record.',
  },
  {
    value: 'new-person',
    title: 'Remember someone new',
    text: 'Introduce a person who is not in this collection yet.',
  },
];

export function ContributionForm({
  people,
  places,
  relations = [],
  initialPersonId,
}: {
  people: PersonOption[];
  places: PersonOption[];
  /** Person-place links, so the form can offer the chosen person's known places. */
  relations?: { personId: string; placeId: string }[];
  initialPersonId?: string;
}) {
  const [draft, setDraft] = useState<Draft>({
    kind: 'new-person',
    personId: initialPersonId ?? '',
    proposedPersonName: '',
    proposedOccupation: '',
    title: '',
    body: '',
    context: '',
    links: [],
    anonymous: false,
    displayName: '',
    clientRequestId: '',
    receiptToken: '',
    sourceCreator: '',
    narrator: '',
    holdingInstitution: '',
    savedSubmissionId: '',
    relatedPersonIds: [],
    placeIds: [],
    eventDate: { kind: 'unknown' },
    placeName: '',
    placeScope: 'cemetery',
    placeCoordinates: null,
  });
  const [sourceKind, setSourceKind] = useState<SourceKind>('memory');
  const [newPlace, setNewPlace] = useState(false);
  // What kind of contribution this is follows from the answers, not from a chooser.
  const effectiveKind: SubmissionInput['kind'] = !draft.personId
    ? 'new-person'
    : sourceKind === 'document'
      ? 'addition'
      : 'memory';
  const knownPlaces = draft.personId
    ? places.filter((place) =>
        relations.some((link) => link.personId === draft.personId && link.placeId === place.id),
      )
    : [];
  const [privateName, setPrivateName] = useState('');
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState(false);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [phase, setPhase] = useState<'write' | 'preview' | 'sending'>('write');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [storageReady, setStorageReady] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [restored, setRestored] = useState(false);
  const [earlierReceipt, setEarlierReceipt] = useState('');
  // Once a story is sent, the debounced draft save must not write it back for the next visit.
  const finished = useRef(false);
  const [session, setSession] = useState<CommunitySession | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const imageUrls = useRef(new Set<string>());
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  async function restoreSavedPhotos(record: SubmissionRecord, receiptToken: string) {
    setSubmissionId(record.id);
    const missing = record.photos.filter(
      (photo) => !photos.some((item) => item.clientPhotoId === photo.id),
    );
    setPhotos((previous) =>
      previous.map((photo) =>
        record.photos.some((saved) => saved.id === photo.clientPhotoId)
          ? { ...photo, uploadedId: photo.clientPhotoId }
          : photo,
      ),
    );
    const recovered = await Promise.all(
      missing.map(async (photo) => {
        const preview = await privatePhotoUrl(record.id, photo.id, receiptToken);
        imageUrls.current.add(preview);
        return {
          clientPhotoId: photo.id,
          uploadedId: photo.id,
          file: null,
          name: 'Previously uploaded photograph',
          preview,
          metadata: {
            caption: photo.caption,
            creator: photo.creator,
            rights: photo.rights,
            permission: true,
          },
        } satisfies PhotoDraft;
      }),
    );
    setPhotos((previous) => [
      ...previous,
      ...recovered.filter(
        (photo) => !previous.some((item) => item.clientPhotoId === photo.clientPhotoId),
      ),
    ]);
    return recovered.length;
  }

  async function recoverSavedDraft(id: string, receiptToken: string) {
    setRecovering(true);
    setRecoveryBlocked(false);
    try {
      const result = await communityRequest<{ submission: SubmissionRecord }>(
        `/submissions/${encodeURIComponent(id)}`,
        {},
        receiptToken,
      );
      if (result.submission.status !== 'draft') {
        // The earlier story was already sent: start fresh instead of bouncing to its receipt.
        finished.current = true;
        sessionStorage.removeItem(draftKey);
        setEarlierReceipt(submissionReceiptUrl(id, receiptToken));
        setRestored(false);
        setDraft((previous) => ({
          ...previous,
          title: '',
          body: '',
          context: '',
          proposedPersonName: '',
          proposedOccupation: '',
          links: [],
          sourceCreator: '',
          narrator: '',
          holdingInstitution: '',
          savedSubmissionId: '',
          relatedPersonIds: [],
          placeIds: [],
          eventDate: { kind: 'unknown' },
          placeName: '',
          placeScope: 'cemetery',
          placeCoordinates: null,
          clientRequestId: crypto.randomUUID(),
          receiptToken: crypto.randomUUID() + crypto.randomUUID(),
        }));
        finished.current = false;
        return;
      }
      await restoreSavedPhotos(result.submission, receiptToken);
    } catch (failure) {
      setRecoveryBlocked(true);
      setError(
        failure instanceof Error
          ? failure.message
          : 'Your saved photographs could not be recovered. Please retry before submitting.',
      );
    } finally {
      setRecovering(false);
    }
  }

  useEffect(() => {
    try {
      const value = sessionStorage.getItem(draftKey);
      if (value) {
        const saved: unknown = JSON.parse(value);
        if (saved && typeof saved === 'object') {
          const candidate = saved as Partial<Draft>;
          const strings = [
            'personId',
            'proposedPersonName',
            'proposedOccupation',
            'title',
            'body',
            'context',
            'displayName',
            'sourceCreator',
            'narrator',
            'holdingInstitution',
            'savedSubmissionId',
          ] as const;
          // A person named in the URL wins over the saved draft's person: the reader arrived
          // from that person's page, and the picker must agree with the address bar. The
          // draft's places belong to its own person, so they are dropped when the person changes.
          const samePerson = !initialPersonId || candidate.personId === initialPersonId;
          setDraft((previous) => ({
            ...previous,
            ...Object.fromEntries(
              strings
                .filter((key) => typeof candidate[key] === 'string')
                .map((key) => [key, candidate[key]]),
            ),
            ...(samePerson ? {} : { personId: initialPersonId }),
            kind: 'new-person',
            anonymous: candidate.anonymous === true,
            links: restoreLinks(candidate.links),
            relatedPersonIds: linkedRecordIdsSchema.catch([]).parse(candidate.relatedPersonIds),
            placeIds: samePerson ? linkedRecordIdsSchema.catch([]).parse(candidate.placeIds) : [],
            eventDate: restoreDraftEventDate(candidate.eventDate),
            placeName: typeof candidate.placeName === 'string' ? candidate.placeName : '',
            placeScope: candidate.placeScope === 'atlanta' ? 'atlanta' : 'cemetery',
            placeCoordinates: restorePoint(candidate.placeCoordinates),
            clientRequestId:
              typeof candidate.clientRequestId === 'string'
                ? candidate.clientRequestId
                : crypto.randomUUID(),
            receiptToken:
              typeof candidate.receiptToken === 'string'
                ? candidate.receiptToken
                : crypto.randomUUID() + crypto.randomUUID(),
          }));
          setRestored(true);
          if (
            (typeof candidate.sourceCreator === 'string' && candidate.sourceCreator.trim()) ||
            (typeof candidate.holdingInstitution === 'string' &&
              candidate.holdingInstitution.trim())
          )
            setSourceKind('document');
          else if (typeof candidate.narrator === 'string' && candidate.narrator.trim())
            setSourceKind('account');
          if (candidate.savedSubmissionId && candidate.receiptToken)
            void recoverSavedDraft(candidate.savedSubmissionId, candidate.receiptToken);
        }
      } else
        setDraft((previous) => ({
          ...previous,
          clientRequestId: crypto.randomUUID(),
          receiptToken: crypto.randomUUID() + crypto.randomUUID(),
        }));
    } catch {
      setDraft((previous) => ({
        ...previous,
        clientRequestId: crypto.randomUUID(),
        receiptToken: crypto.randomUUID() + crypto.randomUUID(),
      }));
    }
    setStorageReady(true);
    communityRequest<CommunitySession>('/session')
      .then(setSession)
      .catch(() => {});
    const urls = imageUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (!storageReady || finished.current) return;
    const timer = setTimeout(() => {
      if (finished.current) return;
      try {
        sessionStorage.setItem(draftKey, JSON.stringify(draft));
        setDraftSaved(true);
      } catch {
        setDraftSaved(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [draft, storageReady]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setDraftSaved(false);
    if (fieldErrors[key]) setFieldErrors(({ [key]: _cleared, ...rest }) => rest);
  }
  const fieldClass = (name: string) => `community-field${fieldErrors[name] ? ' has-error' : ''}`;
  const FieldError = ({ name }: { name: string }) =>
    fieldErrors[name] ? (
      <small className="community-field-error" role="alert">
        {fieldErrors[name]}
      </small>
    ) : null;
  function inputValue(): SubmissionInput {
    return {
      ...draft,
      kind: effectiveKind,
      personId: draft.personId || null,
      proposedPersonName: draft.personId ? '' : draft.proposedPersonName,
      proposedOccupation: draft.personId ? '' : draft.proposedOccupation,
      privateName,
      email: email.trim(),
      permission: true,
      links: draft.links
        .map((link) => ({ title: link.title.trim() || link.url.trim(), url: link.url.trim() }))
        .filter((link) => link.url),
      placement:
        draft.placeName.trim() || draft.placeCoordinates
          ? {
              section: 'places',
              ...(draft.placeName.trim() ? { proposedPlaceName: draft.placeName.trim() } : {}),
              ...(draft.placeCoordinates
                ? { proposedCoordinates: draft.placeCoordinates, proposedScope: draft.placeScope }
                : {}),
            }
          : undefined,
    };
  }
  function validate() {
    if (photos.length > 5) {
      setError('Choose no more than five photographs, including any recovered from your draft.');
      return null;
    }
    const result = submissionInputSchema.safeParse(inputValue());
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        errors[key] ??= issue.message;
      }
      setFieldErrors(errors);
      setError('Please check the highlighted fields below.');
      return null;
    }
    setFieldErrors({});
    for (const photo of photos) {
      const checked = photoMetadataSchema.safeParse(photo.metadata);
      if (!checked.success) {
        setError(`Please complete the caption, creator, rights, and permission for ${photo.name}.`);
        return null;
      }
    }
    return result.data;
  }
  function addPhotos(files: FileList | null) {
    if (!files) return;
    const selected = [...files];
    if (photos.length + selected.length > 5) {
      setError('You can include up to five photographs. Remove one before adding another.');
      return;
    }
    const invalid = selected.find(
      (file) =>
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 10 * 1024 * 1024,
    );
    if (invalid) {
      setError(
        `${invalid.name} could not be added. Choose JPEG, PNG, or WebP files of 10 MB or less. Your other photographs and text are still here.`,
      );
      return;
    }
    setError('');
    setPhotos((previous) => [
      ...previous,
      ...selected.map((file) => {
        const preview = URL.createObjectURL(file);
        imageUrls.current.add(preview);
        return {
          clientPhotoId: crypto.randomUUID(),
          file,
          name: file.name,
          preview,
          metadata: { caption: '', creator: '', rights: '', permission: false },
        };
      }),
    ]);
  }
  function updatePhoto(index: number, patch: Partial<PhotoDraft['metadata']>) {
    setPhotos((previous) =>
      previous.map((photo, i) =>
        i === index ? { ...photo, metadata: { ...photo.metadata, ...patch } } : photo,
      ),
    );
  }
  async function removePhoto(index: number) {
    const photo = photos[index];
    if (!photo) return;
    setPhotoBusy(true);
    setError('');
    try {
      if (photo.uploadedId && submissionId)
        await communityRequest(
          `/submissions/${encodeURIComponent(submissionId)}/photos/${encodeURIComponent(photo.uploadedId)}`,
          { method: 'DELETE' },
          draft.receiptToken,
        );
      URL.revokeObjectURL(photo.preview);
      imageUrls.current.delete(photo.preview);
      setPhotos((previous) => previous.filter((item) => item.preview !== photo.preview));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'The photograph could not be removed. Please try again.',
      );
    } finally {
      setPhotoBusy(false);
    }
  }
  function preview(event: FormEvent) {
    event.preventDefault();
    if (recovering || recoveryBlocked) {
      setError('Please recover your saved photographs before reviewing this contribution.');
      return;
    }
    setError('');
    if (!validate()) return;
    setPhase('preview');
    requestAnimationFrame(() => {
      previewHeading.current?.focus();
      previewHeading.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }
  async function submit() {
    const input = validate();
    if (!input) {
      setPhase('write');
      return;
    }
    if (!permission) {
      setError(
        'Please confirm that reviewers may review this contribution and publish it with your chosen credit.',
      );
      return;
    }
    setPhase('sending');
    setError('');
    try {
      setProgress('Saving your contribution…');
      const created = submissionId
        ? { id: submissionId }
        : await communityRequest<{ id: string }>('/submissions', {
            method: 'POST',
            body: JSON.stringify({ input, receiptToken: draft.receiptToken }),
          });
      setSubmissionId(created.id);
      change('savedSubmissionId', created.id);
      try {
        sessionStorage.setItem(
          draftKey,
          JSON.stringify({ ...draft, savedSubmissionId: created.id }),
        );
      } catch {
        /* Receipt remains in memory when storage is disabled. */
      }
      const saved = await communityRequest<{ submission: SubmissionRecord }>(
        `/submissions/${encodeURIComponent(created.id)}`,
        {},
        draft.receiptToken,
      );
      if (saved.submission.status !== 'draft') {
        finished.current = true;
        try {
          sessionStorage.removeItem(draftKey);
        } catch {
          /* Draft storage may be disabled. */
        }
        window.location.assign(submissionReceiptUrl(created.id, draft.receiptToken));
        return;
      }
      const recoveredCount = await restoreSavedPhotos(saved.submission, draft.receiptToken);
      if (recoveredCount > 0) {
        setPhase('preview');
        setPermission(false);
        setError(
          'Previously uploaded photographs have been restored to the preview. Please check all photographs and confirm again before sending.',
        );
        return;
      }
      await communityRequest(
        `/submissions/${encodeURIComponent(created.id)}`,
        { method: 'PATCH', body: JSON.stringify({ input }) },
        draft.receiptToken,
      );
      for (const [index, photo] of photos.entries()) {
        if (photo.uploadedId) continue;
        if (!photo.file) throw new Error('A photograph is missing. Please choose it again.');
        setProgress(`Uploading photograph ${index + 1} of ${photos.length}…`);
        const uploaded = await uploadCommunityPhoto(
          created.id,
          photo.file,
          photo.clientPhotoId,
          photoMetadataSchema.parse(photo.metadata),
          draft.receiptToken,
        );
        photo.uploadedId = uploaded.photo.id;
        setPhotos((previous) =>
          previous.map((item) =>
            item.preview === photo.preview ? { ...item, uploadedId: uploaded.photo.id } : item,
          ),
        );
      }
      setProgress('Sending for review…');
      await communityRequest(
        `/submissions/${encodeURIComponent(created.id)}/submit`,
        { method: 'POST' },
        draft.receiptToken,
      );
      finished.current = true;
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* Draft storage may be disabled. */
      }
      window.location.assign(submissionReceiptUrl(created.id, draft.receiptToken));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'We could not send your contribution. Your text and photographs are still here; please try again.',
      );
      setPhase('preview');
    }
  }

  const personName = !draft.personId
    ? draft.proposedPersonName
    : (people.find((person) => person.id === draft.personId)?.name ?? draft.proposedPersonName);
  const signInNext = safeCommunityNext(
    draft.personId ? `/contribute?person=${encodeURIComponent(draft.personId)}` : '/contribute',
  );
  return (
    <div className="community-grid">
      <div>
        <div ref={errorRef} tabIndex={-1}>
          {error && (
            <CommunityNotice kind="error" title="Your contribution has not been submitted">
              {error}
            </CommunityNotice>
          )}
        </div>
        {session?.mode === 'fixture' && (
          <CommunityNotice title="This archive is in read-only mode">
            You can prepare your story here, but submissions are not available until contribution
            storage is configured.
          </CommunityNotice>
        )}
        {earlierReceipt && (
          <CommunityNotice title="Your earlier story was already sent">
            This form is now empty for a new story.{' '}
            <Link href={earlierReceipt}>Open the private receipt of the earlier one</Link>.
          </CommunityNotice>
        )}
        {restored && phase === 'write' && (
          <CommunityNotice title="Your draft text is here">
            We restored your text from this browser tab. Please re-enter your private contact
            details. Uploaded photographs are recovered from your private draft; files not yet
            uploaded must be chosen again.
          </CommunityNotice>
        )}
        {recovering && (
          <div className="community-loading" role="status">
            <LoaderCircle className="community-spinner" size={20} /> Recovering your saved
            photographs…
          </div>
        )}
        {recoveryBlocked && draft.savedSubmissionId && (
          <CommunityNotice title="Check the saved draft before continuing">
            <p>
              Your saved photographs could not be displayed. Sending is paused so no image is
              included without appearing in your preview.
            </p>
            <div className="community-actions">
              <button
                className="community-secondary"
                onClick={() => recoverSavedDraft(draft.savedSubmissionId, draft.receiptToken)}
              >
                Retry recovery
              </button>
              <Link
                className="community-text-button"
                href={submissionReceiptUrl(draft.savedSubmissionId, draft.receiptToken)}
              >
                Open private draft receipt
              </Link>
            </div>
          </CommunityNotice>
        )}
        {phase === 'write' ? (
          <form className="community-form" onSubmit={preview} noValidate>
            <p className="community-legend">{copy.requiredLegend}</p>
            <section className="community-section">
              <div className="community-section-heading">
                <span className="community-step">01</span>
                <h2>Who are you adding, and what do you know?</h2>
              </div>
              <div className="community-fields">
                <RecordPicker
                  label="Who is this about?"
                  options={people}
                  value={draft.personId ? [draft.personId] : []}
                  onChange={(ids) => {
                    const personId = ids[0] ?? '';
                    change('personId', personId);
                    change('placeIds', []);
                    // Keep the address bar honest so a reload or a shared link opens the same person.
                    window.history.replaceState(
                      null,
                      '',
                      personId
                        ? `/contribute?person=${encodeURIComponent(personId)}`
                        : '/contribute',
                    );
                  }}
                  placeholder="Search names or alternate names…"
                  emptyLabel="Someone not listed here"
                />
                {draft.personId ? (
                  <p className="community-hint community-person-hint">
                    Everything you add here is reviewed and then shown on {personName}’s page. You
                    can also{' '}
                    <Link href={`/people/${encodeURIComponent(draft.personId)}?edit=1`}>
                      add it right on their page
                    </Link>
                    , next to the paragraph or place it belongs to.
                  </p>
                ) : (
                  <label className={fieldClass('proposedPersonName')}>
                    <span>
                      Their name, if they are not in the archive yet{' '}
                      <span className="community-required">*</span>
                    </span>
                    <input
                      value={draft.proposedPersonName}
                      onChange={(event) => change('proposedPersonName', event.target.value)}
                      required
                      maxLength={160}
                      placeholder="e.g. Mary Johnson"
                    />
                    <FieldError name="proposedPersonName" />
                    <small>
                      Use the name you know. Reviewers can help with name variations and
                      identification.
                    </small>
                  </label>
                )}
                {!draft.personId && (
                  <label className={fieldClass('proposedOccupation')}>
                    <span>What did they do? (optional)</span>
                    <input
                      value={draft.proposedOccupation}
                      onChange={(event) => change('proposedOccupation', event.target.value)}
                      maxLength={160}
                      placeholder="e.g. Teacher, Pastor, Nurse"
                    />
                    <FieldError name="proposedOccupation" />
                    <small>
                      Their occupation or role, as you know it. Reviewers add it as a tag.
                    </small>
                  </label>
                )}
                <label className={fieldClass('title')}>
                  <span>
                    Title <span className="community-required">*</span>
                  </span>
                  <input
                    value={draft.title}
                    onChange={(event) => change('title', event.target.value)}
                    required
                    minLength={3}
                    maxLength={160}
                    placeholder="e.g. Sunday visits to the family plot"
                  />
                  <FieldError name="title" />
                </label>
                <label className={fieldClass('body')}>
                  <span>
                    {effectiveKind === 'memory' ? 'Your memory' : 'Your story or contribution'}{' '}
                    <span className="community-required">*</span>
                  </span>
                  <textarea
                    value={draft.body}
                    onChange={(event) => change('body', event.target.value)}
                    required
                    minLength={20}
                    maxLength={20000}
                    rows={9}
                    placeholder="Tell it in your own words. What do you remember, or what would you like others to know?"
                  />
                  <FieldError name="body" />
                  <small>
                    {draft.body.length.toLocaleString()} / 20,000 characters. A memory can be
                    personal; it does not need to be proven.
                  </small>
                </label>
                <label className="community-field">
                  <span>
                    How do you know this story? <span className="community-hint">(optional)</span>
                  </span>
                  <textarea
                    value={draft.context}
                    onChange={(event) => change('context', event.target.value)}
                    maxLength={4000}
                    rows={3}
                    placeholder="e.g. She was my great-aunt; my mother told me this at family reunions."
                  />
                  <small>
                    This context helps readers understand the perspective behind the contribution.
                    It may be shown publicly.
                  </small>
                </label>
                <fieldset className="community-fieldset source-kind">
                  <legend>How do you know this?</legend>
                  <div className="source-kind-options">
                    {sourceKinds.map((option) => (
                      <label className="source-kind-option" key={option.value}>
                        <input
                          type="radio"
                          name="source-kind"
                          value={option.value}
                          checked={sourceKind === option.value}
                          onChange={() => setSourceKind(option.value)}
                        />
                        <span>
                          <strong>{option.title}</strong>
                          <small>{option.text}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="community-fields" style={{ margin: '16px 0' }}>
                    {sourceKind === 'memory' && (
                      <p className="community-section-note">
                        A memory needs no document. Say who you are to this person in the box above,
                        so readers understand the perspective.
                      </p>
                    )}
                    {sourceKind === 'document' && (
                      <label className="community-field">
                        <span>
                          Original author or creator{' '}
                          <span className="community-hint">(optional)</span>
                        </span>
                        <input
                          value={draft.sourceCreator}
                          onChange={(event) => change('sourceCreator', event.target.value)}
                          maxLength={200}
                          placeholder="e.g. Atlanta Daily World, 1952"
                        />
                        <small>Who originally wrote, created, or recorded this material?</small>
                      </label>
                    )}
                    {sourceKind === 'account' && (
                      <label className="community-field">
                        <span>
                          Who told you? <span className="community-hint">(optional)</span>
                        </span>
                        <input
                          value={draft.narrator}
                          onChange={(event) => change('narrator', event.target.value)}
                          maxLength={200}
                          placeholder="e.g. My grandmother, Ruth Hill"
                        />
                        <small>Only if the account was told by somebody other than you.</small>
                      </label>
                    )}
                    {sourceKind === 'document' && (
                      <label className="community-field">
                        <span>
                          Where the material is kept{' '}
                          <span className="community-hint">(optional)</span>
                        </span>
                        <input
                          value={draft.holdingInstitution}
                          onChange={(event) => change('holdingInstitution', event.target.value)}
                          maxLength={200}
                          placeholder="e.g. Auburn Avenue Research Library, or a family album"
                        />
                      </label>
                    )}
                    {sourceKind !== 'memory' && (
                      <div className={fieldClass('links')}>
                        <span>
                          Links to sources <span className="community-hint">(optional)</span>
                        </span>
                        {draft.links.map((link, index) => (
                          <div className="community-link-row" key={index}>
                            <input
                              aria-label={`Link ${index + 1} title`}
                              value={link.title}
                              maxLength={200}
                              placeholder="What is it? e.g. Obituary, 1968"
                              onChange={(event) =>
                                change(
                                  'links',
                                  draft.links.map((item, i) =>
                                    i === index ? { ...item, title: event.target.value } : item,
                                  ),
                                )
                              }
                            />
                            <input
                              aria-label={`Link ${index + 1} address`}
                              type="url"
                              inputMode="url"
                              value={link.url}
                              placeholder="https://"
                              onChange={(event) =>
                                change(
                                  'links',
                                  draft.links.map((item, i) =>
                                    i === index ? { ...item, url: event.target.value } : item,
                                  ),
                                )
                              }
                            />
                            <button
                              className="community-text-button"
                              type="button"
                              aria-label={`Remove link ${index + 1}`}
                              onClick={() =>
                                change(
                                  'links',
                                  draft.links.filter((_, i) => i !== index),
                                )
                              }
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                        <FieldError name="links" />
                        {draft.links.length < 10 && (
                          <button
                            className="community-text-button"
                            type="button"
                            onClick={() =>
                              change('links', [...draft.links, { title: '', url: '' }])
                            }
                          >
                            <Plus size={15} aria-hidden="true" /> Add a link
                          </button>
                        )}
                        <small>
                          A web page, catalogue record, or article that supports this story.
                        </small>
                      </div>
                    )}
                  </div>
                </fieldset>
                <div className="community-field">
                  <span>
                    {knownPlaces.length
                      ? 'Is this about one of their places?'
                      : 'Where are they buried, or a place from their life'}{' '}
                    <span className="community-hint">(optional)</span>
                  </span>
                  {knownPlaces.length > 0 && (
                    <div className="community-place-choices">
                      {knownPlaces.map((place) => (
                        <label className="community-check" key={place.id}>
                          <input
                            type="checkbox"
                            checked={draft.placeIds.includes(place.id)}
                            onChange={(event) =>
                              change(
                                'placeIds',
                                event.target.checked
                                  ? [...draft.placeIds, place.id]
                                  : draft.placeIds.filter((id) => id !== place.id),
                              )
                            }
                          />
                          <span>
                            {place.name}
                            <small>
                              {place.scope === 'cemetery' ? 'South-View Cemetery' : 'Atlanta'}
                            </small>
                          </span>
                        </label>
                      ))}
                      <label className="community-check">
                        <input
                          type="checkbox"
                          checked={newPlace}
                          onChange={(event) => {
                            setNewPlace(event.target.checked);
                            if (!event.target.checked) {
                              change('placeName', '');
                              change('placeCoordinates', null);
                            }
                          }}
                        />
                        <span>A place not listed here</span>
                      </label>
                    </div>
                  )}
                  {(!knownPlaces.length || newPlace) && (
                    <>
                      <input
                        value={draft.placeName}
                        onChange={(event) => change('placeName', event.target.value)}
                        maxLength={160}
                        placeholder="e.g. Section C, South-View Cemetery, or Wheat Street Baptist Church"
                        aria-label="Place name"
                      />
                      <LocationPicker
                        value={
                          draft.placeCoordinates
                            ? { coordinates: draft.placeCoordinates, scope: draft.placeScope }
                            : null
                        }
                        onChange={(picked) => {
                          change('placeCoordinates', picked?.coordinates ?? null);
                          if (picked) change('placeScope', picked.scope);
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            </section>
            <details className="story-context-details community-more">
              <summary>
                Add more{' '}
                <span className="community-hint">
                  (optional: photographs, other people, when it happened)
                </span>
              </summary>
              <div className="community-fields" style={{ margin: '16px 0 0' }}>
                <StoryContextFields
                  people={people}
                  places={places}
                  primaryPersonId={draft.personId}
                  value={draft}
                  showPlaces={false}
                  onChange={(context) => {
                    setDraft((previous) => ({ ...previous, ...context }));
                    setDraftSaved(false);
                  }}
                />
              </div>
              <section className="community-section">
                <div className="community-section-heading">
                  <h2>
                    Photographs <span className="community-hint">(optional)</span>
                  </h2>
                </div>
                <p className="community-section-note">
                  Up to five JPEG, PNG, or WebP images, no more than 10 MB each. A portrait is
                  welcome. Each photograph needs a caption, a creator, and your permission.
                </p>
                <div className="community-upload">
                  <ImagePlus size={30} strokeWidth={1.3} />
                  <strong>A face, a place, a moment remembered.</strong>
                  <p className="community-hint">
                    Include only photographs you have permission to share.
                  </p>
                  <input
                    aria-label="Choose photographs"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={(event) => {
                      addPhotos(event.target.files);
                      event.target.value = '';
                    }}
                    disabled={photos.length >= 5 || recovering || recoveryBlocked}
                  />
                </div>
                <div className="community-photo-list">
                  {photos.map((photo, index) => (
                    <div className="community-photo" key={photo.preview}>
                      <img src={photo.preview} alt={`Your selected photograph ${index + 1}`} />
                      <div className="community-photo-meta">
                        <strong>{photo.name}</strong>
                        {photo.uploadedId && (
                          <p className="community-hint">
                            Saved to your private draft. Remove and add it again to change its
                            caption or permissions.
                          </p>
                        )}
                        <label className="community-field">
                          <span>Caption *</span>
                          <input
                            disabled={Boolean(photo.uploadedId)}
                            value={photo.metadata.caption}
                            onChange={(event) =>
                              updatePhoto(index, { caption: event.target.value })
                            }
                            required
                            maxLength={500}
                            placeholder="e.g. The Hill family at the South-View gate, about 1960"
                          />
                        </label>
                        <label className="community-field">
                          <span>Photographer or creator *</span>
                          <input
                            disabled={Boolean(photo.uploadedId)}
                            value={photo.metadata.creator}
                            onChange={(event) =>
                              updatePhoto(index, { creator: event.target.value })
                            }
                            required
                            maxLength={160}
                            placeholder="e.g. Ruth Hill, or “family collection”, or “unknown”"
                          />
                        </label>
                        <label className="community-field">
                          <span>Rights and permission *</span>
                          <input
                            disabled={Boolean(photo.uploadedId)}
                            value={photo.metadata.rights}
                            onChange={(event) => updatePhoto(index, { rights: event.target.value })}
                            required
                            maxLength={1000}
                            placeholder="e.g. Owned by our family; South-View may display it online"
                          />
                        </label>
                        <label className="community-check" style={{ marginTop: 14 }}>
                          <input
                            disabled={Boolean(photo.uploadedId)}
                            type="checkbox"
                            checked={photo.metadata.permission}
                            onChange={(event) =>
                              updatePhoto(index, { permission: event.target.checked })
                            }
                            required
                          />
                          <span>I have permission for South-View to display this photograph.</span>
                        </label>
                        <button
                          className="community-text-button"
                          type="button"
                          disabled={photoBusy}
                          onClick={() => removePhoto(index)}
                        >
                          <Trash2 size={14} aria-hidden="true" /> Remove photograph
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </details>
            <section className="community-section">
              <div className="community-section-heading">
                <span className="community-step">02</span>
                <h2>Your name and your public credit</h2>
              </div>
              <div className="community-fields">
                <div className="community-two-columns">
                  <label className={fieldClass('privateName')}>
                    <span>
                      Your name <span className="community-required">*</span>
                    </span>
                    <input
                      value={privateName}
                      onChange={(event) => {
                        setPrivateName(event.target.value);
                        if (fieldErrors.privateName)
                          setFieldErrors(({ privateName: _c, ...rest }) => rest);
                      }}
                      placeholder="e.g. Ruth Hill"
                      required
                      minLength={2}
                      maxLength={160}
                      autoComplete="name"
                    />
                    <FieldError name="privateName" />
                    <small>Private. Used by the review team.</small>
                  </label>
                  <label className={fieldClass('email')}>
                    <span>
                      Email address <span className="community-required">*</span>
                    </span>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        if (fieldErrors.email) setFieldErrors(({ email: _c, ...rest }) => rest);
                      }}
                      placeholder="e.g. ruth@example.org"
                      required
                      autoComplete="email"
                    />
                    <FieldError name="email" />
                    <small>
                      Private. Reviewers may use it to reach you; the archive itself sends no email.
                    </small>
                  </label>
                </div>
                <label className="community-check">
                  <input
                    type="checkbox"
                    checked={draft.anonymous}
                    onChange={(event) => change('anonymous', event.target.checked)}
                  />
                  <span>
                    Publish my contribution anonymously.
                    <small>Reviewers can still contact you privately about the contribution.</small>
                  </span>
                </label>
                {!draft.anonymous && (
                  <label className={fieldClass('displayName')}>
                    <span>
                      Public display name <span className="community-required">*</span>
                    </span>
                    <input
                      value={draft.displayName}
                      onChange={(event) => change('displayName', event.target.value)}
                      required
                      maxLength={160}
                      placeholder="e.g. The Hill family, or R. Hill"
                    />
                    <FieldError name="displayName" />
                    <small>Only this name appears in the public contributor credit.</small>
                  </label>
                )}
              </div>
            </section>
            <div className="community-actions">
              <button className="community-primary" type="submit">
                {copy.reviewStory} <ArrowRight size={17} />
              </button>
              <span className="community-draft">
                {draftSaved && <Check size={14} />}
                {draftSaved
                  ? 'Draft text saved in this tab'
                  : 'Your contact details and photos stay unsaved'}
              </span>
            </div>
          </form>
        ) : (
          <div className="community-preview">
            <p className="community-preview-label">Review before you send</p>
            <h2 ref={previewHeading} tabIndex={-1}>
              {draft.title}
            </h2>
            <div className="community-review-line">
              <strong>About</strong>
              {personName}
            </div>
            <div className="community-review-line">
              <strong>Contribution type</strong>
              {kinds.find((kind) => kind.value === effectiveKind)?.title}
            </div>
            <p className="community-body">{draft.body}</p>
            <div className="community-review-line">
              <strong>Event date</strong>
              {formatEventDate(draft.eventDate)}
            </div>
            {draft.relatedPersonIds.length > 0 && (
              <div className="community-review-line">
                <strong>Other people mentioned</strong>
                {people
                  .filter(
                    (person) =>
                      draft.relatedPersonIds.includes(person.id) && person.id !== draft.personId,
                  )
                  .map((person) => person.name)
                  .join('; ')}
              </div>
            )}
            {draft.placeIds.length > 0 && (
              <div className="community-review-line">
                <strong>Places mentioned</strong>
                {places
                  .filter((place) => draft.placeIds.includes(place.id))
                  .map((place) => place.name)
                  .join('; ')}
              </div>
            )}
            {(draft.placeName.trim() || draft.placeCoordinates) && (
              <div className="community-review-line">
                <strong>Place</strong>
                {[
                  draft.placeName.trim(),
                  draft.placeCoordinates
                    ? `pin at ${draft.placeCoordinates[1].toFixed(5)}, ${draft.placeCoordinates[0].toFixed(5)} (${draft.placeScope === 'cemetery' ? 'South-View Cemetery' : 'Atlanta'})`
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            )}
            <div className="community-review-line">
              <strong>How you know this</strong>
              {sourceKinds.find((option) => option.value === sourceKind)?.title}
            </div>
            {draft.context && (
              <div className="community-review-line">
                <strong>Context</strong>
                {draft.context}
              </div>
            )}
            {draft.links.some((link) => link.url.trim()) && (
              <div className="community-review-line">
                <strong>Links to sources</strong>
                {draft.links
                  .filter((link) => link.url.trim())
                  .map((link) => link.title.trim() || link.url.trim())
                  .join('; ')}
              </div>
            )}
            {draft.sourceCreator && (
              <div className="community-review-line">
                <strong>Original author or creator</strong>
                {draft.sourceCreator}
              </div>
            )}
            {draft.narrator && (
              <div className="community-review-line">
                <strong>Narrator</strong>
                {draft.narrator}
              </div>
            )}
            {draft.holdingInstitution && (
              <div className="community-review-line">
                <strong>Holding institution or collection</strong>
                {draft.holdingInstitution}
              </div>
            )}
            <div className="community-review-line">
              <strong>Public credit</strong>
              {draft.anonymous ? 'Anonymous contributor' : draft.displayName}
            </div>
            <div className="community-review-line">
              <strong>Photographs</strong>
              {photos.length} included, each with its caption and rights information
            </div>
            {photos.length > 0 && (
              <div className="community-gallery">
                {photos.map((photo) => (
                  <figure key={photo.preview}>
                    <img src={photo.preview} alt={photo.metadata.caption} />
                    <figcaption>
                      <strong>{photo.metadata.caption}</strong>
                      <br />
                      Creator: {photo.metadata.creator}
                      <br />
                      Rights: {photo.metadata.rights}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            <div className="community-review-line">
              <strong>Private contact</strong>
              {privateName} · {email}
            </div>
            <CommunityNotice title="No email will be sent">{copy.noEmail}</CommunityNotice>
            <label className="community-check" style={{ marginTop: 25 }}>
              <input
                type="checkbox"
                checked={permission}
                onChange={(event) => setPermission(event.target.checked)}
              />
              <span>
                I give South-View permission to review this contribution and display the approved
                text and photographs with the public credit shown above.
                <small>
                  Archive reviewers check every contribution before it becomes public. Your private
                  name and email address will not be displayed.
                </small>
              </span>
            </label>
            <div className="community-actions">
              <button
                className="community-primary"
                type="button"
                disabled={
                  phase === 'sending' ||
                  !permission ||
                  photoBusy ||
                  recovering ||
                  recoveryBlocked ||
                  session?.mode === 'fixture'
                }
                onClick={submit}
              >
                {phase === 'sending' ? (
                  <>
                    <LoaderCircle size={17} className="community-spinner" />{' '}
                    {progress || copy.sending}
                  </>
                ) : (
                  <>
                    {copy.sendStory} <ArrowRight size={17} />
                  </>
                )}
              </button>
              <button
                className="community-secondary"
                type="button"
                disabled={phase === 'sending'}
                onClick={() => {
                  setPhase('write');
                  setError('');
                }}
              >
                <ArrowLeft size={16} /> Keep editing
              </button>
            </div>
          </div>
        )}
      </div>
      <aside className="community-sidebar">
        <div className="community-aside-card">
          <Sprout size={28} strokeWidth={1.2} />
          <h2>History grows through people.</h2>
          <p>
            A family photograph. A story told at the kitchen table. A detail that deserves to be
            remembered.
          </p>
          <ol>
            <li>Share what you know, in your own words.</li>
            <li>Save the private link shown after sending; it is your only receipt.</li>
            <li>Reviewers may ask for more context on that page.</li>
            <li>Approved stories join the archive with clear credit.</li>
          </ol>
        </div>
        <div className="community-aside-card">
          <LockKeyhole size={23} strokeWidth={1.3} />
          <h2>Your story, your credit.</h2>
          <p>
            Your contact details stay private. You can use a public display name or be credited
            anonymously.
          </p>
        </div>
        <p className="community-aside-note">
          No account is required.{' '}
          <Link href={`/sign-in?next=${encodeURIComponent(signInNext)}`}>Sign in</Link> if you would
          like to keep your contributions together.
        </p>
        <p className="community-aside-note community-aside-note-icon">
          <BookOpen size={16} aria-hidden="true" />
          <span>
            Memories retain their context. They are not presented as independently documented facts.
          </span>
        </p>
      </aside>
    </div>
  );
}
