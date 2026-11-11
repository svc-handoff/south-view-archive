'use client';
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, LocateFixed, X } from 'lucide-react';
import {
  VERIFIED_ACCURACY_METRES,
  type ArchiveData,
  type Person,
  type StaffEdit,
} from '@southview/validators';
import { cemeteryArea } from '@/lib/cemetery-area';
import { displayPersonName } from '@/lib/person-name';
import { useStaffRequest } from './admin-shared';

type Reading = { coordinates: [number, number]; accuracy: number; at: number };
/** A reading this far from the grave's current pin is more likely the wrong grave than a fix. */
const FAR_METRES = 75;

/** Metres between two longitude/latitude points. */
function distance(a: [number, number], b: [number, number]) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** How good a reading is, in words staff can act on while standing at the grave. */
function quality(accuracy: number) {
  if (accuracy <= 5) return { level: 'good', text: 'Excellent · saves as verified' };
  if (accuracy <= VERIFIED_ACCURACY_METRES)
    return { level: 'good', text: 'Good · saves as verified' };
  if (accuracy <= 25) return { level: 'fair', text: 'Fair · saves as reference, wait to sharpen' };
  return { level: 'poor', text: 'Poor · step into the open or wait' };
}

const geolocationError = (error: GeolocationPositionError) =>
  error.code === error.PERMISSION_DENIED
    ? 'Location access is blocked. Allow location for this site in the browser settings, then try again.'
    : error.code === error.TIMEOUT
      ? 'No location reading yet. Step into the open and try again.'
      : 'The device could not find its location. Try again in a moment.';

/**
 * Records where a person is buried from the device's location, for staff standing at the grave.
 * Readings keep coming while the panel is open; the most accurate one is saved, with its
 * accuracy, straight onto the person's grave on the map.
 */
export function BurialLocate({
  person,
  archive,
  onSaved,
}: {
  person: Person;
  archive: ArchiveData;
  onSaved: (edits: StaffEdit[], message: string) => void;
}) {
  const graves = archive.relations
    .filter((relation) => relation.personId === person.id)
    .flatMap((relation) => {
      const place = archive.places.find((item) => item.id === relation.placeId);
      return place?.scope === 'cemetery' ? [{ place, label: relation.label }] : [];
    })
    .filter(
      (item, index, all) => all.findIndex((other) => other.place.id === item.place.id) === index,
    );
  const [open, setOpen] = useState(false);
  const [best, setBest] = useState<Reading | null>(null);
  const [latest, setLatest] = useState<Reading | null>(null);
  const [locateError, setLocateError] = useState('');
  const [placeId, setPlaceId] = useState(graves[0]?.place.id ?? '');
  const watch = useRef<number | null>(null);
  const { busy, error, setError, send } = useStaffRequest();

  function stop() {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
  }
  useEffect(() => stop, []);

  function start() {
    setOpen(true);
    setBest(null);
    setLatest(null);
    setLocateError('');
    setError('');
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      setLocateError('This browser cannot share its location here. Open the archive over https.');
      return;
    }
    stop();
    watch.current = navigator.geolocation.watchPosition(
      (position) => {
        const reading: Reading = {
          coordinates: [position.coords.longitude, position.coords.latitude],
          accuracy: position.coords.accuracy,
          at: Date.now(),
        };
        setLocateError('');
        setLatest(reading);
        setBest((current) =>
          !current || reading.accuracy <= current.accuracy ? reading : current,
        );
      },
      (failure) => setLocateError(geolocationError(failure)),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
  }
  function close() {
    stop();
    setOpen(false);
  }

  const target = graves.find((item) => item.place.id === placeId) ?? graves[0];
  const metres = best ? Math.max(1, Math.round(best.accuracy)) : null;
  const moves =
    best && target?.place.coordinates
      ? Math.round(distance(target.place.coordinates, best.coordinates))
      : null;

  async function save() {
    if (!best || !metres) return;
    const edits = await send(
      `/admin/persons/${encodeURIComponent(person.id)}/burial`,
      {
        coordinates: best.coordinates,
        accuracy: best.accuracy,
        ...(graves.length > 1 && target ? { placeId: target.place.id } : {}),
      },
      `Burial position measured at the grave (±${metres} m)`,
    );
    if (!edits) return;
    close();
    onSaved(
      edits,
      `Burial position saved (±${metres} m, ${
        metres <= VERIFIED_ACCURACY_METRES ? 'verified' : 'reference'
      }). It is on the map now and can be undone from the history below.`,
    );
  }

  if (!open)
    return (
      <button type="button" className="burial-locate-start" onClick={start}>
        <LocateFixed size={17} aria-hidden="true" /> Map burial here
      </button>
    );

  const grade = best ? quality(best.accuracy) : null;
  const outside = best ? metresOutsideCemetery(best.coordinates) : 0;
  const warning =
    moves !== null && moves > FAR_METRES
      ? `${away(moves)} from this grave’s current pin. Check it is ${displayPersonName(person.name)}’s grave.`
      : best && outside > best.accuracy + 20
        ? `About ${away(outside)} outside South-View Cemetery. Stand at the grave before saving.`
        : '';
  return (
    <div
      className="burial-locate"
      role="group"
      aria-label="Map this person’s burial from here"
      data-quality={locateError ? 'poor' : (grade?.level ?? 'wait')}
    >
      <div className="burial-locate-row" aria-live="polite">
        <span className="burial-locate-accuracy">
          {best ? (
            `±${metres} m`
          ) : (
            <LocateFixed size={20} className="burial-locate-pulse" aria-hidden="true" />
          )}
        </span>
        <span className="burial-locate-status">
          {locateError ? (
            <>
              {locateError}{' '}
              <button type="button" className="community-text-button" onClick={start}>
                Try again
              </button>
            </>
          ) : grade ? (
            grade.text
          ) : (
            'Finding your position…'
          )}
        </span>
        <button
          type="button"
          className="burial-locate-save"
          disabled={!best || busy}
          onClick={() => void save()}
        >
          {busy && <LoaderCircle size={15} className="community-spinner" aria-hidden="true" />}
          Save
        </button>
        <button
          type="button"
          className="burial-locate-close"
          aria-label="Cancel"
          title="Cancel"
          onClick={close}
        >
          <X size={17} aria-hidden="true" />
        </button>
      </div>
      {best && (
        <p className="burial-locate-detail">
          {best.coordinates[1].toFixed(6)}, {best.coordinates[0].toFixed(6)}
          {moves !== null && ` · moves the pin ${moves} m`}
          {!graves.length && ' · adds this grave to the map'}
          {latest && latest !== best && ` · latest ±${Math.round(latest.accuracy)} m`}
        </p>
      )}
      {graves.length > 1 && (
        <select
          className="burial-locate-choice"
          aria-label="Which grave"
          value={placeId}
          onChange={(event) => setPlaceId(event.target.value)}
        >
          {graves.map((item) => (
            <option key={item.place.id} value={item.place.id}>
              {item.place.name} · {item.label}
            </option>
          ))}
        </select>
      )}
      {(warning || error) && (
        <p className="burial-locate-warning" role="alert">
          {error || warning}
        </p>
      )}
    </div>
  );
}

const away = (metres: number) =>
  metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;

/** 0 inside the cemetery outline; outside it, roughly how far to its nearest corner, in metres. */
export function metresOutsideCemetery(point: [number, number]) {
  const ring = cemeteryArea.geometry.coordinates[0] as [number, number][];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside ? 0 : Math.min(...ring.map((corner) => distance(corner, point)));
}
