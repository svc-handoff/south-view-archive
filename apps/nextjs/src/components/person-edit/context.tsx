'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { RecordOption } from '@/lib/record-options';
import {
  blockToSubmissionInput,
  editSessionKey,
  groupedReceiptUrl,
  restoreEditSession,
  serializeEditSession,
  MAX_EDIT_BLOCKS,
  type EditBlock,
  type EditContact,
  type EditKind,
  type EditSection,
} from '@/lib/person-edit';
import { sendContribution } from '@/lib/send-contribution';
import './person-edit.css';

export type SlotId = { section: EditSection; anchor?: string };
type Phase = 'edit' | 'preview';
type EditState = {
  person: { id: string; name: string };
  places: RecordOption[];
  editing: boolean;
  phase: Phase;
  blocks: EditBlock[];
  activeSlot: SlotId | null;
  activeKind: EditKind;
  editingBlockId: string | null;
  sendOpen: boolean;
  sending: boolean;
  progress: string;
  error: string;
  start: () => void;
  exit: () => void;
  setPhase: (phase: Phase) => void;
  openSlot: (slot: SlotId, kind: EditKind) => void;
  closeSlot: () => void;
  editBlock: (id: string) => void;
  saveBlock: (block: EditBlock) => void;
  removeBlock: (id: string) => void;
  openSend: () => void;
  closeSend: () => void;
  send: (contact: EditContact) => Promise<void>;
};
const EditContext = createContext<EditState | null>(null);

export function usePersonEdit() {
  const value = useContext(EditContext);
  if (!value) throw new Error('usePersonEdit must be used inside PersonEditProvider.');
  return value;
}

const sameSlot = (a: SlotId | null, b: SlotId) =>
  !!a && a.section === b.section && (a.anchor ?? '') === (b.anchor ?? '');

