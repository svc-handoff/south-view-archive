'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  Inbox,
  LoaderCircle,
  RefreshCw,
  MapPin,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  reviewInputSchema,
  type ArchiveData,
  type ReviewInput,
  type SubmissionRecord,
  type VetOverview,
} from '@southview/validators';
import { communityRequest, signOutCommunity, type CommunitySession } from '@/lib/community-client';
import { formatReviewIssues } from '@/lib/review-validation';
import {
  filterReviewQueue,
  kindLabels,
  parseReviewState,
  reviewLabels,
  reviewUrl,
  selectedReview,
  submissionPerson,
  vetState,
  type VetState,
  type ReviewState,
  adminRecordUrl,
  parseAdminPath,
  type AdminTab,
} from '@/lib/review-state';
import { CommunityNotice } from './community-shell';
import { PeopleAdmin } from './people-admin';
import { PlacesAdmin } from './places-admin';
import { useAdminArchive } from './admin-data';
import { StoryContextFields } from './story-context-fields';
import { RecordPicker } from './record-picker';
import { PrivateSubmissionPhoto } from './submission-manager';
import {
  OriginalSubmission,
  ReviewActions,
  ReviewDialog,
  ReviewHistory,
  ReviewQueue,
  ReviewStats,
  VetPanel,
} from './review-panels';

type PlaceDraft = {
  id: string;
  name: string;
  scope: 'cemetery' | 'atlanta';
  lng: string;
  lat: string;
  precision: 'reference' | 'address' | 'verified' | 'unmapped';
  note: string;
  relationship: string;
  summary: string;
};
type PersonFields = {
  name: string;
  aliases: string;
  birthYear: string;
  deathYear: string;
  themes: string;
  occupations: string;
  summary: string;
};
type PersonPatch = NonNullable<ReviewInput['personPatch']>;
/** The person record as stored; a new person starts from the defaults publication would use. */
function personFieldsFor(personId: string, archive: ArchiveData): PersonFields {
  const person = archive.people.find((item) => item.id === personId);
  return {
    name: person?.name ?? '',
    aliases: person?.aliases.join(', ') ?? '',
    birthYear: person?.birthYear ? String(person.birthYear) : '',
    deathYear: person?.deathYear ? String(person.deathYear) : '',
    themes: person ? person.themes.join(', ') : 'Community',
    occupations: (person?.occupations ?? []).join(', '),
    summary: person?.summary ?? '',
  };
}
const splitList = (value: string) =>
  value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
/** Only fields the reviewer changed are sent, so untouched values stay exactly as stored. */
function personPatchFor(
  fields: PersonFields,
  initial: PersonFields,
  existing: boolean,
): PersonPatch | undefined {
  const patch: PersonPatch = {};
  if (existing && fields.name.trim() && fields.name.trim() !== initial.name)
    patch.name = fields.name.trim();
  if (fields.aliases !== initial.aliases) patch.aliases = splitList(fields.aliases);
  if (fields.birthYear.trim() !== initial.birthYear)
    patch.birthYear = fields.birthYear.trim() ? Number(fields.birthYear) : null;
  if (fields.deathYear.trim() !== initial.deathYear)
    patch.deathYear = fields.deathYear.trim() ? Number(fields.deathYear) : null;
  if (fields.themes !== initial.themes) patch.themes = splitList(fields.themes);
  if (fields.occupations !== initial.occupations) patch.occupations = splitList(fields.occupations);
  if (fields.summary.trim() && fields.summary.trim() !== initial.summary)
    patch.summary = fields.summary.trim();
  return Object.keys(patch).length ? patch : undefined;
}
const personFieldLabels: Record<keyof PersonPatch, string> = {
  name: 'name',
  aliases: 'other names',
  birthYear: 'birth year',
  deathYear: 'death year',
  birthDate: 'full birth date',
  deathDate: 'full death date',
  themes: 'themes',
  occupations: 'occupations',
  summary: 'summary',
};
/** In-page additions say where they belong; the desk starts there so one click publishes them. */
function defaultApplyTo(record: SubmissionRecord): ReviewInput['applyTo'] {
  const placement = record.input.placement;
  if (!placement || record.input.kind === 'memory' || record.status === 'published') return 'entry';
  if (placement.section === 'biography') return 'biography';
  if (placement.section === 'places') return 'place';
  if (placement.section === 'portrait') return 'portrait';
  return 'entry';
}
const unmappedNote = 'No position has been verified; the place is listed without a map marker.';
function initialPlace(record: SubmissionRecord, archive: ArchiveData): PlaceDraft {
  // A publishable draft from the start: the schema requires a note and a relationship.
  const empty: PlaceDraft = {
    id: '',
    name: '',
    scope: 'cemetery',
    lng: '',
    lat: '',
    precision: 'unmapped',
    note: unmappedNote,
    relationship: record.input.title,
    summary: '',
  };
  const placement = record.input.placement;
  if (placement?.section !== 'places') return empty;
  const existing = archive.places.find((place) => record.input.placeIds.includes(place.id));
  if (existing) {
    const moved = placement.proposedCoordinates;
    const relation = archive.relations.find((item) => item.id === placement.blockId);
    return {
      id: existing.id,
      name: placement.proposedPlaceName ?? existing.name,
      scope: placement.proposedScope ?? existing.scope,
      lng: moved ? String(moved[0]) : existing.coordinates ? String(existing.coordinates[0]) : '',
      lat: moved ? String(moved[1]) : existing.coordinates ? String(existing.coordinates[1]) : '',
      precision: moved ? 'reference' : existing.precision,
      note: moved
        ? `Position moved by the contributor; not independently verified. Previously: ${existing.locationNote}`
        : existing.locationNote,
      relationship: relation?.label ?? record.input.title,
      summary: placement.proposedPlaceSummary ?? existing.summary,
    };
  }
  const coordinates = placement.proposedCoordinates;
  return {
    ...empty,
    name: placement.proposedPlaceName ?? '',
    scope: placement.proposedScope ?? 'cemetery',
    lng: coordinates ? String(coordinates[0]) : '',
    lat: coordinates ? String(coordinates[1]) : '',
    precision: coordinates ? 'reference' : 'unmapped',
    note: coordinates
      ? 'Position marked on the map by the contributor; not independently verified.'
      : unmappedNote,
    relationship: record.input.title,
    summary: placement.proposedPlaceSummary ?? '',
  };
}
function placementExplanation(record: SubmissionRecord, applyTo: ReviewInput['applyTo']) {
  const placement = record.input.placement;
  if (!placement) return '';
  if (placement.section === 'biography' && placement.blockId) {
    const where =
      record.input.kind === 'correction'
        ? 'edited an existing paragraph in place. Publishing to the biography replaces that paragraph with the text above'
        : 'wrote this under a specific paragraph. Publishing to the biography inserts it right after that paragraph';
    return `The contributor ${where}${applyTo === 'biography' ? '.' : '; the current choice keeps it as a separate entry.'}`;
  }
  if (placement.section === 'places' && record.input.kind === 'correction') {
    const changes = [
      placement.proposedPlaceName ? 'renamed it' : '',
      placement.proposedCoordinates ? 'moved its pin' : '',
      placement.proposedPlaceSummary ? 'described the place itself' : '',
      placement.originalText ? 'rewrote how it relates to this person' : '',
    ].filter(Boolean);
    return `The contributor edited an existing place in place${changes.length ? ` and ${changes.join(', ')}` : ''}. Publishing as a map place update changes that place and its link to this person; the earlier version stays recoverable by withdrawal.`;
  }
  if (placement.section === 'places')
    return placement.proposedCoordinates
      ? 'The contributor marked this place on the map. Its position is filled in below for you to confirm.'
      : 'The contributor added this as a place on the person page. Its details are filled in below.';
  if (placement.section === 'portrait')
    return applyTo === 'portrait'
      ? 'The contributor offered this photograph as a portrait. Publishing as the portrait puts the first approved photograph at the top of the person page.'
      : 'The contributor offered this photograph as a portrait; the current choice keeps it as a separate entry.';
  return '';
}

