import { Plus, X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { MAX_ATTACHED_LINKS } from '../../lib/schemas/attached-link';
import type { useFormValidation } from '../../lib/use-form-validation';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { FieldError } from '../ui/field';
import type { AttachedLinkValue } from './AttachedLinkFields';

const inputClass =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60';
const fieldClass = 'block space-y-1.5 text-sm font-medium text-foreground';

/** The slice of `useFormValidation` the list needs. */
type Bound = Pick<
  ReturnType<typeof useFormValidation>,
  'field' | 'errorProps' | 'slot'
>;

type AttachedLinksFieldsProps = {
  value: readonly AttachedLinkValue[];
  onChange: (value: AttachedLinkValue[]) => void;
  /** The caller's `useFormValidation` for the whole draft. */
  form: Bound;
  /**
   * The field the caller's schema gives the list: rows are `${name}.0.label`,
   * `${name}.0.url`, …; a server refusal that names no row lands on `name`.
   */
  name?: string;
  disabled?: boolean;
  /** The wrapper's classes: each form frames the list its own way. */
  className?: string;
};

const EMPTY_LINK: AttachedLinkValue = { label: '', url: '' };

/**
 * Up to five Attached Links (ruling R46), entered one row at a time: a label
 * and an address per row, "Adaugă link" until the fifth, "Elimină" per row.
 * Each row is #674's pair rule, its errors under its own fields through the
 * caller's `useFormValidation`; a blank row is dropped on save
 * (`attachedLinksSchema`). Adding a row puts the cursor in its label;
 * removing one moves it to the row that took its place, or to "Adaugă link".
 * The Submission Note and a Group's application form stay single and keep
 * `AttachedLinkFields`.
 */
export function AttachedLinksFields({
  value,
  onChange,
  form,
  name = 'links',
  disabled = false,
  className,
}: AttachedLinksFieldsProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const legendId = `${id}-legend`;
  const addRef = useRef<HTMLButtonElement>(null);
  const labelRefs = useRef<(HTMLInputElement | null)[]>([]);
  // Where the cursor goes once the rows on screen match the new list:
  // a row's label, or "Adaugă link" (`-1`).
  const focusNext = useRef<number | null>(null);
  const full = value.length >= MAX_ATTACHED_LINKS;
  const listError = form.errorProps(name);

  useEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    focusNext.current = null;
    if (target >= 0 && labelRefs.current[target])
      labelRefs.current[target].focus();
    else addRef.current?.focus();
  });

  function patch(index: number, next: Partial<AttachedLinkValue>) {
    onChange(
      value.map((link, at) => (at === index ? { ...link, ...next } : link)),
    );
  }

  function add() {
    if (full) return;
    focusNext.current = value.length;
    onChange([...value, EMPTY_LINK]);
  }

  function remove(index: number) {
    const next = value.filter((_, at) => at !== index);
    focusNext.current = next.length ? Math.min(index, next.length - 1) : -1;
    onChange(next);
  }

  return (
    <fieldset
      {...form.slot(name)}
      className={cn('min-w-0 space-y-3', className)}
      aria-describedby={
        [
          value.length ? hintId : undefined,
          listError.children ? listError.id : undefined,
        ]
          .filter(Boolean)
          .join(' ') || undefined
      }
    >
      <legend
        id={legendId}
        className="flex w-full items-baseline justify-between gap-3 text-sm font-medium"
      >
        <span>Linkuri atașate (opțional)</span>
        {value.length > 0 && (
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {value.length} din {MAX_ATTACHED_LINKS}
          </span>
        )}
      </legend>

      {value.length > 0 && (
        <ol className="m-0 list-none divide-y divide-border p-0">
          {value.map((link, index) => {
            const n = index + 1;
            const labelField = `${name}.${index}.label`;
            const urlField = `${name}.${index}.url`;
            const labelProps = form.field(labelField);
            return (
              <li
                // Rows have no identity of their own; inputs are controlled,
                // so a removed row's neighbours simply move up.
                key={index}
                className="py-3 first:pt-0 last:pb-0"
              >
                <div
                  role="group"
                  aria-label={`Link ${n}`}
                  className="flex items-start gap-2"
                >
                  <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                    <div className="min-w-0 space-y-1.5">
                      <label className={fieldClass}>
                        Etichetă
                        <input
                          className={inputClass}
                          disabled={disabled}
                          value={link.label}
                          aria-label={`Etichetă link ${n}`}
                          onChange={(event) =>
                            patch(index, { label: event.target.value })
                          }
                          {...labelProps}
                          ref={(element) => {
                            labelRefs.current[index] = element;
                            labelProps.ref(element);
                          }}
                        />
                      </label>
                      <FieldError {...form.errorProps(labelField)} />
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <label className={fieldClass}>
                        Adresă
                        <input
                          className={inputClass}
                          disabled={disabled}
                          type="url"
                          inputMode="url"
                          placeholder="https://"
                          value={link.url}
                          aria-label={`Adresă link ${n}`}
                          onChange={(event) =>
                            patch(index, { url: event.target.value })
                          }
                          {...form.field(urlField, hintId)}
                        />
                      </label>
                      <FieldError {...form.errorProps(urlField)} />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    onClick={() => remove(index)}
                    aria-label={`Elimină linkul ${n}`}
                    // Level with the inputs, under their labels.
                    className="mt-7 size-11 shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {full ? (
          <p className="m-0 text-xs text-muted-foreground">
            Ai atașat numărul maxim de linkuri ({MAX_ATTACHED_LINKS}).
          </p>
        ) : (
          <Button
            ref={addRef}
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={add}
            className="min-h-11 gap-1.5"
          >
            <Plus className="size-4" aria-hidden="true" />
            Adaugă link
          </Button>
        )}
        {value.length > 0 && (
          <p id={hintId} className="m-0 text-xs text-muted-foreground">
            Adresa începe cu http:// sau https://
          </p>
        )}
      </div>
      <FieldError {...listError} />
    </fieldset>
  );
}