export function PersonEditProvider({
  person,
  places,
  startEditing = false,
  children,
}: {
  person: { id: string; name: string };
  places: RecordOption[];
  startEditing?: boolean;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [phase, setPhase] = useState<Phase>('edit');
  const [blocks, setBlocks] = useState<EditBlock[]>([]);
  const [activeSlot, setActiveSlot] = useState<SlotId | null>(null);
  const [activeKind, setActiveKind] = useState<EditKind>('addition');
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const receiptToken = useRef('');
  const previews = useRef(new Set<string>());

  useEffect(() => {
    try {
      const restored = restoreEditSession(
        JSON.parse(sessionStorage.getItem(editSessionKey(person.id)) ?? 'null'),
      );
      if (restored) {
        receiptToken.current = restored.receiptToken;
        setBlocks(restored.blocks);
        if (restored.blocks.length) setEditing(true);
      }
    } catch {
      /* Session storage may be unavailable; the token below still works for this visit. */
    }
    if (!receiptToken.current) receiptToken.current = crypto.randomUUID() + crypto.randomUUID();
    setReady(true);
  }, [person.id]);

  useEffect(() => {
    if (!ready) return;
    try {
      if (blocks.length)
        sessionStorage.setItem(
          editSessionKey(person.id),
          serializeEditSession({ receiptToken: receiptToken.current, blocks }),
        );
      else sessionStorage.removeItem(editSessionKey(person.id));
    } catch {
      /* Draft text then lives only in memory for this page view. */
    }
  }, [blocks, ready, person.id]);

  // Keep ?edit=1 in the address bar so reloads and shared links reopen the mode.
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    if (editing) url.searchParams.set('edit', '1');
    else url.searchParams.delete('edit');
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`)
      window.history.replaceState(window.history.state, '', next);
  }, [editing, ready]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (blocks.some((block) => block.photos.length)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    const urls = previews.current;
    return () => {
      window.removeEventListener('beforeunload', warn);
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [blocks]);

  const start = useCallback(() => {
    setEditing(true);
    setPhase('edit');
    setError('');
  }, []);
  const exit = useCallback(() => {
    if (
      blocks.length &&
      !window.confirm('Leave editing? Your unsent additions stay in this tab until you close it.')
    )
      return;
    setEditing(false);
    setActiveSlot(null);
    setEditingBlockId(null);
    setSendOpen(false);
    setPhase('edit');
  }, [blocks.length]);
  const openSlot = useCallback((slot: SlotId, kind: EditKind) => {
    setEditingBlockId(null);
    setActiveKind(kind);
    setActiveSlot((current) => (sameSlot(current, slot) ? current : slot));
    setError('');
  }, []);
  const closeSlot = useCallback(() => {
    setActiveSlot(null);
    setEditingBlockId(null);
  }, []);
  const editBlock = useCallback(
    (id: string) => {
      const block = blocks.find((item) => item.id === id);
      if (!block) return;
      setPhase('edit');
      setActiveKind(block.kind);
      setActiveSlot({ section: block.section, anchor: block.anchor });
      setEditingBlockId(id);
    },
    [blocks],
  );
  const saveBlock = useCallback((block: EditBlock) => {
    block.photos.forEach((photo) => previews.current.add(photo.preview));
    setBlocks((current) => {
      const index = current.findIndex((item) => item.id === block.id);
      if (index >= 0) return current.map((item) => (item.id === block.id ? block : item));
      if (current.length >= MAX_EDIT_BLOCKS) return current;
      return [...current, block];
    });
    setActiveSlot(null);
    setEditingBlockId(null);
  }, []);
  const removeBlock = useCallback((id: string) => {
    setBlocks((current) => {
      current
        .find((item) => item.id === id)
        ?.photos.forEach((photo) => {
          URL.revokeObjectURL(photo.preview);
          previews.current.delete(photo.preview);
        });
      return current.filter((item) => item.id !== id);
    });
    setEditingBlockId((current) => (current === id ? null : current));
  }, []);
  const openSend = useCallback(() => {
    setError('');
    setSendOpen(true);
  }, []);
  const closeSend = useCallback(() => {
    if (!sending) setSendOpen(false);
  }, [sending]);
  const send = useCallback(
    async (contact: EditContact) => {
      if (!blocks.length || sending) return;
      setSending(true);
      setError('');
      const ids: string[] = [];
      try {
        for (const [index, block] of blocks.entries()) {
          const prefix = blocks.length > 1 ? `Addition ${index + 1} of ${blocks.length}: ` : '';
          const result = await sendContribution({
            input: blockToSubmissionInput(block, person, contact),
            receiptToken: receiptToken.current,
            photos: block.photos,
            onProgress: (message) => setProgress(prefix + message),
          });
          ids.push(result.id);
        }
        try {
          sessionStorage.removeItem(editSessionKey(person.id));
        } catch {
          /* Nothing to clear. */
        }
        window.location.assign(groupedReceiptUrl(ids, receiptToken.current));
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : 'Your additions could not be sent. They are still here; please try again.',
        );
        setSending(false);
        setProgress('');
      }
    },
    [blocks, person, sending],
  );

  const value = useMemo<EditState>(
    () => ({
      person,
      places,
      editing,
      phase,
      blocks,
      activeSlot,
      activeKind,
      editingBlockId,
      sendOpen,
      sending,
      progress,
      error,
      start,
      exit,
      setPhase,
      openSlot,
      closeSlot,
      editBlock,
      saveBlock,
      removeBlock,
      openSend,
      closeSend,
      send,
    }),
    [
      person,
      places,
      editing,
      phase,
      blocks,
      activeSlot,
      activeKind,
      editingBlockId,
      sendOpen,
      sending,
      progress,
      error,
      start,
      exit,
      openSlot,
      closeSlot,
      editBlock,
      saveBlock,
      removeBlock,
      openSend,
      closeSend,
      send,
    ],
  );
  return (
    <EditContext.Provider value={value}>
      <div className={`person-edit-root ${editing ? 'is-editing' : ''} is-${phase}`}>
        {children}
      </div>
    </EditContext.Provider>
  );
}

export { sameSlot };
