'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapInstance, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Compass,
  Focus,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Minus,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import type { Person, PersonPlace, Place, Scope } from '@southview/validators';
import type { Viewport } from '@/lib/explore-state';
import { createMarkerHoverController, type PreviewTarget } from '@/lib/explore-preview';
import {
  cemeteryArea,
  cemeteryBounds,
  cemeteryCenter,
  mapPadding,
  overviewBounds,
} from '@/lib/cemetery-area';

type Props = {
  places: Place[];
  people: Person[];
  relations: PersonPlace[];
  scope: Scope;
  selectedPlaceId: string | null;
  selectedPersonId: string | null;
  viewport: Viewport | null;
  resetEpoch: number;
  focusSelection: boolean;
  resultsOpen: boolean;
  /** With a record open: whether the map shows only its places, and the control to change it. */
  focus?: { name: string; kind: 'person' | 'place'; only: boolean; onToggle: () => void };
  onSelect: (personId: string, placeId: string) => void;
  onPreview: (target: PreviewTarget | null) => void;
  onViewport: (v: Viewport, autoScope: boolean) => void;
  onFailure: () => void;
  onReturnToCemetery: () => void;
};
export const mapDefaults = {
  cemetery: { center: cemeteryCenter, zoom: 15.4 },
  atlanta: { center: [-84.3942, 33.7535] as [number, number], zoom: 12.65 },
};

/** One clustered source per marker kind: graves stay wine, city places stay green. */
const markerKinds = [
  { source: 'archive-graves', scope: 'cemetery', color: '#722d3c' },
  { source: 'archive-places', scope: 'atlanta', color: '#4f5a46' },
] as const;

