'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useDetailResize, useSidebarResize } from './detail-resize';
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  List,
  Map as MapIcon,
  MapPin,
  Navigation,
  Search,
  SlidersHorizontal,
  Sprout,
  UserRound,
  X,
} from 'lucide-react';
import './explorer-map.css';
import { SiteNavigation } from './site-navigation';
import { MapPreview } from './map-preview';
import { directionsUrl, placeConnections, precisionLabels, soleOccupant } from '@/lib/place-mode';
import {
  portraitRights,
  searchArchive,
  scopeIncludesPlace,
  type ArchiveData,
  type Person,
  type Scope,
} from '@southview/validators';
import { viewportState } from '@/lib/map-scope';
import { displayPersonName } from '@/lib/person-name';
import { copy } from '@/lib/copy';
import {
  createPreviewController,
  previewSelection,
  type PreviewTarget,
} from '@/lib/explore-preview';
import {
  initialExploreState,
  parseExploreState,
  serializeExploreState,
  type ExploreState,
  type Viewport,
} from '@/lib/explore-state';
// Pushed with a place opened from a person, so the panel's back control can use the real
// history entry instead of adding one.
type HistoryState = { backToPerson?: boolean } | null;
const focusStorageKey = 'southview.explore.focus-person';
type FocusSubject = { kind: 'person' | 'place'; id: string };

const ArchiveMap = dynamic(() => import('./archive-map'), {
  ssr: false,
  loading: () => (
    <div className="map-loading">
      <MapIcon size={24} />
      <span>Opening the map…</span>
    </div>
  ),
});

function Monogram({ person, large = false }: { person: Person; large?: boolean }) {
  if (person.portrait)
    return (
      <img
        className={`person-image ${large ? 'large' : ''}`}
        src={person.portrait.url}
        alt={person.portrait.alt}
      />
    );
  return (
    <div className={`person-monogram ${large ? 'large' : ''}`} aria-hidden="true">
      <span>
        {person.name
          .split(' ')
          .filter((s) => !/^(Sr\.|Jr\.)$/.test(s))
          .filter((_, i, words) => i === 0 || i === words.length - 1)
          .map((s) => s[0])
          .join('')}
      </span>
      <Sprout size={large ? 40 : 24} strokeWidth={0.7} />
    </div>
  );
}

