'use client';

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

const ErrorsContext = createContext<Record<string, string>>({});

/** Scope feedback to this form, and reveal the first invalid field after a failed attempt. */
export function FieldValidation({
  errors,
  onFieldChange,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  errors: Record<string, string>;
  onFieldChange?: (name: string) => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef(errors);
  useEffect(() => {
    const cleared =
      Object.keys(errors).length < Object.keys(previous.current).length &&
      Object.entries(errors).every(([name, message]) => previous.current[name] === message);
    previous.current = errors;
    if (!Object.keys(errors).length || cleared) return;
    const frame = requestAnimationFrame(() => {
      const field = root.current?.querySelector<HTMLElement>('[data-validation-field].has-error');
      if (!field) return;
      for (let parent = field.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      const control = field.querySelector<HTMLElement>(
        'input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)',
      );
      (control ?? field).focus({ preventScroll: true });
      field.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [errors]);
  return (
    <ErrorsContext.Provider value={errors}>
      <div
        {...props}
        ref={root}
        onChangeCapture={(event) => {
          const field = (event.target as HTMLElement).closest<HTMLElement>(
            '[data-validation-field]',
          );
          if (field?.dataset.validationField) onFieldChange?.(field.dataset.validationField);
          props.onChangeCapture?.(event);
        }}
      >
        {children}
      </div>
    </ErrorsContext.Provider>
  );
}

export function ValidatedField({
  name,
  as: Tag = 'label',
  className = 'community-field',
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  name: string;
  as?: 'label' | 'div';
  children: ReactNode;
}) {
  const errors = useContext(ErrorsContext);
  const error = errors[name];
  const id = useId();
  const root = useRef<HTMLLabelElement & HTMLDivElement>(null);
  useEffect(() => {
    if (!error) return;
    const controls = [...(root.current?.querySelectorAll('input, textarea, select') ?? [])];
    const restore = controls.map((control) => ({
      control,
      invalid: control.getAttribute('aria-invalid'),
      described: control.getAttribute('aria-describedby'),
    }));
    for (const { control, described } of restore) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', [described, id].filter(Boolean).join(' '));
    }
    return () => {
      for (const { control, invalid, described } of restore) {
        if (invalid === null) control.removeAttribute('aria-invalid');
        else control.setAttribute('aria-invalid', invalid);
        if (described === null) control.removeAttribute('aria-describedby');
        else control.setAttribute('aria-describedby', described);
      }
    };
  }, [error, id]);
  return (
    <Tag
      {...props}
      ref={root}
      data-validation-field={name}
      tabIndex={-1}
      className={`${className}${error ? ' has-error' : ''}`}
    >
      {children}
      {error && (
        <small id={id} className="community-field-error" role="alert">
          {error}
        </small>
      )}
    </Tag>
  );
}