export default function ArchiveMap(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const cameraInitialized = useRef(false);
  const current = useRef(props);
  current.current = props;
  const markerHover = useMemo(
    () => createMarkerHoverController<PreviewTarget>((target) => current.current.onPreview(target)),
    [],
  );
  const markerRefs = useRef(new Map<string, { marker: Marker; element: HTMLButtonElement }>());
  /** The marker the pointer (or keyboard focus) rests on; unrelated markers fade meanwhile. */
  const hoveredPlace = useRef<string | null>(null);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [tileWarning, setTileWarning] = useState(false);
  // "My location": offered once the browser is known to provide positions (decided after
  // mount so the server and the first render agree). The map centres there; no marker is kept.
  const [canLocate, setCanLocate] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState('');
  useEffect(() => {
    setCanLocate('geolocation' in navigator && window.isSecureContext);
  }, []);
  // The notice is a passing toast: it clears itself after a few seconds.
  useEffect(() => {
    if (!locateError) return;
    const timer = window.setTimeout(() => setLocateError(''), 5000);
    return () => window.clearTimeout(timer);
  }, [locateError]);
  const locate = () => {
    const map = mapRef.current;
    if (!map || locating) return;
    setLocating(true);
    setLocateError('');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        const live = mapRef.current;
        if (!live) return;
        // Inside the cemetery, close enough to tell graves apart; anywhere else, a neighbourhood
        // view, which also switches the map to its Atlanta places.
        const atCemetery =
          coords.longitude >= cemeteryBounds[0][0] &&
          coords.longitude <= cemeteryBounds[1][0] &&
          coords.latitude >= cemeteryBounds[0][1] &&
          coords.latitude <= cemeteryBounds[1][1];
        live.easeTo(
          {
            center: [coords.longitude, coords.latitude],
            zoom: atCemetery ? 17 : 14,
            duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600,
          },
          { autoScope: true },
        );
      },
      (failure) => {
        setLocating(false);
        setLocateError(
          failure.code === failure.PERMISSION_DENIED
            ? 'Location access refused.'
            : 'Position not found.',
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };
  const refreshMarkers = useRef<() => void>(() => {});

  useEffect(() => {
    if (!container.current) return;
    let map: MapInstance | undefined;
    let disposed = false;
    let didLoad = false;
    let tileErrors = 0;
    let hoverFrame = 0;
    const clearHover = () => markerHover.clear();
    const dismissHover = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearHover();
    };
    window.addEventListener('blur', clearHover);
    window.addEventListener('keydown', dismissHover);
    cameraInitialized.current = false;
    setError(false);
    setReady(false);
    setTileWarning(false);
    const fail = () => {
      if (!disposed) {
        setError(true);
        current.current.onFailure();
      }
    };
    try {
      maplibregl.setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs');
      const v = current.current.viewport,
        def = mapDefaults[current.current.scope];
      map = new maplibregl.Map({
        container: container.current,
        style:
          process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron',
        center: v ? [v.lng, v.lat] : def.center,
        zoom: v?.zoom ?? def.zoom,
        minZoom: 3,
        maxZoom: 19,
        attributionControl: false,
        pitchWithRotate: false,
        dragRotate: false,
        cooperativeGestures: container.current.closest('.is-embedded') !== null,
        renderWorldCopies: false,
      });
      mapRef.current = map;
      // No attribution control: on a phone it drifted around the bottom sheet.
      map.on('error', () => {
        tileErrors++;
        if (!disposed && tileErrors >= 1) setTileWarning(true);
      });
      map.on('load', () => {
        if (disposed || !map) return;
        didLoad = true;
        map.addSource('south-view-area', {
          type: 'geojson',
          data: cemeteryArea,
          attribution:
            '<a href="https://gismaps.fultoncountyga.gov/arcgispub/rest/services/OpenData/Tax_Parcels/MapServer" target="_blank" rel="noreferrer">Cemetery outline: Fulton County parcels</a>',
        });
        map.addLayer({
          id: 'south-view-fill',
          type: 'fill',
          source: 'south-view-area',
          paint: { 'fill-color': '#743444', 'fill-opacity': 0.14 },
        });
        map.addLayer({
          id: 'south-view-halo',
          type: 'line',
          source: 'south-view-area',
          paint: { 'line-color': '#743444', 'line-width': 9, 'line-blur': 4, 'line-opacity': 0.18 },
        });
        map.addLayer({
          id: 'south-view-outline',
          type: 'line',
          source: 'south-view-area',
          paint: { 'line-color': '#743444', 'line-width': 2, 'line-opacity': 0.8 },
        });
        map.addSource('south-view-label', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: cemeteryCenter },
          },
        });
        map.addLayer({
          id: 'south-view-label',
          type: 'symbol',
          source: 'south-view-label',
          minzoom: 8,
          layout: {
            'text-field': 'South-View Cemetery',
            'text-font': [process.env.NEXT_PUBLIC_MAP_FONT || 'Noto Sans Regular'],
            'text-size': 13,
            'text-anchor': 'center',
            'text-allow-overlap': false,
          },
          paint: { 'text-color': '#652b3a', 'text-halo-color': '#fffcf6', 'text-halo-width': 2 },
        });
        // Graves and city places cluster separately, each in its own colour, so a zoomed-out
        // map never folds a grave into a green cluster or a church into a wine one.
        for (const kind of markerKinds) {
          map.addSource(kind.source, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            cluster: true,
            clusterMaxZoom: 13,
            clusterRadius: 60,
          });
          map.addLayer({
            id: `${kind.source}-points`,
            type: 'circle',
            source: kind.source,
            filter: ['!', ['has', 'point_count']],
            paint: {
              // Drawn as HTML above the pins instead (see the anchor dots below); kept for queries.
              'circle-radius': 4,
              'circle-color': kind.color,
              'circle-opacity': 0,
              'circle-stroke-opacity': 0,
            },
          });
          map.addLayer({
            id: `${kind.source}-clusters`,
            type: 'circle',
            source: kind.source,
            filter: ['has', 'point_count'],
            paint: {
              'circle-color': kind.color,
              'circle-radius': 22,
              'circle-stroke-width': 4,
              'circle-stroke-color': '#fcf8ef',
            },
          });
          map.addLayer({
            id: `${kind.source}-cluster-count`,
            type: 'symbol',
            source: kind.source,
            filter: ['has', 'point_count'],
            layout: {
              'text-field': ['get', 'point_count_abbreviated'],
              'text-font': [process.env.NEXT_PUBLIC_MAP_FONT || 'Noto Sans Regular'],
              'text-size': 14,
            },
            paint: { 'text-color': '#fffaf1' },
          });
          map.on('click', `${kind.source}-clusters`, async (event) => {
            const feature = event.features?.[0];
            if (!feature || feature.geometry.type !== 'Point' || !map) return;
            try {
              const zoom = await (
                map.getSource(kind.source) as GeoJSONSource
              ).getClusterExpansionZoom(Number(feature.properties?.cluster_id));
              if (!disposed)
                map.easeTo(
                  {
                    center: feature.geometry.coordinates as [number, number],
                    zoom,
                    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                      ? 0
                      : 500,
                  },
                  { autoScope: true },
                );
            } catch {
              /* A source refresh can invalidate a cluster; the next click uses current data. */
            }
          });
          map.on('mouseenter', `${kind.source}-clusters`, () => {
            if (map) map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', `${kind.source}-clusters`, () => {
            if (map) map.getCanvas().style.cursor = '';
          });
        }
        setReady(true);
      });
      map.on('moveend', (event) => {
        // Wait for marker transforms and pointer hit testing to reach the final frame.
        cancelAnimationFrame(hoverFrame);
        hoverFrame = requestAnimationFrame(() => {
          if (!disposed && map && !map.isMoving())
            markerHover.endMove(
              ({ anchor }) => document.hasFocus() && anchor.isConnected && anchor.matches(':hover'),
            );
        });
        // ResizeObserver may fire before the first fitted view. Do not save that provisional camera.
        if (!map || disposed || !cameraInitialized.current) return;
        const c = map.getCenter();
        current.current.onViewport(
          { lng: c.lng, lat: c.lat, zoom: map.getZoom() },
          Boolean(event.originalEvent || ('autoScope' in event && event.autoScope)),
        );
        refreshMarkers.current();
      });
      map.on('movestart', () => markerHover.startMove());
      map.on('sourcedata', (event) => {
        if (markerKinds.some((kind) => kind.source === event.sourceId) && event.isSourceLoaded)
          refreshMarkers.current();
      });
      const canvas = map.getCanvas();
      canvas.setAttribute(
        'aria-label',
        'Interactive history map. Use Browse people to access all records without using the map.',
      );
      canvas.addEventListener('webglcontextlost', fail);
    } catch {
      fail();
    }
    const observer = new ResizeObserver(() => map?.resize());
    observer.observe(container.current);
    const timeout = window.setTimeout(() => {
      if (!disposed && map && !didLoad) fail();
    }, 14000);
    return () => {
      disposed = true;
      observer.disconnect();
      clearTimeout(timeout);
      cancelAnimationFrame(hoverFrame);
      markerHover.clear();
      window.removeEventListener('blur', clearHover);
      window.removeEventListener('keydown', dismissHover);
      markerRefs.current.forEach((m) => m.marker.remove());
      markerRefs.current.clear();
      map?.remove();
      mapRef.current = null;
    };
  }, [retry, markerHover]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const kind of markerKinds) {
      const source = map.getSource(kind.source) as GeoJSONSource;
      source.setData({
        type: 'FeatureCollection',
        features: props.places
          .filter((p) => p.coordinates && p.scope === kind.scope)
          .map((p) => ({
            type: 'Feature' as const,
            id: p.id,
            geometry: { type: 'Point' as const, coordinates: p.coordinates! },
            properties: { placeId: p.id },
          })),
      });
    }
  }, [ready, props.places]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    // Markers that share no person with the rested-on marker fade, clusters with them, so the
    // places of one life stand out. Nothing fades once the pointer leaves.
    const applyDim = () => {
      const hovered = hoveredPlace.current;
      const related = new Set<string>();
      if (hovered && markerRefs.current.has(hovered)) {
        const people = new Set(
          current.current.relations.filter((r) => r.placeId === hovered).map((r) => r.personId),
        );
        for (const r of current.current.relations)
          if (people.has(r.personId)) related.add(r.placeId);
        related.add(hovered);
      }
      const dimming = related.size > 0;
      markerRefs.current.forEach((entry, id) =>
        entry.element.classList.toggle('is-dimmed', dimming && !related.has(id)),
      );
      for (const kind of markerKinds) {
        if (!map.getLayer(`${kind.source}-clusters`)) continue;
        map.setPaintProperty(`${kind.source}-clusters`, 'circle-opacity', dimming ? 0.3 : 1);
        map.setPaintProperty(`${kind.source}-clusters`, 'circle-stroke-opacity', dimming ? 0.3 : 1);
        map.setPaintProperty(`${kind.source}-cluster-count`, 'text-opacity', dimming ? 0.3 : 1);
      }
    };
    const rest = (placeId: string) => {
      hoveredPlace.current = placeId;
      applyDim();
    };
    const unrest = (placeId: string) => {
      if (hoveredPlace.current !== placeId) return;
      hoveredPlace.current = null;
      applyDim();
    };
    const render = () => {
      if (!mapRef.current || markerKinds.some((kind) => !map.getSource(kind.source))) return;
      const unclustered = new Set(
        markerKinds.flatMap((kind) =>
          map
            .querySourceFeatures(kind.source, { filter: ['!', ['has', 'point_count']] })
            .map((f) => String(f.properties?.placeId)),
        ),
      );
      const visiblePlaces = current.current.places.filter(
        (p) => p.coordinates && unclustered.has(p.id),
      );
      const visibleIds = new Set(visiblePlaces.map((p) => p.id));
      markerRefs.current.forEach((entry, id) => {
        if (!visibleIds.has(id)) {
          markerHover.leave(entry.element);
          if (hoveredPlace.current === id) hoveredPlace.current = null;
          entry.marker.remove();
          markerRefs.current.delete(id);
        }
      });
      visiblePlaces.forEach((place) => {
        const personIds = current.current.relations
          .filter((r) => r.placeId === place.id)
          .map((r) => r.personId);
        const personId = personIds.includes(current.current.selectedPersonId ?? '')
          ? current.current.selectedPersonId!
          : personIds[0];
        const person = current.current.people.find((p) => p.id === personId);
        if (!person) return;
        const previous = markerRefs.current.get(place.id);
        const el = previous?.element ?? document.createElement('button');
        el.type = 'button';
        el.dataset.placeId = place.id;
        el.classList.add('map-marker');
        // Grave markers and related city places use different colours and core shapes.
        el.classList.toggle('is-cemetery', place.scope === 'cemetery');
        el.classList.toggle('is-atlanta', place.scope !== 'cemetery');
        el.classList.toggle('is-selected', current.current.selectedPlaceId === place.id);
        const names = personIds
          .map((id) => current.current.people.find((p) => p.id === id)?.name)
          .filter((name): name is string => !!name);
        el.setAttribute(
          'aria-label',
          `${place.name}. ${place.scope === 'cemetery' ? 'Grave marker' : 'Related place'}${names.length ? ` of ${names.join(', ')}` : ''}. ${place.precision === 'reference' ? 'Reference location.' : ''}`.trim(),
        );
        el.setAttribute('aria-pressed', String(current.current.selectedPlaceId === place.id));
        // Fixed geometry: the SVG's bottom tip is the Marker's bottom-centre anchor.
        // Labels are absolute, so selecting a place cannot change the marker's dimensions.
        if (!previous) {
          // Preserve the hit target and SVG across selection updates, including
          // updates triggered by the pointer currently resting on this marker.
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 32 42');
          svg.setAttribute('class', 'marker-pin');
          svg.setAttribute('aria-hidden', 'true');
          svg.setAttribute('focusable', 'false');
          const pin = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          pin.setAttribute('class', 'marker-pin-body');
          pin.setAttribute('d', 'M16 42C14 37 1 25 1 16A15 15 0 0 1 31 16C31 25 18 37 16 42Z');
          const core =
            place.scope === 'cemetery'
              ? document.createElementNS('http://www.w3.org/2000/svg', 'circle')
              : document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          core.setAttribute('class', 'marker-pin-core');
          if (place.scope === 'cemetery') {
            core.setAttribute('cx', '16');
            core.setAttribute('cy', '16');
            core.setAttribute('r', '5');
          } else {
            core.setAttribute('x', '11.5');
            core.setAttribute('y', '11.5');
            core.setAttribute('width', '9');
            core.setAttribute('height', '9');
            core.setAttribute('transform', 'rotate(45 16 16)');
          }
          svg.append(pin, core);
          el.append(svg);
          const dot = document.createElement('span');
          dot.className = 'marker-position-dot';
          dot.setAttribute('aria-hidden', 'true');
          el.append(dot);
          const label = document.createElement('span');
          label.className = 'marker-label';
          el.append(label);
        }
        const label = el.querySelector<HTMLElement>('.marker-label')!;
        label.textContent = place.name;
        label.hidden = current.current.selectedPlaceId !== place.id;
        el.onclick = () => current.current.onSelect(person.id, place.id);
        el.onpointerenter = (event) => {
          if (event.pointerType === 'touch') return;
          rest(place.id);
          markerHover.enter({
            personId: person.id,
            placeId: place.id,
            anchor: el,
            input: 'pointer',
          });
        };
        el.onpointerleave = () => {
          unrest(place.id);
          markerHover.leave(el);
        };
        el.onfocus = () => {
          if (el.matches(':focus-visible')) {
            rest(place.id);
            markerHover.clear();
            current.current.onPreview({
              personId: person.id,
              placeId: place.id,
              anchor: el,
              input: 'keyboard',
            });
          }
        };
        el.onblur = () => {
          unrest(place.id);
          current.current.onPreview(null);
        };
        if (!previous)
          markerRefs.current.set(place.id, {
            element: el,
            marker: new maplibregl.Marker({
              element: el,
              anchor: 'bottom',
              offset: [0, 0],
              subpixelPositioning: true,
            })
              .setLngLat(place.coordinates!)
              .addTo(map),
          });
        else previous.marker.setLngLat(place.coordinates!);
      });
      // Pins further south sit in front of those further north, the selected pin in front of all.
      // Each pin carries its own position dot, so a pin and its dot are always at the same depth.
      [...visiblePlaces]
        .sort((a, b) => b.coordinates![1] - a.coordinates![1])
        .forEach((place, index) => {
          const entry = markerRefs.current.get(place.id);
          if (!entry) return;
          entry.element.style.zIndex =
            current.current.selectedPlaceId === place.id ? '1000' : String(10 + index);
        });
      applyDim();
    };
    refreshMarkers.current = render;
    render();
  }, [
    ready,
    props.places,
    props.relations,
    props.people,
    props.selectedPlaceId,
    props.selectedPersonId,
    markerHover,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const value = current.current;
    const v = value.viewport;
    const size = map.getContainer();
    const padding = mapPadding(
      size.clientWidth,
      size.clientHeight,
      !!value.selectedPersonId,
      value.resultsOpen,
    );
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 550;
    cameraInitialized.current = true;
    if (v) {
      map.jumpTo({
        center: [v.lng, v.lat],
        zoom: v.zoom,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      });
    } else {
      const place =
        value.focusSelection && value.places.find((p) => p.id === value.selectedPlaceId);
      if (place && place.coordinates) {
        // An offset shifts the camera, not the marker; URL coordinates still describe the true centre.
        map.easeTo({
          center: place.coordinates,
          zoom: place.scope === 'cemetery' ? 17 : 15,
          offset: [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2],
          duration,
        });
      } else {
        const camera = map.cameraForBounds(overviewBounds(value.places, value.scope), {
          padding,
          maxZoom: value.scope === 'cemetery' ? 16 : 13,
        });
        if (camera)
          map.easeTo({ ...camera, padding: { top: 0, right: 0, bottom: 0, left: 0 }, duration });
      }
    }
    // Only explicit navigation requests move the camera. Automatic scope changes keep the user's view.
  }, [ready, props.resetEpoch]);

  return (
    <div className="map-surface" aria-label="Map of connected places">
      <div className="map-canvas" ref={container} />
      {!ready && !error && (
        <div className="map-loading" role="status">
          <Compass size={26} />
          <span>Opening the map…</span>
        </div>
      )}
      {error && (
        <div className="map-error">
          <MapPin size={30} />
          <h3>The stories are still here.</h3>
          <p>
            This browser couldn’t display the map. You can explore every record in the people list.
          </p>
          <button className="archive-button" onClick={() => setRetry((n) => n + 1)}>
            <RefreshCw size={16} /> Retry map
          </button>
        </div>
      )}
      {tileWarning && !error && (
        <div className="map-warning" role="status">
          The basemap is having trouble loading. All records remain available in the list.
          <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
        </div>
      )}
      <div className="map-controls">
        <button
          onClick={() => mapRef.current?.zoomIn({}, { autoScope: true })}
          aria-label="Zoom in"
        >
          <Plus size={19} />
        </button>
        <button
          onClick={() => mapRef.current?.zoomOut({}, { autoScope: true })}
          aria-label="Zoom out"
        >
          <Minus size={19} />
        </button>
        <span aria-hidden="true" />
        {canLocate && (
          <button
            onClick={locate}
            disabled={locating}
            aria-label="Centre the map on my location"
            title="Centre the map on my location"
          >
            {locating ? (
              <LoaderCircle size={19} className="map-spin" aria-hidden="true" />
            ) : (
              <LocateFixed size={19} aria-hidden="true" />
            )}
          </button>
        )}
        <button
          onClick={props.onReturnToCemetery}
          aria-label="Centre the map on South-View Cemetery"
          title="Centre the map on South-View Cemetery"
        >
          {/* A headstone: the archive's own mark for the cemetery. */}
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 21V10a6 6 0 0 1 12 0v11" />
            <path d="M3.5 21h17" />
            <path d="M12 8v6" />
            <path d="M9.5 10.5h5" />
          </svg>
        </button>
      </div>
      <div className="map-north" aria-hidden="true">
        <Compass size={28} strokeWidth={1} />
        <span>N</span>
      </div>
      {locateError && (
        <div className="map-warning map-toast" role="status">
          {locateError}
          <button onClick={() => setLocateError('')} aria-label="Dismiss">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="map-credit">
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap
        </a>
        {' · '}
        <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
          OpenFreeMap
        </a>
      </div>
      <div className="map-caption" aria-label="Map legend">
        {props.focus && (
          <button
            type="button"
            className="map-focus-toggle"
            aria-pressed={props.focus.only}
            onClick={props.focus.onToggle}
            title={
              props.focus.only
                ? 'Show every marker again'
                : props.focus.kind === 'person'
                  ? `Hide every marker except ${props.focus.name}'s places`
                  : `Hide every marker except ${props.focus.name} and the places of the people connected to it`
            }
          >
            <Focus size={13} aria-hidden="true" />
            {props.focus.only
              ? `Only ${props.focus.name}`
              : props.focus.kind === 'person'
                ? 'Only this person'
                : 'Only this place'}
          </button>
        )}
        <span>
          <span className="legend-pin legend-pin-grave" aria-hidden="true" /> Grave marker
        </span>
        <span>
          <span className="legend-pin legend-pin-place" aria-hidden="true" /> Related place
        </span>
        <span>
          <span className="cemetery-key" aria-hidden="true" />{' '}
          <a
            href={cemeteryArea.properties.sourceUrl}
            target="_blank"
            rel="noreferrer"
            title="Cemetery outline from the Fulton County tax parcels the South View Cemetery Association owns; not a surveyed boundary."
          >
            South-View area
          </a>
        </span>
      </div>
    </div>
  );
}