export function ReviewDesk({
  archive,
  initialTab,
  initialRecordId,
}: {
  archive: ArchiveData;
  initialTab: AdminTab;
  initialRecordId: string | null;
}) {
  const params = useSearchParams();
  const [state, setState] = useState(() => parseReviewState(params));
  // The admin has two areas: the contribution queue and direct record corrections.
  const [tab, setTab] = useState<AdminTab>(initialTab);
  const [adminPerson, setAdminPerson] = useState<string | null>(
    initialTab === 'people' ? initialRecordId : null,
  );
  const [adminEntry, setAdminEntry] = useState<string | null>(null);
  const [adminPlace, setAdminPlace] = useState<string | null>(
    initialTab === 'places' ? initialRecordId : null,
  );
  // Server data with every change saved during this visit applied, shared by the record tabs.
  const admin = useAdminArchive(archive);
  // Bumped when another tab opens a record, so the record tab starts on it.
  const [nav, setNav] = useState(0);
  const [session, setSession] = useState<CommunitySession | null>(null);
  const [items, setItems] = useState<SubmissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mobileDetail, setMobileDetail] = useState(!!state.submission);
  const [revision, setRevision] = useState(0);
  const [vet, setVet] = useState<VetOverview | null>(null);
  const [vetError, setVetError] = useState('');
  const [startingVet, setStartingVet] = useState<string | null>(null);
  const vetLock = useRef(false);
  const loadVet = useCallback(async () => {
    try {
      setVet(await communityRequest<VetOverview>('/review/vet'));
      setVetError('');
    } catch (failure) {
      setVetError(
        failure instanceof Error ? failure.message : 'AI check status could not be loaded.',
      );
    }
  }, []);
  async function runCheck(id: string) {
    if (vetLock.current || vet?.runningSubmissionId || !vet?.configured) return;
    vetLock.current = true;
    setStartingVet(id);
    setVetError('');
    try {
      setVet(await communityRequest<VetOverview>(`/review/${id}/vet`, { method: 'POST' }));
    } catch (failure) {
      await loadVet();
      setVetError(
        failure instanceof Error ? failure.message : 'The AI check could not be completed.',
      );
    } finally {
      vetLock.current = false;
      setStartingVet(null);
    }
  }
  useEffect(() => {
    if (!vet?.runningSubmissionId || startingVet) return;
    const timer = window.setInterval(() => {
      void loadVet();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [vet?.runningSubmissionId, startingVet, loadVet]);
  const dirty = useRef(false);
  const currentUrl = useRef('');
  const onDirtyChange = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const confirmLeave = useCallback(
    () => !dirty.current || window.confirm('Discard your unsaved review edits?'),
    [],
  );
  async function load() {
    setLoading(true);
    setError('');
    try {
      const access = await communityRequest<CommunitySession>('/session');
      setSession(access);
      if (access.reviewer) {
        const result = await communityRequest<{ submissions: SubmissionRecord[] }>('/review');
        setItems(result.submissions);
        setRevision((value) => value + 1);
        setLoaded(true);
        dirty.current = false;
        void loadVet();
      } else {
        setItems([]);
        setVet(null);
        setLoaded(false);
        dirty.current = false;
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'The review queue could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    currentUrl.current = window.location.href;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.('a');
      if (
        !anchor ||
        anchor.target === '_blank' ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0 ||
        anchor.href === window.location.href
      )
        return;
      if (!confirmLeave()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const pop = (event: PopStateEvent) => {
      if (!confirmLeave()) {
        event.stopImmediatePropagation();
        window.history.pushState(null, '', currentUrl.current);
      } else {
        if (dirty.current) setRevision((value) => value + 1);
        dirty.current = false;
        const search = new URLSearchParams(window.location.search);
        const next = parseReviewState(search);
        const location = parseAdminPath(window.location.pathname);
        setTab(location.tab);
        if (location.tab === 'people') setAdminPerson(location.recordId);
        if (location.tab === 'places') setAdminPlace(location.recordId);
        setNav((value) => value + 1);
        setState(next);
        setMobileDetail(!!next.submission);
        currentUrl.current = window.location.href;
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', navigate, true);
    window.addEventListener('popstate', pop, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', navigate, true);
      window.removeEventListener('popstate', pop, true);
    };
  }, [confirmLeave]);
  function update(patch: Partial<ReviewState>, selecting = false) {
    const next = { ...state, ...patch, submission: selecting ? (patch.submission ?? null) : null };
    if (selecting && next.submission === state.submission) {
      setMobileDetail(true);
      return;
    }
    const discarding = dirty.current;
    if (next.submission !== state.submission && !confirmLeave()) return;
    dirty.current = false;
    if (discarding) setRevision((value) => value + 1);
    setState(next);
    setNotice('');
    if (selecting) setMobileDetail(true);
    window.history.replaceState(null, '', reviewUrl(next));
    currentUrl.current = window.location.href;
  }
  const visible = filterReviewQueue(items, state, archive);
  const selected = selectedReview(items, visible, state.submission);
  const recordUrl = adminRecordUrl;
  function go(next: AdminTab, recordId?: string) {
    if (next === 'people' && recordId !== undefined) setAdminPerson(recordId);
    if (next === 'places' && recordId !== undefined) setAdminPlace(recordId);
    setTab(next);
    setNav((value) => value + 1);
    setNotice('');
    window.history.replaceState(
      null,
      '',
      next === 'contributions'
        ? reviewUrl(state)
        : recordUrl(next, recordId ?? (next === 'people' ? adminPerson : adminPlace)),
    );
    currentUrl.current = window.location.href;
  }
  // The page title follows the area, as it would on a fresh load of that address.
  useEffect(() => {
    document.title = `${tab === 'people' ? 'People · ' : tab === 'places' ? 'Places · ' : ''}Archive admin · South-View`;
  }, [tab]);
  function switchTab(next: AdminTab) {
    if (next === tab || !confirmLeave()) return;
    dirty.current = false;
    go(next);
  }
  useEffect(() => {
    if (tab === 'contributions' && selected && !state.submission) {
      const next = { ...state, submission: selected.id };
      setState(next);
      window.history.replaceState(null, '', reviewUrl(next));
      currentUrl.current = window.location.href;
    }
  }, [selected, state, tab]);
  if (loading && !session)
    return (
      <div className="review-access community-loading">
        <LoaderCircle size={22} className="community-spinner" /> Opening the archive admin…
      </div>
    );
  if (!session?.reviewer)
    return (
      <div className="review-access">
        <CommunityNotice title="Reviewer access is required">
          Sign in with your assigned review account to open this workspace.
        </CommunityNotice>
        {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
        <Link
          className="community-primary"
          href={`/sign-in?next=${encodeURIComponent(
            initialTab === 'contributions'
              ? '/admin/contributions'
              : adminRecordUrl(initialTab, initialRecordId),
          )}`}
        >
          Sign in to review <ArrowRight size={17} />
        </Link>
      </div>
    );
  return (
    <>
      <div className="review-desk-heading">
        <div>
          <h1>Archive admin</h1>
          <span>
            <ShieldCheck size={15} aria-hidden="true" /> Staff workspace
          </span>
        </div>
        <div className="review-account">
          <button
            className="community-text-button"
            title={session.user?.email ? `Signed in as ${session.user.email}` : undefined}
            onClick={() => {
              if (confirmLeave())
                void signOutCommunity().catch((failure) => setError(failure.message));
            }}
          >
            Sign out
          </button>
          <button
            className="community-secondary"
            disabled={loading}
            onClick={() => {
              if (confirmLeave()) void load();
            }}
          >
            <RefreshCw size={16} className={loading ? 'community-spinner' : ''} /> Refresh
          </button>
        </div>
      </div>
      <div className="admin-tabs" role="tablist" aria-label="Archive admin areas">
        <button
          role="tab"
          aria-selected={tab === 'contributions'}
          onClick={() => switchTab('contributions')}
        >
          <Inbox size={17} aria-hidden="true" /> Contributions
        </button>
        <button role="tab" aria-selected={tab === 'people'} onClick={() => switchTab('people')}>
          <Users size={17} aria-hidden="true" /> People
        </button>
        <button role="tab" aria-selected={tab === 'places'} onClick={() => switchTab('places')}>
          <MapPin size={17} aria-hidden="true" /> Places
        </button>
      </div>
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      {tab === 'people' ? (
        <PeopleAdmin
          key={`people-${nav}`}
          archive={admin.archive}
          initialPersonId={adminPerson}
          initialEntryId={adminEntry}
          onDirtyChange={onDirtyChange}
          confirmLeave={confirmLeave}
          onSaved={admin.apply}
          onOpenPlace={(placeId) => go('places', placeId)}
          onPersonChange={(personId) => {
            setAdminPerson(personId);
            window.history.replaceState(null, '', recordUrl('people', personId));
            currentUrl.current = window.location.href;
          }}
        />
      ) : tab === 'places' ? (
        <PlacesAdmin
          key={`places-${nav}`}
          archive={admin.archive}
          initialPlaceId={adminPlace}
          onDirtyChange={onDirtyChange}
          confirmLeave={confirmLeave}
          onSaved={admin.apply}
          onOpenPerson={(personId) => go('people', personId)}
          onPlaceChange={(placeId) => {
            setAdminPlace(placeId);
            window.history.replaceState(null, '', recordUrl('places', placeId));
            currentUrl.current = window.location.href;
          }}
        />
      ) : (
        <>
          {vetError && <CommunityNotice kind="error">{vetError}</CommunityNotice>}
          {(startingVet || vet?.runningSubmissionId) && (
            <p className="review-filter-note" role="status">
              A Vet check is running. You can browse submissions and make review decisions while it
              completes.
            </p>
          )}
          {!loaded ? (
            <div className="review-access">
              {loading ? 'Loading submissions…' : 'The queue is unavailable. Refresh to try again.'}
            </div>
          ) : (
            <>
              <ReviewStats
                items={items}
                selected={state.status}
                onSelect={(status) => update({ status })}
              />
              <div className="review-workspace" data-mobile-detail={mobileDetail}>
                <ReviewQueue
                  items={items}
                  archive={archive}
                  state={state}
                  selectedId={selected?.id}
                  onChange={(patch) => update(patch)}
                  onSelect={(submission) => update({ submission }, true)}
                  vet={vet}
                  startingVet={startingVet}
                />
                <div className="review-detail-scroll">
                  <button
                    className="review-mobile-back community-text-button"
                    onClick={() => setMobileDetail(false)}
                  >
                    <ArrowLeft size={17} /> Back to submissions
                  </button>
                  {notice && <CommunityNotice kind="success">{notice}</CommunityNotice>}
                  {selected && !visible.some((item) => item.id === selected.id) && (
                    <p className="review-filter-note">
                      This submission is outside the current filters. It stays open until you select
                      another.
                    </p>
                  )}
                  {selected ? (
                    <ReviewEditor
                      key={`${selected.id}-${selected.updatedAt}-${revision}`}
                      record={selected}
                      archive={archive}
                      onDirtyChange={onDirtyChange}
                      onEditPublished={(personId, entryId) => {
                        if (!confirmLeave()) return;
                        dirty.current = false;
                        setAdminEntry(entryId);
                        go('people', personId);
                      }}
                      vet={vetState(vet, selected.id, startingVet)}
                      canVet={!!vet?.configured && !startingVet && !vet.runningSubmissionId}
                      onVet={() => {
                        void runCheck(selected.id);
                      }}
                      onReviewed={(record) => {
                        dirty.current = false;
                        setItems((previous) =>
                          previous.map((item) => (item.id === record.id ? record : item)),
                        );
                        setNotice(`Review saved: ${reviewLabels[record.status]}.`);
                        void loadVet();
                      }}
                    />
                  ) : (
                    <div className="review-empty">
                      <Inbox size={32} />
                      <h2>{state.submission ? 'Submission unavailable' : 'A clear desk'}</h2>
                      <p>
                        {state.submission
                          ? 'Choose a submission from the queue.'
                          : 'Choose another filter or refresh the queue.'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function ReviewEditor({
  record,
  archive,
  onReviewed,
  onDirtyChange,
  vet,
  canVet,
  onVet,
  onEditPublished,
}: {
  record: SubmissionRecord;
  archive: ArchiveData;
  onReviewed: (record: SubmissionRecord) => void;
  onDirtyChange: (value: boolean) => void;
  onEditPublished: (personId: string, entryId: string) => void;
  vet: VetState;
  canVet: boolean;
  onVet: () => void;
}) {
  const [draft, setDraft] = useState({
    title: record.input.title,
    body: record.input.body,
    context: record.input.context,
    sourceCreator: record.input.sourceCreator,
    narrator: record.input.narrator,
    holdingInstitution: record.input.holdingInstitution,
    personId: record.input.personId ?? '',
    featured: false,
    relatedPersonIds: record.input.relatedPersonIds,
    placeIds: record.input.placeIds,
    eventDate: record.input.eventDate,
    newPersonName: record.input.proposedPersonName,
    authorMessage: '',
    publicNote: '',
    internalNote: '',
  });
  const [action, setAction] = useState<ReviewInput['action']>(
    record.status === 'published' ? 'withdraw' : 'publish',
  );
  const readOnly = ['withdrawn', 'rejected', 'draft'].includes(record.status);
  const publishedEntry = archive.contributions.find(
    (entry) => entry.id === record.publishedEntryId,
  );
  const [applyTo, setApplyTo] = useState<ReviewInput['applyTo']>(() => defaultApplyTo(record));
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [photoIds, setPhotoIds] = useState(record.photos.map((photo) => photo.id));
  const [photoEdits, setPhotoEdits] = useState(
    record.photos.map((photo) => ({
      id: photo.id,
      caption: photo.caption,
      creator: photo.creator,
      rights: photo.rights,
    })),
  );
  const [place, setPlace] = useState(() => initialPlace(record, archive));
  // A new person starts with the occupation the contributor suggested, ready to publish or edit.
  const [personFields, setPersonFields] = useState(() => ({
    ...personFieldsFor(record.input.personId ?? '', archive),
    ...(record.input.personId ? {} : { occupations: record.input.proposedOccupation ?? '' }),
  }));
  const initialPersonFields = useRef(personFieldsFor(record.input.personId ?? '', archive));
  const personPatch = personPatchFor(personFields, initialPersonFields.current, !!draft.personId);
  const themeOptions = [...new Set(archive.people.flatMap((person) => person.themes))];
  const placementHint = placementExplanation(record, applyTo);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('submission');
  const [confirming, setConfirming] = useState(false);
  const snapshot = JSON.stringify({
    draft,
    applyTo,
    sourceIds,
    photoIds,
    photoEdits,
    place,
    personFields,
  });
  const initialSnapshot = useRef(snapshot);
  const dirty = snapshot !== initialSnapshot.current;
  useEffect(() => {
    onDirtyChange(dirty || busy);
  }, [dirty, busy, onDirtyChange]);
  // Any public edit invalidates the publication acknowledgement, including place edits.
  useEffect(() => {
    setChecked(false);
  }, [snapshot]);
  function openDecision(next: ReviewInput['action']) {
    setAction(next);
    setChecked(false);
    setError('');
    setConfirming(true);
  }
  function edit<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setChecked(false);
  }
  function editPerson<K extends keyof PersonFields>(key: K, value: string) {
    setPersonFields((previous) => ({ ...previous, [key]: value }));
    setChecked(false);
  }
  // Choosing another person shows that record's current values, with nothing marked as changed.
  function choosePerson(id: string) {
    edit('personId', id);
    const next = personFieldsFor(id, archive);
    initialPersonFields.current = next;
    setPersonFields(next);
  }
  // The relationship text belongs to this contribution, so it survives switching places.
  function choosePlace(id: string) {
    const chosen = archive.places.find((place) => place.id === id);
    setPlace((previous) => {
      const relationship = previous.relationship.trim() || record.input.title;
      return chosen
        ? {
            id: chosen.id,
            name: chosen.name,
            scope: chosen.scope,
            lng: chosen.coordinates ? String(chosen.coordinates[0]) : '',
            lat: chosen.coordinates ? String(chosen.coordinates[1]) : '',
            precision: chosen.precision,
            note: chosen.locationNote,
            relationship,
            summary: chosen.summary,
          }
        : {
            id: '',
            name: '',
            scope: 'cemetery',
            lng: '',
            lat: '',
            precision: 'unmapped',
            note: unmappedNote,
            relationship,
            summary: '',
          };
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (readOnly || (record.status === 'published' && action !== 'withdraw')) return;
    if (action === 'publish' && !checked) {
      setError(
        'Confirm that you have reviewed the public text, attribution, privacy, and image permissions.',
      );
      return;
    }
    if (action !== 'publish' && !draft.authorMessage.trim()) {
      setError('Include a clear message to the contributor explaining this decision.');
      return;
    }
    // Extra archive sources are optional: publication always cites the contribution itself.
    if (action === 'publish' && applyTo === 'portrait' && photoIds.length === 0) {
      setError('Approve the photograph that should become the portrait.');
      return;
    }
    if (
      action === 'publish' &&
      [personFields.birthYear, personFields.deathYear].some(
        (year) => year.trim() && !/^\d{1,4}$/.test(year.trim()),
      )
    ) {
      setError('Enter birth and death years as years, or leave them blank.');
      return;
    }
    if (
      action === 'publish' &&
      applyTo === 'place' &&
      place.precision !== 'unmapped' &&
      (!place.lng.trim() || !place.lat.trim())
    ) {
      setError('Supply both longitude and latitude, or choose Not yet mapped.');
      return;
    }
    const payload: ReviewInput =
      action !== 'publish'
        ? {
            action,
            authorMessage: draft.authorMessage,
            internalNote: draft.internalNote,
            publicNote: draft.publicNote,
            sourceIds: [],
            applyTo: 'entry',
          }
        : {
            action,
            ...draft,
            personId: draft.personId || null,
            sourceIds,
            approvedPhotoIds: photoIds,
            photoEdits: photoEdits.filter((photo) => photoIds.includes(photo.id)),
            applyTo,
            ...(personPatch ? { personPatch } : {}),
            ...(applyTo === 'place'
              ? {
                  placePatch: {
                    placeId: place.id || `community-place-${record.id}`,
                    name: place.name,
                    scope: place.scope,
                    coordinates:
                      place.precision === 'unmapped'
                        ? null
                        : [Number(place.lng), Number(place.lat)],
                    precision: place.precision,
                    locationNote: place.note,
                    relationship: place.relationship,
                    summary: place.summary,
                  },
                }
              : {}),
          };
    const parsed = reviewInputSchema.safeParse(payload);
    if (!parsed.success) {
      setError(
        formatReviewIssues(
          parsed.error.issues,
          payload.photoEdits?.map(
            (photo) => record.photos.findIndex((original) => original.id === photo.id) + 1,
          ),
        ),
      );
      return;
    }
    setBusy(true);
    try {
      const result = await communityRequest<{ submission: SubmissionRecord }>(
        `/review/${encodeURIComponent(record.id)}`,
        { method: 'POST', body: JSON.stringify(parsed.data) },
      );
      onDirtyChange(false);
      setConfirming(false);
      onReviewed(result.submission);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'This review could not be saved. Your edits are still here.',
      );
    } finally {
      setBusy(false);
    }
  }
  const editable = !readOnly && record.status !== 'published';
  const credit = record.input.anonymous ? 'Anonymous contributor' : record.input.displayName;
  return (
    <section className="review-editor" aria-label="Review selected contribution">
      <header className="review-detail-heading">
        <div className="review-row-meta">
          <span className="community-status" data-status={record.status}>
            {reviewLabels[record.status]}
          </span>
          <span>{kindLabels[record.input.kind]}</span>
        </div>
        <h2>{record.input.title}</h2>
        <p>
          {credit} · {submissionPerson(record, archive)}
        </p>
        <small>
          Created {record.createdAt.slice(0, 10)} · ID {record.id}
        </small>
        <ReviewActions
          status={record.status}
          busy={busy}
          onDecision={openDecision}
          onVet={onVet}
          vetDisabled={!canVet}
        />
        {dirty && <small className="review-unsaved">Unsaved review edits</small>}
      </header>
      <div className="review-detail-content">
        <VetPanel state={vet} onRun={onVet} canRun={canVet && !busy} />
        <div className="review-tabs" role="tablist" aria-label="Submission details">
          {[
            ['submission', 'Submission'],
            ['draft', 'Public draft'],
            ['history', 'History'],
          ].map(([id, label], index, tabs) => (
            <button
              key={id}
              id={`review-tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`review-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id!)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = tabs.length - 1;
                else return;
                event.preventDefault();
                setTab(tabs[next]![0]!);
                document.getElementById(`review-tab-${tabs[next]![0]}`)?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id="review-panel-submission"
          aria-labelledby="review-tab-submission"
          tabIndex={0}
          hidden={tab !== 'submission'}
        >
          <OriginalSubmission record={record} archive={archive} />
        </div>
        <div
          role="tabpanel"
          id="review-panel-history"
          aria-labelledby="review-tab-history"
          tabIndex={0}
          hidden={tab !== 'history'}
        >
          <ReviewHistory record={record} />
        </div>
        <div
          role="tabpanel"
          id="review-panel-draft"
          aria-labelledby="review-tab-draft"
          tabIndex={0}
          hidden={tab !== 'draft'}
        >
          {!editable ? (
            <CommunityNotice
              title={
                record.status === 'published'
                  ? 'This contribution is published'
                  : 'This review is closed'
              }
            >
              The original and decision history remain available.{' '}
              {record.status === 'published'
                ? 'Correct the published entry in place, or withdraw it below.'
                : ''}
              {record.publishedEntryId && (
                <p>
                  <Link
                    className="community-text-button"
                    href={`/contributions/${encodeURIComponent(record.publishedEntryId)}`}
                  >
                    View published entry <ArrowRight size={15} />
                  </Link>
                </p>
              )}
              {record.status === 'published' && publishedEntry && (
                <p>
                  <button
                    type="button"
                    className="community-secondary"
                    onClick={() => onEditPublished(publishedEntry.personId, publishedEntry.id)}
                  >
                    Edit the published entry
                  </button>
                </p>
              )}
              {record.status === 'published' && (
                <p>
                  <Link
                    className="community-text-button"
                    href={`/contribute${record.input.personId ? `?person=${encodeURIComponent(record.input.personId)}` : ''}`}
                  >
                    Submit a correction
                  </Link>
                </p>
              )}
            </CommunityNotice>
          ) : (
            <div className="community-fields">
              <p className="review-credit">
                Public credit: <strong>{credit}</strong> — {draft.title}
              </p>
              <RecordPicker
                label="Person record"
                options={archive.people}
                value={draft.personId ? [draft.personId] : []}
                onChange={(ids) => choosePerson(ids[0] ?? '')}
                placeholder="Search names or alternate names…"
                emptyLabel="Create a new person record"
              />
              {!draft.personId && (
                <label className="community-field">
                  <span>New person’s public name</span>
                  <input
                    required
                    value={draft.newPersonName}
                    onChange={(event) => edit('newPersonName', event.target.value)}
                    maxLength={160}
                  />
                </label>
              )}
              <details className="story-context-details">
                <summary>
                  Person record details
                  {personPatch
                    ? ` · changing ${Object.keys(personPatch)
                        .map((key) => personFieldLabels[key as keyof PersonPatch])
                        .join(', ')}`
                    : ''}
                </summary>
                <div className="community-fields">
                  {draft.personId && (
                    <label className="community-field">
                      <span>Public name</span>
                      <input
                        value={personFields.name}
                        onChange={(event) => editPerson('name', event.target.value)}
                        maxLength={160}
                      />
                    </label>
                  )}
                  <label className="community-field">
                    <span>Other names</span>
                    <input
                      value={personFields.aliases}
                      onChange={(event) => editPerson('aliases', event.target.value)}
                      placeholder="Separate names with commas"
                    />
                  </label>
                  <div className="community-two-columns">
                    <label className="community-field">
                      <span>Birth year</span>
                      <input
                        inputMode="numeric"
                        value={personFields.birthYear}
                        onChange={(event) => editPerson('birthYear', event.target.value)}
                        placeholder="Unknown"
                        maxLength={4}
                      />
                    </label>
                    <label className="community-field">
                      <span>Death year</span>
                      <input
                        inputMode="numeric"
                        value={personFields.deathYear}
                        onChange={(event) => editPerson('deathYear', event.target.value)}
                        placeholder="Unknown"
                        maxLength={4}
                      />
                    </label>
                  </div>
                  <label className="community-field">
                    <span>Occupations</span>
                    <input
                      value={personFields.occupations}
                      onChange={(event) => editPerson('occupations', event.target.value)}
                      placeholder="Separate occupations with commas"
                    />
                    {!draft.personId && record.input.proposedOccupation && (
                      <small>Suggested by the contributor: {record.input.proposedOccupation}</small>
                    )}
                  </label>
                  <label className="community-field">
                    <span>Themes</span>
                    <input
                      value={personFields.themes}
                      onChange={(event) => editPerson('themes', event.target.value)}
                      placeholder="Separate themes with commas"
                    />
                    <small>In use: {themeOptions.join(', ')}</small>
                  </label>
                  <label className="community-field">
                    <span>Summary</span>
                    <textarea
                      rows={3}
                      maxLength={4000}
                      value={personFields.summary}
                      onChange={(event) => editPerson('summary', event.target.value)}
                      placeholder={
                        draft.personId
                          ? ''
                          : `Leave blank for “Community materials about ${draft.newPersonName || 'this person'}.”`
                      }
                    />
                    <small>
                      A changed summary cites this contribution. Everything here goes live with the
                      publication and can be withdrawn with it.
                    </small>
                  </label>
                </div>
              </details>
              <label className="community-field">
                <span>Public title</span>
                <input
                  required
                  minLength={3}
                  maxLength={160}
                  value={draft.title}
                  onChange={(event) => edit('title', event.target.value)}
                />
              </label>
              <details className="story-context-details">
                <summary>Confirm people, places, and event date</summary>
                <StoryContextFields
                  people={archive.people}
                  places={archive.places}
                  primaryPersonId={draft.personId}
                  value={draft}
                  onChange={(context) => {
                    setDraft((previous) => ({ ...previous, ...context }));
                    setChecked(false);
                  }}
                />
              </details>
              <label className="community-field">
                <span>Public text</span>
                <textarea
                  required
                  minLength={20}
                  maxLength={20000}
                  rows={8}
                  value={draft.body}
                  onChange={(event) => edit('body', event.target.value)}
                />
                <small>
                  Remove private contact details and preserve the contributor’s meaning. The
                  original submission remains in the review record.
                </small>
              </label>
              <label className="community-field">
                <span>Public context</span>
                <textarea
                  maxLength={4000}
                  rows={3}
                  value={draft.context}
                  onChange={(event) => edit('context', event.target.value)}
                />
              </label>
              <div className="community-two-columns">
                <label className="community-field">
                  <span>Original author or creator</span>
                  <input
                    maxLength={200}
                    value={draft.sourceCreator}
                    onChange={(event) => edit('sourceCreator', event.target.value)}
                  />
                </label>
                <label className="community-field">
                  <span>Narrator</span>
                  <input
                    maxLength={200}
                    value={draft.narrator}
                    onChange={(event) => edit('narrator', event.target.value)}
                  />
                </label>
              </div>
              <label className="community-field">
                <span>Holding institution or collection</span>
                <input
                  maxLength={200}
                  value={draft.holdingInstitution}
                  onChange={(event) => edit('holdingInstitution', event.target.value)}
                />
              </label>
              {record.photos.length > 0 && (
                <section className="community-section">
                  <h3>Photographs for publication</h3>
                  <p className="community-hint" style={{ marginTop: 10 }}>
                    Uncheck photographs that should remain private. Review the original and edit
                    public captions and attribution.
                  </p>
                  {record.photos.map((photo, index) => {
                    const edited = photoEdits.find((edit) => edit.id === photo.id)!;
                    const update = (key: 'caption' | 'creator' | 'rights', value: string) => {
                      setPhotoEdits((previous) =>
                        previous.map((item) =>
                          item.id === photo.id ? { ...item, [key]: value } : item,
                        ),
                      );
                      setChecked(false);
                    };
                    return (
                      <div className="community-section" key={photo.id}>
                        <h4>Photograph {index + 1}</h4>
                        <label className="community-check">
                          <input
                            type="checkbox"
                            checked={photoIds.includes(photo.id)}
                            onChange={(event) => {
                              setPhotoIds((previous) =>
                                event.target.checked
                                  ? [...previous, photo.id]
                                  : previous.filter((id) => id !== photo.id),
                              );
                              setChecked(false);
                            }}
                          />
                          <span>Include this photograph in the public entry</span>
                        </label>
                        <div className="community-gallery">
                          <PrivateSubmissionPhoto submissionId={record.id} photo={photo} original />
                        </div>
                        {photoIds.includes(photo.id) && (
                          <div className="community-fields">
                            <label className="community-field">
                              <span>Public caption</span>
                              <input
                                required
                                maxLength={500}
                                value={edited.caption}
                                onChange={(event) => update('caption', event.target.value)}
                              />
                            </label>
                            <label className="community-field">
                              <span>Creator</span>
                              <input
                                required
                                maxLength={160}
                                value={edited.creator}
                                onChange={(event) => update('creator', event.target.value)}
                              />
                            </label>
                            <label className="community-field">
                              <span>Rights and use conditions</span>
                              <input
                                required
                                maxLength={1000}
                                value={edited.rights}
                                onChange={(event) => update('rights', event.target.value)}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>
              )}
              <label className="community-field">
                <span>Where should the approved content appear?</span>
                <select
                  value={applyTo}
                  onChange={(event) => {
                    setApplyTo(event.target.value as ReviewInput['applyTo']);
                    setChecked(false);
                  }}
                >
                  <option value="entry">Community entry, linked to the person</option>
                  <option value="biography">Community entry and a sourced biography passage</option>
                  <option value="place">Community entry and a map place update</option>
                  <option value="portrait">Community entry and the person’s portrait</option>
                </select>
                <small>
                  Personal memories belong in clearly labeled community entries. Changes to factual
                  records need claim-appropriate evidence.
                </small>
                {placementHint && <small className="review-placement-hint">{placementHint}</small>}
                {applyTo === 'portrait' && record.input.placement?.section !== 'portrait' && (
                  <small className="review-placement-hint">
                    The first approved photograph becomes the portrait at the top of the person
                    page; the entry keeps every approved photograph.
                  </small>
                )}
              </label>
              <details open={applyTo !== 'entry'}>
                <summary className="community-text-button">
                  Add supporting archive sources, optional ({sourceIds.length})
                </summary>
                <div
                  className="community-fields"
                  style={{ maxHeight: 300, overflow: 'auto', padding: '10px 3px' }}
                >
                  {archive.sources.map((source) => (
                    <label className="community-check" key={source.id}>
                      <input
                        type="checkbox"
                        checked={sourceIds.includes(source.id)}
                        onChange={(event) => {
                          setSourceIds((previous) =>
                            event.target.checked
                              ? [...previous, source.id]
                              : previous.filter((id) => id !== source.id),
                          );
                          setChecked(false);
                        }}
                      />
                      <span>
                        {source.title}
                        <small>{source.publisher}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </details>
              {applyTo === 'place' && (
                <section className="community-section">
                  <h3>Map place update</h3>
                  <div className="community-fields" style={{ marginTop: 18 }}>
                    <label className="community-field">
                      <span>Existing place or new place</span>
                      <select
                        value={place.id}
                        onChange={(event) => choosePlace(event.target.value)}
                      >
                        <option value="">Add a new place</option>
                        {archive.places.map((place) => (
                          <option value={place.id} key={place.id}>
                            {place.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="community-field">
                      <span>Place name</span>
                      <input
                        required
                        value={place.name}
                        onChange={(event) =>
                          setPlace((previous) => ({ ...previous, name: event.target.value }))
                        }
                      />
                    </label>
                    <label className="community-field">
                      <span>About this place (public)</span>
                      <textarea
                        value={place.summary}
                        maxLength={4000}
                        rows={3}
                        placeholder="What this place is, independent of any one person. Shown on the map and the place page."
                        onChange={(event) =>
                          setPlace((previous) => ({ ...previous, summary: event.target.value }))
                        }
                      />
                    </label>
                    <div className="community-two-columns">
                      <label className="community-field">
                        <span>Area</span>
                        <select
                          value={place.scope}
                          onChange={(event) =>
                            setPlace((previous) => ({
                              ...previous,
                              scope: event.target.value as 'cemetery' | 'atlanta',
                            }))
                          }
                        >
                          <option value="cemetery">South-View Cemetery</option>
                          <option value="atlanta">Atlanta</option>
                        </select>
                      </label>
                      <label className="community-field">
                        <span>Position precision</span>
                        <select
                          value={place.precision}
                          onChange={(event) =>
                            setPlace((previous) => ({
                              ...previous,
                              precision: event.target.value as typeof place.precision,
                            }))
                          }
                        >
                          <option value="unmapped">Not yet mapped</option>
                          <option value="reference">Reference position</option>
                          <option value="address">Address position</option>
                          <option value="verified">Independently verified position</option>
                        </select>
                      </label>
                    </div>
                    {place.precision !== 'unmapped' && (
                      <div className="community-two-columns">
                        <label className="community-field">
                          <span>Longitude</span>
                          <input
                            required
                            type="number"
                            step="any"
                            min={-180}
                            max={180}
                            value={place.lng}
                            onChange={(event) =>
                              setPlace((previous) => ({ ...previous, lng: event.target.value }))
                            }
                          />
                        </label>
                        <label className="community-field">
                          <span>Latitude</span>
                          <input
                            required
                            type="number"
                            step="any"
                            min={-85}
                            max={85}
                            value={place.lat}
                            onChange={(event) =>
                              setPlace((previous) => ({ ...previous, lat: event.target.value }))
                            }
                          />
                        </label>
                      </div>
                    )}
                    <label className="community-field">
                      <span>Location evidence and limits</span>
                      <textarea
                        required
                        value={place.note}
                        onChange={(event) =>
                          setPlace((previous) => ({ ...previous, note: event.target.value }))
                        }
                        rows={3}
                      />
                    </label>
                    <label className="community-field">
                      <span>Person’s relationship to this place</span>
                      <textarea
                        required
                        value={place.relationship}
                        onChange={(event) =>
                          setPlace((previous) => ({
                            ...previous,
                            relationship: event.target.value,
                          }))
                        }
                        rows={3}
                      />
                    </label>
                  </div>
                </section>
              )}
              <label className="community-field">
                <span>Public editorial note</span>
                <textarea
                  maxLength={3000}
                  rows={3}
                  value={draft.publicNote}
                  onChange={(event) => edit('publicNote', event.target.value)}
                  placeholder="Context readers should see, including limitations or a correction explanation."
                />
              </label>
            </div>
          )}
        </div>
      </div>
      {confirming && (
        <ReviewDialog
          title={
            action === 'publish'
              ? 'Review before publishing'
              : action === 'reject'
                ? 'Reject this submission'
                : action === 'withdraw'
                  ? 'Withdraw from public view'
                  : 'Request information'
          }
          busy={busy}
          onClose={() => setConfirming(false)}
        >
          <form className="community-fields" onSubmit={submit} noValidate>
            {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
            {action === 'publish' && (
              <section className="review-public-preview">
                <p className="community-preview-label">
                  Public preview · {kindLabels[record.input.kind]}
                </p>
                <h3>{draft.title}</h3>
                <p className="review-credit">
                  {credit} — {draft.title}
                </p>
                <p>
                  Person:{' '}
                  {archive.people.find((person) => person.id === draft.personId)?.name ||
                    draft.newPersonName ||
                    'New person — name required'}
                </p>
                {personPatch && (
                  <p>
                    Person record changes:{' '}
                    {Object.keys(personPatch)
                      .map((key) => personFieldLabels[key as keyof PersonPatch])
                      .join(', ')}
                  </p>
                )}
                {applyTo === 'portrait' && (
                  <p>The first approved photograph becomes the portrait.</p>
                )}
                <p className="community-body">{draft.body}</p>
                {draft.context && <p className="community-body">{draft.context}</p>}
                <dl className="review-facts">
                  <div>
                    <dt>Original author</dt>
                    <dd>{draft.sourceCreator || 'Not supplied'}</dd>
                  </div>
                  <div>
                    <dt>Narrator</dt>
                    <dd>{draft.narrator || 'Not supplied'}</dd>
                  </div>
                  <div>
                    <dt>Holding institution</dt>
                    <dd>{draft.holdingInstitution || 'Not supplied'}</dd>
                  </div>
                </dl>
                <h4>Sources</h4>
                <ul className="review-source-list">
                  {record.input.links.map((link) => (
                    <li key={link.url}>
                      <a href={link.url} target="_blank" rel="noopener noreferrer">
                        {link.title}
                      </a>
                    </li>
                  ))}
                  {archive.sources
                    .filter((source) => sourceIds.includes(source.id))
                    .map((source) => (
                      <li key={source.id}>
                        {source.title} · {source.publisher}
                      </li>
                    ))}
                </ul>
                {!sourceIds.length && !record.input.links.length && (
                  <p>
                    No external sources selected. This contribution retains its own attribution.
                  </p>
                )}
                <h4>Approved photographs · {photoIds.length}</h4>
                <div className="community-gallery">
                  {record.photos
                    .filter((photo) => photoIds.includes(photo.id))
                    .map((photo) => (
                      <PrivateSubmissionPhoto
                        key={photo.id}
                        submissionId={record.id}
                        photo={{ ...photo, ...photoEdits.find((edit) => edit.id === photo.id) }}
                      />
                    ))}
                </div>
                <p>
                  Publication:{' '}
                  {applyTo === 'entry'
                    ? 'Independent community entry'
                    : applyTo === 'biography'
                      ? record.input.kind === 'correction' && record.input.placement?.blockId
                        ? 'Community entry; the edited paragraph replaces the current one'
                        : record.input.placement?.blockId
                          ? 'Community entry and a biography passage after the paragraph it was written under'
                          : 'Community entry and biography passage'
                      : 'Community entry and map place update'}
                </p>
                {applyTo === 'place' && (
                  <p>
                    {place.name} · {place.relationship} · {place.precision}
                    {place.precision !== 'unmapped' && ` · ${place.lng}, ${place.lat}`}
                    <br />
                    {place.note}
                  </p>
                )}
                {draft.publicNote && <p>Editorial note: {draft.publicNote}</p>}
                <button
                  className="community-text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    setTab('draft');
                  }}
                >
                  Edit public draft
                </button>
              </section>
            )}
            {action !== 'publish' && (
              <p>
                {action === 'withdraw'
                  ? 'The published entry and its approved photographs will leave public view. The original and review history are retained.'
                  : action === 'reject'
                    ? 'The submission will remain private. Explain the decision to the contributor.'
                    : 'The contributor is not emailed. They see this message the next time they open their private receipt page or account, and the submission returns to review when they reply.'}
              </p>
            )}
            <label className="community-field">
              <span>Message to the contributor {action !== 'publish' && '*'}</span>
              <textarea
                required={action !== 'publish'}
                maxLength={3000}
                rows={3}
                value={draft.authorMessage}
                onChange={(event) => edit('authorMessage', event.target.value)}
                placeholder="Explain your decision and any information that would help."
              />
              <small>Shown only on the contributor’s private receipt page; no email is sent.</small>
            </label>
            <label className="community-field">
              <span>Internal review note</span>
              <textarea
                maxLength={5000}
                rows={3}
                value={draft.internalNote}
                onChange={(event) => edit('internalNote', event.target.value)}
              />
              <small>Visible only to authorized reviewers.</small>
            </label>

            {action === 'publish' && (
              <label className="community-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                />
                <span>
                  I have checked the public text, contributor credit, personal information, sources,
                  and photograph permissions.
                </span>
              </label>
            )}
            <div className="review-dialog-actions">
              <button
                className="community-secondary"
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
              <button
                className={
                  action === 'reject' || action === 'withdraw'
                    ? 'community-danger'
                    : 'community-primary'
                }
                disabled={busy}
                type="submit"
              >
                {busy ? (
                  <LoaderCircle size={17} className="community-spinner" />
                ) : (
                  <CheckCheck size={17} />
                )}
                {action === 'publish'
                  ? 'Approve & publish'
                  : action === 'reject'
                    ? 'Reject submission'
                    : action === 'withdraw'
                      ? 'Withdraw contribution'
                      : 'Request information'}
              </button>
            </div>
          </form>
        </ReviewDialog>
      )}
    </section>
  );
}