/** A small chip that opens Google Maps with directions to a mapped place, in a new tab. */
function DirectionsLink({ coordinates, name }: { coordinates: [number, number]; name: string }) {
  return (
    <a
      className="directions-chip"
      href={directionsUrl(coordinates)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Directions to ${name} in Google Maps (opens in a new tab)`}
      title="Directions in Google Maps"
    >
      <Navigation size={12} aria-hidden="true" />
      Directions
    </a>
  );
}

export function Explorer({ archive }: { archive: ArchiveData }) {
  const [state, setState] = useState<ExploreState>(initialExploreState);
  const [initialized, setInitialized] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [focusSelection, setFocusSelection] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [resetEpoch, setResetEpoch] = useState(0);
  const [copied, setCopied] = useState(false);
  const [alphabetical, setAlphabetical] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const detailResize = useDetailResize();
  const sidebarResize = useSidebarResize();
  const triggerRef = useRef<HTMLElement | null>(null);
  const liveState = useRef(state);
  liveState.current = state;
  // With a person open, the map can hide every other marker. The choice is remembered on this
  // device, since a reader who wants it usually wants it for every person they open.
  const [focusOnly, setFocusOnly] = useState(false);
  useEffect(() => {
    try {
      setFocusOnly(window.localStorage.getItem(focusStorageKey) === '1');
    } catch {
      /* Storage can be unavailable; the toggle still works for this visit. */
    }
  }, []);
  const toggleFocusOnly = useCallback(() => {
    setFocusOnly((value) => {
      try {
        window.localStorage.setItem(focusStorageKey, value ? '0' : '1');
      } catch {
        /* See above. */
      }
      return !value;
    });
  }, []);
  // The record the filter is locked to. It is set from whatever is open when the filter is on,
  // and survives following links from that record (a person's places, a place's people), so the
  // map keeps one life or one place in view while the panel steps through its connections.
  // Picking a record afresh, from the list or from an empty map, moves the lock to it.
  const [focusLock, setFocusLock] = useState<FocusSubject | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The panel's back control pops a history entry; the panel keeps focus once it re-renders.
  const focusPanelOnPop = useRef(false);
  useEffect(() => {
    const load = () => {
      const restored = parseExploreState(window.location.search);
      setState(restored);
      setShowResults(!!restored.q || restored.theme !== 'all');
      setFocusSelection(!!restored.person);
      setInitialized(true);
      setResetEpoch((n) => n + 1);
      if (focusPanelOnPop.current) {
        focusPanelOnPop.current = false;
        requestAnimationFrame(() => detailRef.current?.focus({ preventScroll: true }));
      }
    };
    load();
    window.addEventListener('popstate', load);
    return () => {
      window.removeEventListener('popstate', load);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);
  const update = useCallback(
    (patch: Partial<ExploreState>, push = false, historyState: HistoryState = null) => {
      // A final map move event can arrive while Next is transitioning to a record.
      if (window.location.pathname !== '/explore') return;
      const next = { ...liveState.current, ...patch };
      liveState.current = next;
      setState(next);
      const url = serializeExploreState(next);
      if (url !== window.location.pathname + window.location.search) {
        if (push) window.history.pushState(historyState, '', url);
        else window.history.replaceState(window.history.state, '', url);
      }
    },
    [],
  );
  const previewController = useMemo(
    () =>
      createPreviewController<PreviewTarget>((target) => {
        if (!target) {
          setPreviewTarget(null);
          return;
        }
        if (!target.anchor.isConnected) return;
        const selection = previewSelection(archive, liveState.current.scope, target);
        if (!selection) return;
        if (archive.people.some((person) => person.id === liveState.current.person)) {
          // Hover immediately changes the open record, but never moves the camera, steals focus,
          // or adds browser history entries. Keep it readable after leaving the pin.
          triggerRef.current = target.anchor;
          // Hover shows what a click would open: a single grave is its person, any other marker
          // is the place itself, listed with everyone connected to it.
          const occupant = soleOccupant(archive, target.placeId);
          const patch: Partial<ExploreState> = occupant
            ? { ...selection, person: occupant, panel: 'person' }
            : target.placeId
              ? { place: target.placeId, panel: 'place' }
              : { ...selection, panel: 'person' };
          if (
            liveState.current.person !== (patch.person ?? liveState.current.person) ||
            liveState.current.place !== patch.place ||
            liveState.current.panel !== (patch.panel ?? liveState.current.panel)
          )
            update(patch);
          setPreviewTarget(null);
        } else {
          setPreviewTarget({ ...target, placeId: selection.place ?? undefined });
        }
      }),
    [archive, update],
  );
  const onPreview = useCallback(
    (target: PreviewTarget | null) => {
      if (!target) {
        previewController.clear();
        return;
      }
      // Touch-generated mouse/focus events must not change the bottom sheet.
      if (
        target.input === 'pointer' &&
        !window.matchMedia('(min-width: 761px) and (any-hover: hover) and (any-pointer: fine)')
          .matches
      )
        return;
      previewController.show(target, target.input === 'keyboard' || !!liveState.current.person);
    },
    [previewController],
  );
  useEffect(() => {
    const clear = () => previewController.clear();
    window.addEventListener('resize', clear);
    window.addEventListener('popstate', clear);
    window.addEventListener('blur', clear);
    return () => {
      previewController.cancel();
      window.removeEventListener('resize', clear);
      window.removeEventListener('popstate', clear);
      window.removeEventListener('blur', clear);
    };
  }, [previewController]);
  useEffect(() => {
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0;
    setCopied(false);
  }, [state.person, state.place, state.panel]);
  const results = useMemo(
    () => searchArchive(archive, { q: state.q, theme: state.theme, scope: state.scope }),
    [archive, state.q, state.theme, state.scope],
  );
  const people = useMemo(
    () =>
      alphabetical
        ? [...results.people].sort((a, b) => a.name.localeCompare(b.name))
        : results.people,
    [results.people, alphabetical],
  );
  const themes = useMemo(
    () => [...new Set(archive.people.flatMap((p) => p.themes))].sort(),
    [archive],
  );
  // A single-person grave is that person's marker and opens as the person, whichever way it
  // was reached; shared places (crypts, churches, city hall) open as places.
  const selected = archive.people.find(
    (p) => p.id === (state.person ?? soleOccupant(archive, state.place)),
  );
  // The panel lists every place in the person's life, whichever view the map is in: a grave on
  // its own says little, so the places they lived and worked follow it. The selected place
  // comes first, then the places in the current view, then the rest.
  const placeScope = (placeId: string) => archive.places.find((p) => p.id === placeId)?.scope;
  const selectedRelations = selected
    ? archive.relations
        .filter((r) => r.personId === selected.id && placeScope(r.placeId))
        .sort(
          (a, b) =>
            Number(b.placeId === state.place) - Number(a.placeId === state.place) ||
            Number(scopeIncludesPlace(state.scope, placeScope(b.placeId)!)) -
              Number(scopeIncludesPlace(state.scope, placeScope(a.placeId)!)),
        )
    : [];
  const selectedPlace = archive.places.find(
    (p) =>
      p.id === (state.place ?? selectedRelations[0]?.placeId) &&
      selectedRelations.some((r) => r.placeId === p.id),
  );
  // A marker selects the place itself; the panel then lists everyone connected to it. With a
  // person open, their places open the same way, and the panel keeps a way back to the person.
  const placeOnly =
    !selected || state.panel === 'place'
      ? (archive.places.find((p) => p.id === state.place) ?? null)
      : null;
  const placeOrigin = placeOnly && selected ? selected : undefined;
  const placePeople = placeOnly ? placeConnections(archive, placeOnly.id, placeOrigin?.id) : [];
  const hasSelection = !!selected || !!placeOnly;
  // "Only this person" / "Only this place": the map keeps one record's places and drops every
  // other marker. For a person, their places; for a place, the place and every place of the
  // people connected to it. The list and search are untouched, so another record is always one
  // click away.
  const shown: FocusSubject | null = placeOnly
    ? { kind: 'place', id: placeOnly.id }
    : selected
      ? { kind: 'person', id: selected.id }
      : null;
  const lockStillExists =
    focusLock &&
    (focusLock.kind === 'person' ? archive.people : archive.places).some(
      (item) => item.id === focusLock.id,
    );
  const focusSubject = focusOnly && hasSelection ? (lockStillExists ? focusLock : shown) : null;
  useEffect(() => {
    // Lock to what is open the moment the filter applies to something; let go when nothing
    // is open or the filter is off.
    if (!focusOnly || !shown) setFocusLock(null);
    else if (!lockStillExists) setFocusLock(shown);
  }, [focusOnly, shown?.kind, shown?.id, lockStillExists]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusedPlaceIds = (() => {
    if (!focusSubject) return null;
    const people =
      focusSubject.kind === 'place'
        ? new Set(
            archive.relations.filter((r) => r.placeId === focusSubject.id).map((r) => r.personId),
          )
        : new Set([focusSubject.id]);
    const ids = new Set(
      archive.relations.filter((r) => people.has(r.personId)).map((r) => r.placeId),
    );
    if (focusSubject.kind === 'place') ids.add(focusSubject.id);
    return ids;
  })();
  const focusLabel = (subject: FocusSubject) =>
    subject.kind === 'place'
      ? (archive.places.find((p) => p.id === subject.id)?.name ?? '')
      : displayPersonName(archive.people.find((p) => p.id === subject.id)?.name ?? '');
  const focusControl = shown
    ? {
        name: focusLabel(focusSubject ?? shown),
        kind: (focusSubject ?? shown).kind,
        only: !!focusSubject,
        onToggle: toggleFocusOnly,
      }
    : undefined;
  const mapPlaces = focusedPlaceIds
    ? results.places.filter((p) => focusedPlaceIds.has(p.id))
    : results.places;
  const mapRelations = focusedPlaceIds
    ? results.relations.filter((r) => focusedPlaceIds.has(r.placeId))
    : results.relations;
  const preview = archive.people.find((p) => p.id === previewTarget?.personId);
  const previewPlace =
    previewTarget?.placeId && !soleOccupant(archive, previewTarget.placeId)
      ? archive.places.find((place) => place.id === previewTarget.placeId)
      : undefined;
  const previewPeople = previewTarget?.placeId
    ? archive.relations
        .filter((r) => r.placeId === previewTarget.placeId)
        .map((r) => archive.people.find((p) => p.id === r.personId)?.name)
        .filter((name): name is string => !!name)
    : [];
  const selectPlace = useCallback(
    (placeId: string) => {
      if (!archive.places.some((p) => p.id === placeId)) return;
      previewController.clear();
      setFocusLock(null); // a fresh pick from the map: the filter follows it
      triggerRef.current = document.activeElement as HTMLElement;
      update({ person: null, place: placeId, panel: 'person', viewport: null }, true);
      setResetEpoch((n) => n + 1);
      setFocusSelection(true);
      if (window.matchMedia('(max-width: 760px)').matches) setShowResults(false);
      requestAnimationFrame(() => detailRef.current?.focus({ preventScroll: true }));
    },
    [archive, update, previewController],
  );
  // One of an open person's places, shown as a place. The browser's Back button and the panel's
  // own back control both return to the person: the push remembers where it came from.
  const openPlace = useCallback(
    (placeId: string, personId: string) => {
      const place = archive.places.find((p) => p.id === placeId);
      if (!place) return;
      previewController.clear();
      triggerRef.current = document.activeElement as HTMLElement;
      update(
        {
          // A place outside the current view brings its view along.
          scope: scopeIncludesPlace(liveState.current.scope, place.scope)
            ? liveState.current.scope
            : place.scope,
          person: personId,
          place: placeId,
          panel: 'place',
          viewport: null,
        },
        true,
        { backToPerson: true },
      );
      setResetEpoch((n) => n + 1);
      setFocusSelection(true);
      if (window.matchMedia('(max-width: 760px)').matches) setShowResults(false);
      requestAnimationFrame(() => detailRef.current?.focus({ preventScroll: true }));
    },
    [archive, update, previewController],
  );
  const backToPerson = useCallback(() => {
    previewController.clear();
    if ((window.history.state as HistoryState)?.backToPerson) {
      focusPanelOnPop.current = true;
      window.history.back();
      return;
    }
    update({ panel: 'person' }, true);
    requestAnimationFrame(() => detailRef.current?.focus({ preventScroll: true }));
  }, [update, previewController]);
  const selectPerson = useCallback(
    (personId: string, placeId?: string) => {
      const selection = previewSelection(archive, liveState.current.scope, { personId, placeId });
      if (!selection) return;
      previewController.clear();
      // From the list, a fresh pick moves the filter; from a place's panel or a marker, the
      // person is one of the open record's connections and the lock stays.
      if (!placeId) setFocusLock(null);
      triggerRef.current = document.activeElement as HTMLElement;
      update({ ...selection, panel: 'person', viewport: null }, true);
      setResetEpoch((n) => n + 1);
      setFocusSelection(true);
      if (window.matchMedia('(max-width: 760px)').matches) setShowResults(false);
      requestAnimationFrame(() => detailRef.current?.focus({ preventScroll: true }));
    },
    [archive, update, previewController],
  );
  const closeDetail = useCallback(() => {
    previewController.clear();
    setFocusLock(null);
    update({ person: null, place: null, panel: 'person' }, true);
    requestAnimationFrame(() => {
      if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
      else document.getElementById('archive-search')?.focus();
      previewController.clear();
    });
  }, [update, previewController]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (liveState.current.panel === 'place' && liveState.current.person) backToPerson();
        else if (liveState.current.person || liveState.current.place) closeDetail();
        else previewController.clear();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [backToPerson, closeDetail, previewController]);
  const changeScope = (scope: Scope) => {
    previewController.clear();
    setFocusSelection(false);
    const available = archive.relations.filter(
      (r) =>
        r.personId === state.person &&
        archive.places.some((p) => p.id === r.placeId && scopeIncludesPlace(scope, p.scope)),
    );
    const rel =
      available.find((r) => archive.places.some((p) => p.id === r.placeId && p.scope === scope)) ??
      available[0];
    update({ scope, viewport: null, place: rel?.placeId ?? null, panel: 'person' }, true);
    setResetEpoch((n) => n + 1);
  };
  const onViewport = useCallback(
    (viewport: Viewport, autoScope: boolean) => {
      update(viewportState(liveState.current, viewport, autoScope, archive));
    },
    [archive, update],
  );
  const recordPath = placeOnly
    ? `/places/${placeOnly.id}`
    : selected
      ? `/people/${selected.id}`
      : '';
  const detailHref = recordPath
    ? `${recordPath}?${placeOrigin ? `person=${encodeURIComponent(placeOrigin.id)}&` : ''}from=${encodeURIComponent(serializeExploreState(state))}`
    : '';
  async function copyLink(kind: 'map' | 'person') {
    const origin = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const url = new URL(
      kind === 'person' && recordPath ? recordPath : serializeExploreState(state, true),
      origin,
    ).href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this permanent link:', url);
    }
  }
  return (
    <div
      className={`explorer map-explorer ${state.embed ? 'is-embedded' : ''} ${showResults ? 'results-open' : ''} ${hasSelection ? 'has-selection' : ''}`}
      style={{ ...detailResize.style, ...sidebarResize.style }}
    >
      <SiteNavigation
        overlay
        embed={state.embed}
        personId={selected?.id}
        standaloneHref={serializeExploreState(state, true)}
      >
        <button
          onClick={() => copyLink('map')}
          aria-label={copied ? 'Map link copied' : 'Copy map link'}
          title={copied ? 'Link copied' : 'Share map'}
        >
          {copied ? <Check size={18} /> : <Copy size={18} />}
        </button>
      </SiteNavigation>
      <main id="main-content" tabIndex={-1}>
        <h1 className="sr-only">Explore South-View and Atlanta</h1>
        <section className="atlas" aria-label="Explore the collection">
          <div className={`atlas-body ${hasSelection ? 'has-selection' : ''}`}>
            <aside
              className={`people-sidebar ${sidebarResize.panelClass}`}
              aria-label="Search and browse people"
            >
              {sidebarResize.handle}
              <div className="search-controls">
                <label className="search-box" htmlFor="archive-search">
                  <Search size={19} strokeWidth={1.6} />
                  <input
                    id="archive-search"
                    type="search"
                    placeholder="Search the archive"
                    aria-label="Search people, places, or stories"
                    value={state.q}
                    onChange={(e) => {
                      previewController.clear();
                      update({ q: e.target.value, person: null, place: null });
                      setShowResults(true);
                    }}
                  />
                </label>
                <button
                  className="browse-people-toggle"
                  aria-label={showResults ? 'Hide people list' : 'Browse people'}
                  aria-expanded={showResults}
                  aria-controls="people-results-panel"
                  onClick={() => {
                    if (!showResults && window.matchMedia('(max-width: 760px)').matches) {
                      update({ person: null, place: null });
                    }
                    setShowResults((value) => !value);
                    previewController.clear();
                  }}
                >
                  {showResults ? (
                    <X size={17} aria-hidden="true" />
                  ) : (
                    <List size={17} aria-hidden="true" />
                  )}
                  <span className="browse-people-label">People</span>
                  <span className="people-count">{people.length}</span>
                </button>
              </div>
              {showResults && (
                <div id="people-results-panel" className="browse-results">
                  <div className="browse-filters">
                    <div className="filter-row">
                      <label className="theme-filter">
                        <SlidersHorizontal size={15} />
                        <span className="sr-only">Filter by theme</span>
                        <select
                          value={state.theme}
                          onChange={(e) => {
                            previewController.clear();
                            update({ theme: e.target.value, person: null, place: null });
                          }}
                        >
                          <option value="all">All themes</option>
                          {themes.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="sort-button"
                        aria-label={
                          alphabetical ? 'Use collection order' : 'Sort names alphabetically'
                        }
                        aria-pressed={alphabetical}
                        onClick={() => setAlphabetical((v) => !v)}
                      >
                        <ArrowDownUp size={15} />
                        <span>{alphabetical ? 'A–Z' : 'Sort'}</span>
                      </button>
                    </div>
                  </div>
                  <div className="collection-heading">
                    <h2>The collection</h2>
                    <span aria-live="polite">
                      {people.length} {people.length === 1 ? 'life' : 'lives'}
                    </span>
                  </div>
                  <div className="people-results" onScroll={() => onPreview(null)}>
                    {people.length === 0 ? (
                      <div className="no-results">
                        <Search size={26} />
                        <h3>No matching stories yet.</h3>
                        <p>Try another name or explore all themes.</p>
                        <button onClick={() => update({ q: '', theme: 'all' })}>
                          Clear search and filters <ArrowRight size={15} />
                        </button>
                      </div>
                    ) : (
                      <ol className="people-list">
                        {people.map((person, index) => {
                          const rels = results.relations.filter((r) => r.personId === person.id),
                            mapped = rels.some(
                              (r) => results.places.find((p) => p.id === r.placeId)?.coordinates,
                            );
                          return (
                            <li key={person.id}>
                              <button
                                className={`person-card ${person.id === state.person ? 'selected' : ''}`}
                                onClick={() => selectPerson(person.id)}
                                onPointerEnter={(event) => {
                                  if (event.pointerType !== 'touch')
                                    onPreview({
                                      personId: person.id,
                                      anchor: event.currentTarget,
                                      input: 'pointer',
                                    });
                                }}
                                onPointerLeave={() => onPreview(null)}
                                onFocus={(event) => {
                                  if (event.currentTarget.matches(':focus-visible'))
                                    onPreview({
                                      personId: person.id,
                                      anchor: event.currentTarget,
                                      input: 'keyboard',
                                    });
                                }}
                                onBlur={() => onPreview(null)}
                                aria-pressed={person.id === state.person}
                              >
                                <div className="person-card-top">
                                  <Monogram person={person} />
                                  <div>
                                    <span className="person-number">
                                      {String(index + 1).padStart(2, '0')}
                                      <span className="card-hairline" />
                                    </span>
                                    <h3>{displayPersonName(person.name)}</h3>
                                    <p className="person-years">
                                      {person.birthYear
                                        ? `${person.birthYear} — ${person.deathYear ?? ''}`
                                        : person.deathYear
                                          ? `Remembered · ${person.deathYear}`
                                          : 'A life remembered'}
                                    </p>
                                  </div>
                                  <ChevronRight size={16} className="card-arrow" />
                                </div>
                                <p className="card-summary">{person.summary}</p>
                                <div className="card-meta">
                                  <span className="theme-label">{person.themes[0]}</span>
                                  <span>
                                    <MapPin size={12} />
                                    {mapped
                                      ? `${rels.filter((r) => results.places.find((p) => p.id === r.placeId)?.coordinates).length} ${rels.length === 1 ? 'place' : 'places'}`
                                      : 'Not yet mapped'}
                                  </span>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                </div>
              )}
            </aside>
            <div className="map-column">
              {initialized && (
                <ArchiveMap
                  places={mapPlaces}
                  people={people}
                  relations={mapRelations}
                  scope={state.scope}
                  selectedPlaceId={placeOnly?.id ?? selectedPlace?.id ?? null}
                  selectedPersonId={selected?.id ?? null}
                  viewport={state.viewport}
                  resetEpoch={resetEpoch}
                  focusSelection={focusSelection}
                  onSelect={(_personId, placeId) => {
                    // Same rule as the hover preview: a single grave opens its person, any other
                    // marker opens the place, with a way back when a person was already open.
                    const occupant = soleOccupant(archive, placeId);
                    if (occupant) selectPerson(occupant, placeId);
                    else if (selected) openPlace(placeId, selected.id);
                    else selectPlace(placeId);
                  }}
                  onPreview={onPreview}
                  onViewport={onViewport}
                  onFailure={() => setShowResults(true)}
                  resultsOpen={showResults}
                  focus={focusControl}
                  onReturnToCemetery={() => changeScope('cemetery')}
                />
              )}
              {!initialized && (
                <div className="map-loading">
                  <MapIcon />
                  <span>Opening the map…</span>
                </div>
              )}
              {preview && previewTarget && !hasSelection && (
                <MapPreview
                  target={previewTarget}
                  person={preview}
                  place={previewPlace}
                  people={previewPeople}
                />
              )}
              {hasSelection && (
                <aside
                  ref={detailRef}
                  className={`detail-panel ${detailResize.panelClass}`}
                  tabIndex={-1}
                  aria-label={`${placeOnly ? placeOnly.name : selected!.name} preview`}
                >
                  {detailResize.handle}
                  <div className="detail-top">
                    {placeOrigin ? (
                      <button type="button" className="detail-back" onClick={backToPerson}>
                        <ArrowLeft size={16} aria-hidden="true" />
                        <span>Back to {displayPersonName(placeOrigin.name)}</span>
                      </button>
                    ) : (
                      <span className="eyebrow">FROM THE COLLECTION</span>
                    )}
                    <button
                      onClick={closeDetail}
                      aria-label={placeOnly ? 'Close place preview' : 'Close person preview'}
                    >
                      <X size={19} />
                    </button>
                  </div>
                  <div className="detail-scroll" ref={detailScrollRef}>
                    {placeOnly && (
                      <>
                        <div className="detail-place">
                          <span className="theme-label">
                            {placeOnly.scope === 'cemetery'
                              ? 'Grave marker · South-View Cemetery'
                              : 'Place · Atlanta'}
                          </span>
                          <h2>{placeOnly.name}</h2>
                          {placeOnly.address && <p className="person-years">{placeOnly.address}</p>}
                          {placeOnly.coordinates && (
                            <DirectionsLink
                              coordinates={placeOnly.coordinates}
                              name={placeOnly.name}
                            />
                          )}
                        </div>
                        <p className="detail-summary">
                          {placeOnly.summary ||
                            placePeople[0]?.relation.description ||
                            placeOnly.locationNote}
                        </p>
                        <div className="detail-location-note">
                          <span className={`precision-badge precision-${placeOnly.precision}`}>
                            {precisionLabels[placeOnly.precision]}
                          </span>
                          {placeOnly.locationNote &&
                            (placeOnly.summary || placePeople[0]?.relation.description) && (
                              <p className="quiet-note">{placeOnly.locationNote}</p>
                            )}
                        </div>
                        <section className="connected-places" aria-labelledby="panel-place-people">
                          <h3 id="panel-place-people">
                            <UserRound size={16} />
                            {placeOnly.scope === 'cemetery'
                              ? 'Remembered here'
                              : placePeople.length === 1
                                ? 'Connected here'
                                : 'People connected here'}
                          </h3>
                          {placePeople.length === 0 && (
                            <p className="quiet-note">
                              No person has been connected to this place yet.
                            </p>
                          )}
                          {placePeople.map(({ person, relation }) => {
                            const origin = person.id === placeOrigin?.id;
                            return (
                              <article
                                className={`place-person-entry ${origin ? 'is-origin' : ''}`}
                                key={relation.id}
                              >
                                {origin && (
                                  <p className="place-person-origin">
                                    The person whose record led you here
                                  </p>
                                )}
                                <button
                                  type="button"
                                  className="place-person-row"
                                  onClick={() =>
                                    origin ? backToPerson() : selectPerson(person.id, placeOnly.id)
                                  }
                                >
                                  <Monogram person={person} />
                                  <span>
                                    <strong>{displayPersonName(person.name)}</strong>
                                    <small>
                                      {person.birthYear
                                        ? `${person.birthYear} — ${person.deathYear ?? ''} · `
                                        : ''}
                                      {relation.label}
                                    </small>
                                  </span>
                                  {origin ? <ArrowLeft size={15} /> : <ArrowRight size={15} />}
                                </button>
                                {relation.description && (
                                  <p className="relation-note">{relation.description}</p>
                                )}
                              </article>
                            );
                          })}
                        </section>
                      </>
                    )}
                    {selected && !placeOnly && (
                      <>
                        <div className="detail-person">
                          <Monogram person={selected} large />
                          <div className="detail-identity">
                            <span className="theme-label">{selected.themes.join(' · ')}</span>
                            <h2>{displayPersonName(selected.name)}</h2>
                            {!!selected.occupations?.length && (
                              <p className="person-occupations">
                                {selected.occupations.join(' · ')}
                              </p>
                            )}
                            {(selected.birthYear || selected.deathYear) && (
                              <p className="person-years">
                                {selected.birthYear
                                  ? `${selected.birthYear} — ${selected.deathYear ?? ''}`
                                  : `Remembered · ${selected.deathYear}`}
                              </p>
                            )}
                          </div>
                        </div>
                        <p className="detail-summary">{selected.summary}</p>
                        <section className="connected-places">
                          <h3>
                            <MapPin size={16} />
                            Atlanta &amp; South-View
                          </h3>
                          {selectedRelations.length === 0 ? (
                            <p className="quiet-note">
                              No location has been documented in this area yet.
                            </p>
                          ) : (
                            selectedRelations.map((relation) => {
                              const place = archive.places.find((p) => p.id === relation.placeId)!;
                              return (
                                <div
                                  className={`connected-place ${place.id === selectedPlace?.id ? 'is-active' : ''} ${place.coordinates ? 'has-directions' : ''}`}
                                  key={relation.id}
                                >
                                  {place.coordinates && (
                                    <DirectionsLink
                                      coordinates={place.coordinates}
                                      name={place.name}
                                    />
                                  )}
                                  <span className="eyebrow">
                                    {relation.label}
                                    {place.precision === 'reference'
                                      ? ' · reference position'
                                      : place.precision === 'unmapped'
                                        ? ' · not yet mapped'
                                        : ''}
                                  </span>
                                  <button
                                    disabled={!place.coordinates}
                                    aria-current={
                                      place.id === selectedPlace?.id ? 'location' : undefined
                                    }
                                    onClick={() => openPlace(place.id, selected.id)}
                                  >
                                    <strong>{place.name}</strong>
                                    <ArrowUpRight size={15} />
                                  </button>
                                  <p className="relation-note">{relation.description}</p>
                                </div>
                              );
                            })
                          )}
                          <button
                            className="other-scope"
                            onClick={() =>
                              changeScope(state.scope === 'cemetery' ? 'atlanta' : 'cemetery')
                            }
                          >
                            {state.scope === 'cemetery'
                              ? 'See their life across Atlanta'
                              : 'See their resting place'}
                            <ArrowRight size={15} />
                          </button>
                        </section>
                        {selected.portrait && (
                          <p className="portrait-credit">
                            Photo: {selected.portrait.credit}
                            {portraitRights(selected, archive) && (
                              <> · {portraitRights(selected, archive)}</>
                            )}
                            {' · '}
                            <Link
                              href={`/people/${encodeURIComponent(selected.id)}#photo-portrait`}
                            >
                              Source
                            </Link>
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  <div className="detail-bottom">
                    <Link
                      className="full-record-link"
                      href={detailHref}
                      target={state.embed ? '_blank' : undefined}
                      rel={state.embed ? 'noopener noreferrer' : undefined}
                    >
                      <span>Open the full page</span>
                      <ArrowRight size={17} />
                      {state.embed && <span className="sr-only"> (opens in a new tab)</span>}
                    </Link>
                    <button className="copy-record" onClick={() => copyLink('person')}>
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                      {copied ? 'Link copied' : 'Copy permanent link'}
                    </button>
                  </div>
                </aside>
              )}
            </div>
          </div>
        </section>
      </main>
      <noscript>
        <div className="map-no-script">
          <p className="no-script-message">
            JavaScript is required for the interactive map. Browse the records directly:
          </p>
          <ul>
            {archive.people.map((p) => (
              <li key={p.id}>
                <a href={`/people/${p.id}`}>{p.name}</a>
              </li>
            ))}
          </ul>
        </div>
      </noscript>
    </div>
  );
}
