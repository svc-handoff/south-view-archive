'use client';
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, LocateFixed, X } from 'lucide-react';
import {
  VERIFIED_ACCURACY_METRES,
  type ArchiveData,
  type Person,
  type StaffEdit,
} from '@southview/validators';
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
  if (accuracy <= 5) return { level: 'good', text: 'Excellent · saves as a verified position' };
  if (accuracy <= VERIFIED_ACCURACY_METRES)
    return { level: 'good', text: 'Good · saves as a verified position' };
  if (accuracy <= 25)
    return { level: 'fair', text: 'Fair · saves as a reference position. Waiting may sharpen it' };
  return { level: 'poor', text: 'Poor · step into the open or wait a few seconds' };
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
  return (
    <div className="burial-locate" role="group" aria-label="Map this person’s burial from here">
      <div className="burial-locate-head">
        <strong>
          <LocateFixed size={17} aria-hidden="true" /> Map burial here
        </strong>
        <button type="button" className="community-text-button" onClick={close}>
          <X size={16} aria-hidden="true" /> Cancel
        </button>
      </div>
      {locateError ? (
        <p className="burial-locate-error" role="alert">
          {locateError}{' '}
          <button type="button" className="community-text-button" onClick={start}>
            Try again
          </button>
        </p>
      ) : !best ? (
        <p className="burial-locate-wait" aria-live="polite">
          <LoaderCircle size={16} className="community-spinner" aria-hidden="true" /> Finding your
          position… stand at the grave.
        </p>
      ) : (
        <div className="burial-locate-reading" data-quality={grade!.level} aria-live="polite">
          <span className="burial-locate-accuracy">±{metres} m</span>
          <span>
            {grade!.text}
            {latest && latest !== best && (
              <small> Latest reading ±{Math.round(latest.accuracy)} m; the sharpest is kept.</small>
            )}
          </span>
        </div>
      )}
      {best && (
        <p className="burial-locate-detail">
          {best.coordinates[1].toFixed(6)}, {best.coordinates[0].toFixed(6)}
          {moves !== null && ` · moves the pin ${moves} m`}
          {!graves.length && ' · adds this grave to the map'}
        </p>
      )}
      {moves !== null && moves > FAR_METRES && (
        <p className="burial-locate-error" role="alert">
          That is {moves >= 1000 ? `${(moves / 1000).toFixed(1)} km` : `${moves} m`} from where the
          map has this grave now. Check that this is {displayPersonName(person.name)}’s grave before
          saving.
        </p>
      )}
      {graves.length > 1 && (
        <label className="community-field">
          <span>Which grave</span>
          <select value={placeId} onChange={(event) => setPlaceId(event.target.value)}>
            {graves.map((item) => (
              <option key={item.place.id} value={item.place.id}>
                {item.place.name} · {item.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p className="burial-locate-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="community-primary"
        disabled={!best || busy}
        onClick={() => void save()}
      >
        {busy && <LoaderCircle size={16} className="community-spinner" aria-hidden="true" />}
        {best ? `Save burial position (±${metres} m)` : 'Waiting for a reading'}
      </button>
    </div>
  );
}
