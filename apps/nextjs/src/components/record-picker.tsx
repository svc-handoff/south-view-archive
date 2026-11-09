'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import {
  filterRecordOptions,
  recordDescription,
  RECORD_OPTION_PAGE_SIZE,
  type RecordOption,
} from '@/lib/record-options';

export function RecordPicker({
  label,
  options,
  value,
  onChange,
  multiple = false,
  placeholder = 'Search records…',
  emptyLabel,
}: {
  label: string;
  options: RecordOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  emptyLabel?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const control = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [above, setAbove] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [active, setActive] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const matches = useMemo(() => filterRecordOptions(options, query), [options, query]);
  const lastPage = Math.max(0, Math.ceil(matches.length / RECORD_OPTION_PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = matches.slice(
    currentPage * RECORD_OPTION_PAGE_SIZE,
    (currentPage + 1) * RECORD_OPTION_PAGE_SIZE,
  );
  const selected = value.map(
    (key) => options.find((item) => item.id === key) ?? { id: key, name: 'Unavailable record' },
  );
  const maxReached = multiple && value.length >= 50;
  const activeOption = visible[Math.min(active, visible.length - 1)];
  useLayoutEffect(() => {
    if (!open || !control.current || !menu.current) return;
    const bounds = control.current.getBoundingClientRect();
    const roomBelow = window.innerHeight - bounds.bottom - 16;
    setAbove(
      roomBelow < menu.current.getBoundingClientRect().height && bounds.top - 64 > roomBelow,
    );
  }, [open, visible.length, currentPage, selected.length, emptyLabel]);
  useEffect(() => {
    if (open && activeOption)
      document
        .getElementById(`${id}-option-${activeOption.id}`)
        ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeOption?.id, id]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
        setPage(0);
        setActive(0);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  function choose(option: RecordOption) {
    if (multiple) {
      if (value.includes(option.id)) onChange(value.filter((key) => key !== option.id));
      else if (!maxReached) onChange([...value, option.id]);
      input.current?.focus();
    } else {
      onChange([option.id]);
      setQuery('');
      setOpen(false);
    }
  }
  function movePage(next: number) {
    setPage(next);
    setActive(0);
    input.current?.focus();
  }
  return (
    <div
      ref={root}
      className="record-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setQuery('');
          setPage(0);
          setActive(0);
        }
      }}
    >
      <label className="record-picker-label" htmlFor={id}>
        {label}
      </label>
      {multiple && selected.length > 0 && (
        <ul className="record-picker-tags" aria-label={`Selected ${label.toLowerCase()}`}>
          {(showAll ? selected : selected.slice(0, 4)).map((option) => (
            <li key={option.id}>
              <span>{option.name}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((key) => key !== option.id))}
                aria-label={`Remove ${option.name}`}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
          {selected.length > 4 && (
            <li className="record-picker-more">
              <button type="button" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show fewer' : `+${selected.length - 4} more`}
              </button>
            </li>
          )}
        </ul>
      )}
      <div className="record-picker-control" ref={control} data-above={above}>
        <div className="record-picker-input">
          <Search size={18} aria-hidden="true" />
          <input
            ref={input}
            id={id}
            role="combobox"
            autoComplete="off"
            maxLength={160}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={`${id}-options`}
            aria-describedby={`${id}-help`}
            aria-activedescendant={
              open && activeOption ? `${id}-option-${activeOption.id}` : undefined
            }
            placeholder={placeholder}
            value={open || multiple ? query : (selected[0]?.name ?? '')}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                setQuery('');
                setPage(0);
                setActive(0);
                return;
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setOpen(true);
                if (!open) {
                  setActive(0);
                  return;
                }
                if (event.key === 'ArrowDown') {
                  if (active < visible.length - 1) setActive(active + 1);
                  else if (currentPage < lastPage) {
                    setPage(currentPage + 1);
                    setActive(0);
                  }
                } else if (active > 0) setActive(active - 1);
                else if (currentPage > 0) {
                  setPage(currentPage - 1);
                  setActive(RECORD_OPTION_PAGE_SIZE - 1);
                }
              }
              if (event.key === 'Enter' && open) {
                event.preventDefault();
                if (activeOption) choose(activeOption);
              }
            }}
          />
          {!multiple && value.length > 0 ? (
            <button
              type="button"
              aria-label={`Clear ${label.toLowerCase()}`}
              onClick={() => {
                onChange([]);
                setQuery('');
                setOpen(false);
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : (
            <ChevronDown size={16} aria-hidden="true" />
          )}
        </div>
        {open && (
          <div className="record-picker-results" ref={menu}>
            <div
              className="record-picker-list"
              id={`${id}-options`}
              role="listbox"
              aria-label={label}
              aria-multiselectable={multiple || undefined}
            >
              {visible.map((option) => (
                <div
                  key={option.id}
                  id={`${id}-option-${option.id}`}
                  role="option"
                  aria-selected={value.includes(option.id)}
                  aria-disabled={(maxReached && !value.includes(option.id)) || undefined}
                  className="record-picker-option"
                  data-active={activeOption?.id === option.id}
                  onPointerMove={() => setActive(visible.indexOf(option))}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <span>
                    <strong>{option.name}</strong>
                    {recordDescription(option) && <small>{recordDescription(option)}</small>}
                  </span>
                  {value.includes(option.id) && <Check size={18} aria-hidden="true" />}
                </div>
              ))}
              {!matches.length && (
                <p className="record-picker-no-results">
                  No matches. Try another name or spelling.
                </p>
              )}
            </div>
            {matches.length > RECORD_OPTION_PAGE_SIZE && (
              <div className="record-picker-pages">
                <button
                  type="button"
                  disabled={currentPage === 0}
                  aria-label={`Previous ${label.toLowerCase()} results`}
                  onClick={() => movePage(currentPage - 1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  {currentPage * RECORD_OPTION_PAGE_SIZE + 1}–
                  {Math.min((currentPage + 1) * RECORD_OPTION_PAGE_SIZE, matches.length)} of{' '}
                  {matches.length}
                </span>
                <button
                  type="button"
                  disabled={currentPage === lastPage}
                  aria-label={`Next ${label.toLowerCase()} results`}
                  onClick={() => movePage(currentPage + 1)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            )}
            {emptyLabel && (
              <button
                className="record-picker-empty"
                type="button"
                onClick={() => {
                  onChange([]);
                  setQuery('');
                  setOpen(false);
                }}
              >
                {emptyLabel}
              </button>
            )}
          </div>
        )}
      </div>
      <p className="record-picker-help" id={`${id}-help`} role="status">
        {multiple
          ? `${selected.length} selected${maxReached ? ' · Selection limit reached' : ''}`
          : selected.length
            ? '1 selected'
            : emptyLabel
              ? `Search the archive, or choose “${emptyLabel}”.`
              : 'Search the archive.'}
        {open && ` · ${matches.length} matching ${matches.length === 1 ? 'record' : 'records'}`}
      </p>
    </div>
  );
}
